// provider-diagnostic
//
// SINGLE sanctioned channel for live provider diagnostic calls (balance / status lookup).
//
// SAFETY POLICY:
//   - No "place_order" action exists in this function — by design.
//   - Every call invokes assert_provider_call_allowed which:
//       * permanently denies kind='order_placement'
//       * requires Super Admin + an open diagnostics window + a one-time confirmation_token
//       * rotates the token on success (next call needs a fresh one)
//       * audits every attempt to provider_call_attempts
//   - Provider API keys are read server-side and never returned to the client.
//
// The only other code path that hits a provider's /orders/place endpoint is
// supabase/functions/deliver-order/index.ts, which is driven exclusively by paid customer
// order rows and has its own payment-verification guard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { sendSuperAdminAlert } from "../_shared/super-admin-alert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = "balance" | "status_lookup";

interface Body {
  action: Action;
  provider: "iGet" | "Portal-02";
  confirmation_token: string;
  reference?: string; // for status_lookup
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Per-caller client (carries JWT — used so assert_provider_call_allowed sees auth.uid()).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (!body || !body.action || !body.provider || !body.confirmation_token) {
    return json(400, { error: "action, provider, confirmation_token required" });
  }
  if (body.action !== "balance" && body.action !== "status_lookup") {
    return json(400, { error: "unsupported_action" });
  }

  // Resolve target endpoint to record in the audit BEFORE making the outbound call.
  const { data: config, error: cfgErr } = await admin
    .from("network_api_configs")
    .select("network, api_key, api_base_url, extra_params")
    .limit(50);
  if (cfgErr) return json(500, { error: "config_lookup_failed" });

  const providerConfig = (config || []).find(
    (c: { extra_params: { provider?: string } | null }) =>
      (c.extra_params?.provider || "").toLowerCase() === body.provider.toLowerCase()
  );

  let endpoint = "";
  if (body.action === "balance") {
    if (body.provider === "Portal-02" && providerConfig?.api_base_url) {
      endpoint = `${providerConfig.api_base_url}/balance`;
    } else if (body.provider === "iGet") {
      return json(400, {
        error: "iGet does not expose a balance API. Check the iGet dashboard.",
      });
    }
  } else {
    if (!body.reference) return json(400, { error: "reference required for status_lookup" });
    if (body.provider === "iGet" && providerConfig?.api_base_url) {
      endpoint = `${providerConfig.api_base_url}/api/developer/orders/reference/${body.reference}`;
    } else if (body.provider === "Portal-02" && providerConfig?.api_base_url) {
      endpoint = `${providerConfig.api_base_url}/order/reference/${body.reference}`;
    }
  }
  if (!endpoint) return json(400, { error: "provider_not_configured" });

  // Gate: super admin + open window + valid one-time token. Throws on failure.
  const kind = body.action === "balance" ? "probe_balance" : "probe_status";
  const { error: gateErr } = await userClient.rpc("assert_provider_call_allowed", {
    _kind: kind,
    _provider: body.provider,
    _endpoint: endpoint,
    _confirmation_token: body.confirmation_token,
    _payload_summary: { action: body.action, reference: body.reference ?? null },
  });
  if (gateErr) {
    // Critical: surface blocked diagnostic attempts to Super Admins via
    // notifications + security_logs + edge logs (fallback channel).
    await sendSuperAdminAlert(admin, {
      type: "provider_diagnostic_blocked",
      title: "Provider diagnostic call was blocked",
      body: `${body.provider} ${kind} blocked: ${gateErr.message || "blocked"}`,
      severity: "critical",
      metadata: {
        provider: body.provider,
        action: body.action,
        endpoint,
        reason: gateErr.message,
      },
      idempotency_key: `diag-blocked-${body.provider}-${kind}-${new Date().toISOString().slice(0, 19)}`,
    }).catch((e) => console.error("[provider-diagnostic] alert failed:", e));
    return json(403, { error: gateErr.message || "blocked" });
  }

  // Outbound call — keys never leave the server.
  try {
    const apiKey = providerConfig!.api_key || Deno.env.get("IGET_API_KEY") || "";
    const headers: Record<string, string> =
      body.provider === "iGet"
        ? { "X-API-Key": apiKey }
        : { "x-api-key": apiKey };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(endpoint, { method: "GET", headers, signal: ctrl.signal });
    clearTimeout(t);
    const text = await resp.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    await admin.from("provider_call_attempts").insert({
      kind,
      provider: body.provider,
      endpoint,
      outcome: resp.ok ? "ok" : `http_${resp.status}`,
      source: "edge_function",
      payload_summary: { http_status: resp.status },
    });

    return json(200, { ok: resp.ok, status: resp.status, data: parsed });
  } catch (e) {
    await admin.from("provider_call_attempts").insert({
      kind,
      provider: body.provider,
      endpoint,
      outcome: "network_error",
      blocked_reason: (e as Error).message,
      source: "edge_function",
    });
    return json(502, { error: "provider_unreachable", detail: (e as Error).message });
  }
});
