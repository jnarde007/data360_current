import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Guest frontend callback handler.
 * Called after Paystack popup returns a reference for a guest checkout.
 * 
 * Handles reference remapping (Paystack may return its own reference)
 * then delegates to the canonical finalize-payment function.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const { reference, buyer_phone, expected_amount } = await req.json();

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing payment reference" }), { status: 400, headers: h });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Strip bulk-order suffix
    const baseRef = reference.replace(/-\d+$/, "");

    // Check if exact match exists
    const { data: existingAttempt } = await supabase
      .from("payment_attempts")
      .select("id")
      .eq("paystack_reference", baseRef)
      .maybeSingle();

    if (!existingAttempt) {
      // Smart-match fallback — STRICT: requires phone match AND (amount match OR single candidate)
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const normalizedPhone = (buyer_phone || "").replace(/[^0-9]/g, "");

      let match: any = null;

      if (normalizedPhone.length >= 9) {
        const { data: candidates } = await supabase
          .from("payment_attempts")
          .select("id, paystack_reference, event_log, metadata, amount, created_at")
          .eq("buyer_type", "guest")
          .eq("buyer_phone", normalizedPhone)
          .eq("attempt_type", "data_direct")
          .in("status", ["pending", "needs_review"])
          .gte("created_at", tenMinAgo)
          .order("created_at", { ascending: false })
          .limit(5);

        const list = candidates || [];

        if (list.length === 1) {
          // Single in-flight attempt for this phone — safe to remap
          match = list[0];
        } else if (list.length > 1 && expected_amount != null) {
          // Multiple candidates — require amount tolerance match
          const tolerance = Math.max(Number(expected_amount) * 0.01, 0.5);
          match = list.find((c: any) => {
            const exp = c.metadata?.paystack_total ?? c.amount;
            return Math.abs(Number(exp) - Number(expected_amount)) < tolerance;
          }) || null;
        }
        // If no phone provided OR multiple candidates and no amount → DO NOT remap (safer to 404)
      }

      if (match) {
        console.log(`[guest-finalize] Strict remap: ${match.paystack_reference} → ${baseRef} (phone+${expected_amount != null ? 'amount' : 'single'})`);
        const existingLog = Array.isArray(match.event_log) ? match.event_log : [];
        await supabase.from("payment_attempts").update({
          paystack_reference: baseRef,
          callback_received_at: new Date().toISOString(),
          event_log: [...existingLog, {
            type: "reference_remapped",
            original_reference: match.paystack_reference,
            paystack_reference: baseRef,
            source: "guest_callback",
            match_strategy: expected_amount != null ? "phone+amount" : "phone+single",
            timestamp: new Date().toISOString(),
          }],
          updated_at: new Date().toISOString(),
        }).eq("id", match.id);
      } else {
        console.warn(`[guest-finalize] No safe smart-match for ref=${baseRef} phone=${normalizedPhone || 'none'} amount=${expected_amount ?? 'unknown'}`);
      }
    }

    // Delegate to canonical finalize-payment
    const { data: finalizeResult, error: finalizeErr } = await supabase.functions.invoke("finalize-payment", {
      body: { reference: baseRef, source: "callback" },
    });

    if (finalizeErr) {
      console.error("[guest-finalize] finalize-payment error:", finalizeErr);
      return new Response(JSON.stringify({ error: finalizeErr.message || "Finalization failed" }), { status: 500, headers: h });
    }

    const result = finalizeResult as any;

    if (result?.error) {
      return new Response(JSON.stringify({ error: result.error, status: result.status }), { status: 400, headers: h });
    }

    // Fetch tracking tokens for the created orders
    let trackingTokens: Record<string, string> = {};
    if (result?.orders?.length) {
      const orderIds = result.orders.map((o: any) => o.order_id).filter(Boolean);
      if (orderIds.length) {
        const { data: orderRows } = await supabase
          .from("orders")
          .select("id, tracking_token")
          .in("id", orderIds);
        if (orderRows) {
          for (const row of orderRows) {
            if (row.tracking_token) {
              trackingTokens[row.id] = row.tracking_token;
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: result?.success ?? true,
      order_id: result?.order_id,
      short_id: result?.short_id,
      grace_period_ends_at: result?.grace_period_ends_at,
      already_processed: result?.already_processed || false,
      orders: result?.orders,
      item_results: result?.item_results,
      partial_failure: result?.partial_failure,
      tracking_tokens: trackingTokens,
      message: result?.message,
    }), { status: 200, headers: h });
  } catch (error) {
    console.error("[guest-finalize] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
