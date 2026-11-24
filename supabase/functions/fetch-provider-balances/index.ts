import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { sendSuperAdminAlert } from "../_shared/super-admin-alert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface ProbeResult {
  provider: string;
  status: "online" | "offline" | "unsupported";
  balance: number | null;
  currency: string | null;
  error: string | null;
  supported: boolean;
}

async function probePortal02(baseUrl: string, apiKey: string): Promise<ProbeResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${baseUrl}/balance`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok || !json?.success) {
      return {
        provider: "Portal-02",
        status: "offline",
        balance: null,
        currency: null,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        supported: true,
      };
    }
    return {
      provider: "Portal-02",
      status: "online",
      balance: typeof json.balance === "number" ? json.balance : Number(json.balance),
      currency: json.currency || "GHS",
      error: null,
      supported: true,
    };
  } catch (e) {
    return {
      provider: "Portal-02",
      status: "offline",
      balance: null,
      currency: null,
      error: (e as Error).message,
      supported: true,
    };
  }
}

function probeIget(): ProbeResult {
  // iGet (iget.onrender.com) does not currently expose a balance endpoint.
  // All probed routes (/api/developer/balance, /wallet, /account, /me, etc.) return 404.
  return {
    provider: "iGet",
    status: "unsupported",
    balance: null,
    currency: "GHS",
    error: "Provider does not expose a balance API. Check balance manually in iGet dashboard.",
    supported: false,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get Portal-02 config (any network whose provider is Portal-02; canonically MTN)
    const { data: configs } = await supabase
      .from("network_api_configs")
      .select("network, api_key, api_base_url, extra_params");

    const portalConfig = (configs || []).find(
      (c: any) => (c.extra_params?.provider || "").toLowerCase() === "portal-02"
    );

    const results: ProbeResult[] = [];

    if (portalConfig?.api_key && portalConfig?.api_base_url) {
      results.push(await probePortal02(portalConfig.api_base_url, portalConfig.api_key));
    } else {
      results.push({
        provider: "Portal-02",
        status: "offline",
        balance: null,
        currency: null,
        error: "Portal-02 API not configured",
        supported: true,
      });
    }

    results.push(probeIget());

    // Load thresholds
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", [
        "provider_balance_threshold_portal_02",
        "provider_balance_threshold_iget",
      ]);
    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });
    const thresholds: Record<string, number> = {
      "Portal-02": Number(settingsMap.provider_balance_threshold_portal_02 || "100"),
      "iGet": Number(settingsMap.provider_balance_threshold_iget || "100"),
    };

    const now = new Date().toISOString();

    for (const r of results) {
      // History
      await supabase.from("provider_balance_history").insert({
        provider: r.provider,
        balance: r.balance,
        currency: r.currency,
        status: r.status,
        error_message: r.error,
        retrieved_at: now,
      });

      // Read previous current row for last_success_*
      const { data: prev } = await supabase
        .from("provider_balance_current")
        .select("last_success_balance, last_success_at, balance")
        .eq("provider", r.provider)
        .maybeSingle();

      const lastSuccessBalance = r.status === "online" ? r.balance : (prev?.last_success_balance ?? null);
      const lastSuccessAt = r.status === "online" ? now : (prev?.last_success_at ?? null);

      await supabase.from("provider_balance_current").upsert({
        provider: r.provider,
        balance: r.balance,
        currency: r.currency,
        status: r.status,
        error_message: r.error,
        last_success_balance: lastSuccessBalance,
        last_success_at: lastSuccessAt,
        last_checked_at: now,
        supported: r.supported,
        updated_at: now,
      }, { onConflict: "provider" });

      // Low balance alert
      if (r.status === "online" && r.balance !== null) {
        const threshold = thresholds[r.provider];
        const prevBalance = prev?.balance;
        const wasAbove = prevBalance == null || Number(prevBalance) >= threshold;
        if (r.balance < threshold && wasAbove) {
          // Notify all admins
          const { data: admins } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("role", "admin");
          const inserts = (admins || []).map((a: any) => ({
            user_id: a.user_id,
            type: "system",
            title: `${r.provider} balance is low`,
            body: `Current balance ${r.currency || ""} ${r.balance?.toFixed(2)} is below threshold ${r.currency || ""} ${threshold.toFixed(2)}.`,
            metadata: { provider: r.provider, balance: r.balance, threshold },
          }));
          if (inserts.length) {
            await supabase.from("notifications").insert(inserts);
          }
          // Critical fallback alert: Super Admins always hear about a low balance,
          // even if the per-admin notifications insert above silently fails.
          await sendSuperAdminAlert(supabase, {
            type: "provider_low_balance",
            title: `${r.provider} balance is low`,
            body: `Current ${r.currency || ""} ${r.balance?.toFixed(2)} below threshold ${r.currency || ""} ${threshold.toFixed(2)}.`,
            severity: "critical",
            metadata: { provider: r.provider, balance: r.balance, threshold, currency: r.currency },
            idempotency_key: `low-balance-${r.provider}-${new Date().toISOString().slice(0, 10)}`,
          }).catch((e) => console.error("[fetch-provider-balances] alert failed:", e));
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-provider-balances error:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
