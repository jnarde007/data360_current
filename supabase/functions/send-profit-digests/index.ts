// send-profit-digests
// Runs once per day (pg_cron at 19:00 UTC). Aggregates the day's
// "profit-available" events per store owner and triggers a single SMS digest
// via store-owner-notify. Replaces the per-order store_profit_available SMS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Window: last 24h of "delivered" transitions. We use updated_at on store_orders.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const digestDate = new Date().toISOString().slice(0, 10);

    const { data: rows, error } = await supabase
      .from("store_orders")
      .select("store_owner_id, profit")
      .eq("status", "delivered")
      .gte("updated_at", since);

    if (error) throw error;

    // Aggregate per owner
    const agg = new Map<string, { profit: number; count: number }>();
    for (const r of rows || []) {
      const cur = agg.get(r.store_owner_id) || { profit: 0, count: 0 };
      cur.profit += Number(r.profit || 0);
      cur.count += 1;
      agg.set(r.store_owner_id, cur);
    }

    const results: any[] = [];
    for (const [owner_id, v] of agg) {
      if (v.profit <= 0) continue;

      // Available balance snapshot
      const { data: wallet } = await supabase
        .from("store_wallets")
        .select("available_balance")
        .eq("owner_id", owner_id)
        .maybeSingle();
      const available_total = Number(wallet?.available_balance || 0);

      const { error: invErr } = await supabase.functions.invoke("store-owner-notify", {
        body: {
          event: "store_profit_digest",
          owner_id,
          daily_profit: v.profit,
          order_count: v.count,
          available_total,
          digest_date: digestDate,
        },
      });
      results.push({ owner_id, profit: v.profit, count: v.count, ok: !invErr });
    }

    return new Response(JSON.stringify({ ok: true, digests: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-profit-digests] error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
