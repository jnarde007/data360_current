// payout-retry: admin-only. Re-initiates a failed payout using a NEW reference
// (Paystack rejects re-use). The locked balance was released to available on
// failure, so we first re-lock by creating a new payout linked to the original.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: h });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await userClient.auth.getClaims(token);
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: h });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: adminRow } = await admin.from("admin_users").select("id").eq("id", claims.claims.sub).maybeSingle();
    if (!adminRow) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: h });

    const { payout_id } = await req.json();
    if (!payout_id) return new Response(JSON.stringify({ error: "Missing payout_id" }), { status: 400, headers: h });

    const { data: original } = await admin.from("payouts").select("*").eq("id", payout_id).single();
    if (!original) return new Response(JSON.stringify({ error: "Payout not found" }), { status: 404, headers: h });
    if (original.status !== "failed") {
      return new Response(JSON.stringify({ error: `Only failed payouts can be retried (current: ${original.status})` }), { status: 400, headers: h });
    }

    // Create a new payout that re-locks funds. The RPC enforces balance check.
    const idem = `retry-${original.id}-${Date.now()}`;
    let createRes: any;
    if (original.payout_type === "affiliate") {
      // Need to call as the original user — but request_affiliate_payout uses get_my_customer_id().
      // We instead call admin_create_store_payout? No — that's for stores. For affiliate retry we'll
      // do a direct service-role insert via a small helper RPC (admin_retry_affiliate_payout).
      // To keep this PR tight we re-use admin_create_store_payout's pattern by inserting directly:
      const { data: insertResult, error: insErr } = await admin.rpc("admin_retry_payout", {
        p_original_payout_id: original.id,
        p_idempotency_key: idem,
      });
      if (insErr) return new Response(JSON.stringify({ error: insErr.message }), { status: 400, headers: h });
      createRes = insertResult;
    } else {
      const { data: insertResult, error: insErr } = await admin.rpc("admin_retry_payout", {
        p_original_payout_id: original.id,
        p_idempotency_key: idem,
      });
      if (insErr) return new Response(JSON.stringify({ error: insErr.message }), { status: 400, headers: h });
      createRes = insertResult;
    }

    if (createRes?.error) {
      return new Response(JSON.stringify({ error: createRes.error }), { status: 400, headers: h });
    }

    // Auto-approve the retry to keep the admin clicks low
    await admin.rpc("admin_approve_payout", {
      p_payout_id: createRes.payout_id,
      p_rail: "paystack",
    });

    // Invoke payout-initiate for the new payout
    const initiateRes = await fetch(`${supabaseUrl}/functions/v1/payout-initiate`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ payout_id: createRes.payout_id }),
    });
    const initiateJson = await initiateRes.json();

    return new Response(JSON.stringify({
      success: initiateRes.ok,
      new_payout_id: createRes.payout_id,
      original_payout_id: original.id,
      paystack: initiateJson,
    }), { status: initiateRes.ok ? 200 : 502, headers: h });
  } catch (e) {
    console.error("[payout-retry] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
