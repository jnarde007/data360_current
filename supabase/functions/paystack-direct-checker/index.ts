import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Frontend callback handler for checker direct checkout.
 * Delegates to the canonical finalize-payment function.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const { reference, customer_id, product_id, quantity, sms_phone } = await req.json();

    if (!reference || !customer_id || !product_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: h });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if the payment_attempt exists with this reference; if not, remap from pre-checkout
    const { data: existingAttempt } = await supabase
      .from("payment_attempts")
      .select("id")
      .eq("paystack_reference", reference)
      .maybeSingle();

    if (!existingAttempt) {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: candidates } = await supabase
        .from("payment_attempts")
        .select("id, paystack_reference, event_log, metadata")
        .eq("customer_id", customer_id)
        .eq("attempt_type", "checker_direct")
        .in("status", ["pending", "needs_review"])
        .gte("created_at", tenMinAgo)
        .order("created_at", { ascending: false })
        .limit(5);

      if (candidates?.length) {
        const match = candidates.find((c: any) => c.metadata?.product_id === product_id) || candidates[0];
        if (match) {
          console.log(`[paystack-direct-checker] Remapping reference: ${match.paystack_reference} → ${reference}`);
          const existingLog = Array.isArray(match.event_log) ? match.event_log : [];
          await supabase.from("payment_attempts").update({
            paystack_reference: reference,
            callback_received_at: new Date().toISOString(),
            event_log: [...existingLog, {
              type: "reference_remapped",
              original_reference: match.paystack_reference,
              paystack_reference: reference,
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
      body: { reference, source: "callback" },
    });

    if (finalizeErr) {
      console.error("[paystack-direct-checker] finalize-payment error:", finalizeErr);
      return new Response(JSON.stringify({ error: finalizeErr.message || "Finalization failed" }), { status: 500, headers: h });
    }

    const result = finalizeResult as any;

    if (result?.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: h });
    }

    return new Response(JSON.stringify({
      success: result?.success ?? true,
      purchase_id: result?.purchase_id,
      short_id: result?.short_id,
      product_name: result?.product_name,
      amount: result?.amount,
      quantity: result?.quantity,
      codes: result?.codes,
      already_processed: result?.already_processed || false,
    }), { status: 200, headers: h });
  } catch (error) {
    console.error("paystack-direct-checker error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
