import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { mustHoldMtnSubmission } from "../_shared/mtn-provider-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Find all orders whose grace period has ended and are still pending_confirmation,
    // OR orders stuck in 'submitting' for more than 2 minutes (crashed deliver-order)
    const graceCutoff = new Date().toISOString();
    const stuckCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .or(`and(status.eq.pending_confirmation,grace_period_ends_at.lte.${graceCutoff}),and(status.eq.submitting,grace_period_ends_at.lte.${stuckCutoff})`);

    if (error) throw error;

    if (!orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: "No orders to process" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    const results: any[] = [];

    const terminalStatuses = ["rejected", "refunded", "customer_cancelled", "cancelled_before_processing"];

    for (const order of orders) {
      // Skip any order that somehow reached a terminal status
      if (terminalStatuses.includes(order.status)) {
        console.log(`Skipping terminal order ${order.short_id} (status: ${order.status})`);
        continue;
      }
      if (order.network === 'MTN' && mustHoldMtnSubmission(order)) {
        // A reset is not evidence that the provider rejected the purchase.
        // Never make a second purchase to resolve a timed-out submission.
        results.push({ order_id: order.id, short_id: order.short_id, skipped: 'provider_reconciliation_required' });
        continue;
      }
      // Reset stuck 'submitting' orders back to pending_confirmation so deliver-order can claim them
      if (order.status === "submitting") {
        console.log(`Resetting stuck submitting order ${order.short_id} to pending_confirmation`);
        await supabase.from("orders").update({ status: "pending_confirmation" }).eq("id", order.id).eq("status", "submitting");
      }
      try {
        // Call the existing deliver-order function which handles API vs manual routing
        const deliverRes = await fetch(`${supabaseUrl}/functions/v1/deliver-order`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ order_id: order.id }),
        });

        const deliverData = await deliverRes.json();
        processed++;
        results.push({ order_id: order.id, short_id: order.short_id, result: deliverData });
        console.log(`Processed order ${order.short_id}: ${JSON.stringify(deliverData)}`);
      } catch (orderError) {
        console.error(`Failed to process order ${order.short_id}:`, orderError);
        // Mark as pending so it's visible to admin
        await supabase
          .from("orders")
          .update({ status: "pending" })
          .eq("id", order.id);
        results.push({ order_id: order.id, short_id: order.short_id, error: "Processing failed" });
      }
    }

    return new Response(
      JSON.stringify({ processed, total: orders.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("process-pending-orders error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
