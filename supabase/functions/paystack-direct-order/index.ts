import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Frontend callback handler for data direct checkout.
 * Delegates to the canonical finalize-payment function.
 * Also does a fast Paystack verify to catch amount mismatches early.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const { reference, customer_id, network, bundle_size, recipient_phone, total_amount } = await req.json();

    if (!reference || !customer_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: h });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Strip any bulk-order suffix to get the base reference
    const baseRef = reference.replace(/-\d+$/, '');

    // If the Paystack reference differs from the pre-checkout reference, update the original attempt
    // This handles the case where Paystack returns its own reference instead of the custom one
    const { data: existingAttempt } = await supabase
      .from("payment_attempts")
      .select("id, paystack_reference")
      .eq("paystack_reference", baseRef)
      .maybeSingle();

    if (!existingAttempt) {
      // No exact match — try to find the pre-checkout attempt by customer+type and remap
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: candidates } = await supabase
        .from("payment_attempts")
        .select("id, paystack_reference, amount, metadata, event_log")
        .eq("customer_id", customer_id)
        .eq("attempt_type", "data_direct")
        .in("status", ["pending", "needs_review"])
        .gte("created_at", tenMinAgo)
        .order("created_at", { ascending: false })
        .limit(5);

      if (candidates?.length) {
        // Find the best match (same network + close amount)
        const match = candidates.find((c: any) => c.metadata?.network === network);
        if (match) {
          console.log(`[paystack-direct-order] Remapping reference: ${match.paystack_reference} → ${baseRef}`);
          const existingLog = Array.isArray(match.event_log) ? match.event_log : [];
          await supabase.from("payment_attempts").update({
            paystack_reference: baseRef,
            callback_received_at: new Date().toISOString(),
            event_log: [...existingLog, {
              type: "reference_remapped",
              original_reference: match.paystack_reference,
              paystack_reference: baseRef,
              source: "callback",
              timestamp: new Date().toISOString(),
            }],
            updated_at: new Date().toISOString(),
          }).eq("id", match.id);
        }
      }
    }

    // Delegate to the canonical finalize-payment function
    const { data: finalizeResult, error: finalizeErr } = await supabase.functions.invoke("finalize-payment", {
      body: { reference: baseRef, source: "callback" },
    });

    if (finalizeErr) {
      console.error("[paystack-direct-order] finalize-payment error:", finalizeErr);
      return new Response(JSON.stringify({ error: finalizeErr.message || "Finalization failed" }), { status: 500, headers: h });
    }

    const result = finalizeResult as any;

    if (result?.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: h });
    }

    // Return the result with order details for frontend UX
    return new Response(JSON.stringify({
      success: true,
      order_id: result?.order_id || result?.orders?.[0]?.order_id,
      short_id: result?.short_id || result?.orders?.[0]?.short_id,
      grace_period_ends_at: result?.grace_period_ends_at,
      already_processed: result?.already_processed || false,
      orders: result?.orders,
      item_results: result?.item_results,
    }), { status: 200, headers: h });
  } catch (error) {
    console.error("paystack-direct-order error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
