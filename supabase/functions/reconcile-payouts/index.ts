// reconcile-payouts: cron-invoked. Polls Paystack for any payouts stuck in
// 'processing' for more than 15 minutes (webhook may have been missed) and
// applies the terminal status via the dedicated RPCs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { getPaystackSecret, fetchTransfer } from "../_shared/paystack-transfer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    const secret = await getPaystackSecret(admin);

    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: stale, error } = await admin
      .from("payouts")
      .select("id, paystack_transfer_code, paystack_transfer_reference, status, processed_at")
      .eq("status", "processing")
      .not("paystack_transfer_code", "is", null)
      .lte("processed_at", cutoff)
      .order("processed_at", { ascending: true })
      .limit(50);

    if (error) throw error;

    const results: any[] = [];
    for (const p of stale || []) {
      try {
        const json = await fetchTransfer(secret, p.paystack_transfer_code as string);
        const status = (json?.data?.status || "").toLowerCase();
        if (status === "success") {
          await admin.rpc("apply_payout_success", { p_payout_id: p.id, p_response: json.data });
          results.push({ id: p.id, action: "success" });
        } else if (status === "failed") {
          await admin.rpc("apply_payout_failure", {
            p_payout_id: p.id, p_new_status: "failed",
            p_reason: json?.data?.reason || "Reconciliation: Paystack reports failed",
            p_response: json.data,
          });
          results.push({ id: p.id, action: "failed" });
        } else if (status === "reversed") {
          await admin.rpc("apply_payout_failure", {
            p_payout_id: p.id, p_new_status: "reversed",
            p_reason: json?.data?.reason || "Reconciliation: Paystack reports reversed",
            p_response: json.data,
          });
          results.push({ id: p.id, action: "reversed" });
        } else {
          results.push({ id: p.id, action: "still_pending", paystack_status: status });
        }
      } catch (e: any) {
        results.push({ id: p.id, error: e.message });
      }
    }

    return new Response(JSON.stringify({ checked: stale?.length || 0, results }), { status: 200, headers: h });
  } catch (e) {
    console.error("[reconcile-payouts] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
