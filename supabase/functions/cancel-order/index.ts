import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

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
    const { order_id, customer_id } = await req.json();
    if (!order_id || !customer_id) {
      return new Response(JSON.stringify({ error: "Missing order_id or customer_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .eq("customer_id", customer_id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only allow cancellation of pending_confirmation orders
    if (order.status !== "pending_confirmation") {
      return new Response(
        JSON.stringify({ error: "This order can no longer be cancelled. It has already been submitted for processing." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if grace period has expired
    const graceEnd = new Date(order.grace_period_ends_at);
    if (new Date() > graceEnd) {
      return new Response(
        JSON.stringify({ error: "The cancellation window has expired. Your order is being processed." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency: check if a refund record already exists
    const { data: existingRefund } = await supabase
      .from("refunds")
      .select("id, status")
      .eq("order_id", order_id)
      .neq("status", "refund_failed")
      .maybeSingle();

    if (existingRefund) {
      await supabase.from("orders").update({ status: "customer_cancelled" }).eq("id", order_id);
      return new Response(
        JSON.stringify({ success: true, message: "Order already cancelled and refunded" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Legacy idempotency check (wallet_transactions)
    const refundRef = `REF-${order.short_id}`;
    const { data: legacyRefund } = await supabase
      .from("wallet_transactions")
      .select("id")
      .eq("reference", refundRef)
      .eq("type", "credit")
      .maybeSingle();

    if (legacyRefund) {
      await supabase.from("orders").update({ status: "customer_cancelled" }).eq("id", order_id);
      console.log(`Order ${order.short_id} refund already exists, skipping duplicate`);
      return new Response(
        JSON.stringify({ success: true, message: "Order already cancelled and refunded" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cancel the order
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "customer_cancelled" })
      .eq("id", order_id);

    if (updateError) throw updateError;

    // Refund the wallet: read current balance, then increment
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .select("wallet_balance")
      .eq("id", customer_id)
      .single();

    if (custErr || !customer) throw new Error("Customer not found for refund");

    const refundAmount = Number(order.total_amount);
    const newBalance = Number(customer.wallet_balance) + refundAmount;

    const { error: walletUpdateErr } = await supabase
      .from("customers")
      .update({ wallet_balance: newBalance })
      .eq("id", customer_id);

    if (walletUpdateErr) throw walletUpdateErr;

    // Record refund transaction
    const { error: txnErr } = await supabase.from("wallet_transactions").insert({
      customer_id: customer_id,
      type: "credit",
      amount: refundAmount,
      description: `Refund - Order cancelled by customer (${order.short_id})`,
      reference: refundRef,
    });

    if (txnErr) throw txnErr;

    // Create refund record for audit trail
    try {
      await supabase.from("refunds").insert({
        order_id: order_id,
        customer_id: customer_id,
        buyer_type: "registered",
        refund_method: "wallet",
        refund_amount: refundAmount,
        amount_paid: refundAmount,
        data_value: refundAmount,
        status: "refunded",
        total_refunded: refundAmount,
        refund_reason: "Order cancelled by customer",
        initiated_by: "customer",
      });
    } catch (e) {
      console.error("Refund record insert error (non-fatal):", e);
    }

    console.log(`Order ${order.short_id} cancelled by customer ${customer_id}, refund of ${refundAmount} issued`);

    return new Response(
      JSON.stringify({ success: true, message: "Order cancelled and wallet refunded" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("cancel-order error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
