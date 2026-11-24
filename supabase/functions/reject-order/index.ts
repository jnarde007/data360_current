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
    const { order_id, refund_reason, is_full_override, initiated_by } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "Missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only allow rejection from recoverable states
    const rejectableStatuses = ["failed", "pending", "processing", "pending_confirmation", "awaiting_manual_fulfillment"];
    if (!rejectableStatuses.includes(order.status)) {
      return new Response(
        JSON.stringify({ error: `Cannot reject order with status '${order.status}'` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Already rejected — idempotent
    if (order.status === "rejected") {
      return new Response(
        JSON.stringify({ success: true, message: "Order already rejected" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isGuest = order.buyer_type === "guest";
    // Detect store-linked orders early — store buyers don't have a wallet, so
    // their refunds must go back via Paystack.
    const { data: storeLink } = await supabase
      .from("store_orders")
      .select("id")
      .eq("order_id", order_id)
      .maybeSingle();
    const isStoreOrder = !!storeLink;

    // Routing rule (per business policy):
    //  • Guests & store buyers → Paystack refund (no wallet exists for them).
    //  • Registered customers → wallet refund ALWAYS, even if they paid via
    //    paystack_direct. Refunding to Paystack would force them to pay the 2%
    //    top-up fee again to reload, so we credit the wallet and clearly label
    //    the source so admins can distinguish wallet-paid vs Paystack-paid
    //    refunds in the ledger.
    const paidViaPaystackDirect = order.payment_method === "paystack_direct";
    const refundViaPaystack = isGuest || isStoreOrder;
    const refundRef = `REF-${order.short_id}`;
    const dataValue = Number(order.total_amount);


    // ── Idempotency: check if a refund record already exists ──
    const { data: existingRefund } = await supabase
      .from("refunds")
      .select("id, status")
      .eq("order_id", order_id)
      .neq("status", "refund_failed")
      .maybeSingle();

    if (existingRefund) {
      // Ensure order status is updated
      await supabase.from("orders").update({ status: "rejected" }).eq("id", order_id);
      return new Response(
        JSON.stringify({ success: true, message: "Order rejected (refund already processed)", refund_status: existingRefund.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Also check legacy wallet_transactions refund (for backward compat) — only
    // relevant when the refund actually goes to the wallet.
    if (!refundViaPaystack) {
      const { data: legacyRefund } = await supabase
        .from("wallet_transactions")
        .select("id")
        .eq("reference", refundRef)
        .eq("type", "credit")
        .maybeSingle();

      if (legacyRefund) {
        await supabase.from("orders").update({ status: "rejected" }).eq("id", order_id);
        return new Response(
          JSON.stringify({ success: true, message: "Order rejected (refund already issued)" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Determine refund amount ──
    const fullOverride = is_full_override === true;
    const refundAmount = dataValue; // Always refund data value; for guests, Paystack fees are excluded by default

    // ── Create refund record (before processing) ──
    let paystackTxId = "";
    let paystackRef = "";

    if (refundViaPaystack) {
      // Look up payment_attempt to get Paystack transaction ID
      const { data: paymentAttempt } = await supabase
        .from("payment_attempts")
        .select("paystack_transaction_id, paystack_reference, amount")
        .eq("order_id", order_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      paystackTxId = paymentAttempt?.paystack_transaction_id || "";
      paystackRef = paymentAttempt?.paystack_reference || order.payment_reference || "";
    }

    const { data: refundRecord, error: refundInsertErr } = await supabase
      .from("refunds")
      .insert({
        order_id: order_id,
        customer_id: order.customer_id || null,
        buyer_type: isGuest ? "guest" : "registered",
        refund_method: refundViaPaystack ? "paystack" : "wallet",
        refund_amount: refundAmount,
        amount_paid: dataValue,
        data_value: dataValue,
        paystack_transaction_id: paystackTxId,
        paystack_reference: paystackRef,
        status: "refund_pending",
        refund_reason: refund_reason || "Order rejected by admin",
        initiated_by: initiated_by || "admin",
        is_full_override: fullOverride,
        total_refunded: 0,
      })
      .select("id")
      .single();

    if (refundInsertErr) {
      console.error("Failed to create refund record:", refundInsertErr);
      // If it's a unique constraint violation, refund already exists
      if (refundInsertErr.code === "23505") {
        await supabase.from("orders").update({ status: "rejected" }).eq("id", order_id);
        return new Response(
          JSON.stringify({ success: true, message: "Order rejected (refund already in progress)" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw refundInsertErr;
    }

    // ── Route refund by payment rail (not buyer_type) ──
    if (refundViaPaystack) {
      // Paystack refund — used for guests AND registered users who paid via paystack_direct
      await processPaystackRefund(supabase, refundRecord!.id, paystackTxId, paystackRef, refundAmount, fullOverride, order_id, order.short_id);

      // Send refund SMS — but never to store buyers
      const notifyPhone = order.buyer_phone || null;
      if (notifyPhone && !isStoreOrder) {
        const rawRecipGuest = order.recipient_phone || "";
        const maskedRecipGuest = rawRecipGuest.length >= 6 ? rawRecipGuest.slice(0, 4) + "****" + rawRecipGuest.slice(-2) : rawRecipGuest;
        const smsMsg = `GHS ${refundAmount.toFixed(2)} has been refunded to your payment method. Your order for ${maskedRecipGuest} could not be completed.`;
        supabase.functions.invoke("send-sms", {
          body: {
            to: notifyPhone,
            message: smsMsg,
            event_type: "refund_successful",
            related_order_id: order_id,
            idempotency_key: `refund_paystack_${order_id}`,
          },
        }).catch((e: any) => console.error("Paystack refund SMS error:", e));
      }
    } else {
      // Wallet refund — registered users (whether they paid from wallet OR via
      // paystack_direct). When paid via Paystack, we tag the ledger entry so
      // admins can clearly trace where the funds originated.
      await processWalletRefund(supabase, refundRecord!.id, order, refundRef, refundAmount, order_id, paidViaPaystackDirect);


      // Send refund SMS to registered buyer phone
      if (order.customer_id) {
        const { data: cust } = await supabase
          .from("customers")
          .select("phone, wallet_balance")
          .eq("id", order.customer_id)
          .maybeSingle();
        if (cust?.phone) {
          const rawRecipWallet = order.recipient_phone || "";
          const maskedRecipWallet = rawRecipWallet.length >= 6 ? rawRecipWallet.slice(0, 4) + "****" + rawRecipWallet.slice(-2) : rawRecipWallet;
          const smsMsg = `GHS ${refundAmount.toFixed(2)} has been refunded to your wallet. Your order for ${maskedRecipWallet} could not be completed.`;
          supabase.functions.invoke("send-sms", {
            body: {
              to: cust.phone,
              message: smsMsg,
              event_type: "refund_successful",
              related_order_id: order_id,
              customer_id: order.customer_id,
              idempotency_key: `refund_wallet_${order_id}`,
            },
          }).catch((e: any) => console.error("Wallet refund SMS error:", e));
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: refundViaPaystack ? "Order rejected and Paystack refund initiated" : "Order rejected and wallet refunded",
        refund_method: refundViaPaystack ? "paystack" : "wallet",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("reject-order error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Paystack refund processing ──
async function processPaystackRefund(
  supabase: any,
  refundId: string,
  paystackTxId: string,
  paystackRef: string,
  refundAmount: number,
  fullOverride: boolean,
  orderId: string,
  shortId: string
) {
  // Get Paystack secret key
  const { data: settingRow } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "paystack_secret_key")
    .single();

  const paystackSecretKey = settingRow?.value;
  if (!paystackSecretKey) {
    await supabase.from("refunds").update({
      status: "refund_failed",
      error_message: "Paystack secret key not configured",
    }).eq("id", refundId);
    throw new Error("Paystack secret key not configured — cannot process guest refund");
  }

  // We need either a transaction ID or reference to identify the Paystack transaction
  // If we have a reference but no transaction ID, verify the transaction first to get the ID
  let transactionIdentifier = paystackTxId;

  if (!transactionIdentifier && paystackRef) {
    // Verify transaction to get the ID
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${paystackRef}`,
      { headers: { Authorization: `Bearer ${paystackSecretKey}` } }
    );
    const verifyData = await verifyRes.json();
    if (verifyRes.ok && verifyData.data?.id) {
      transactionIdentifier = String(verifyData.data.id);
      // Update the refund record with the discovered transaction ID
      await supabase.from("refunds").update({
        paystack_transaction_id: transactionIdentifier,
      }).eq("id", refundId);
    }
  }

  if (!transactionIdentifier) {
    await supabase.from("refunds").update({
      status: "refund_failed",
      error_message: "No Paystack transaction ID or reference available for refund",
    }).eq("id", refundId);
    // Still reject the order
    await supabase.from("orders").update({ status: "rejected" }).eq("id", orderId);
    throw new Error("Cannot process Paystack refund: no transaction identifier found");
  }

  // Build refund request body
  const refundBody: Record<string, any> = {
    transaction: transactionIdentifier,
  };

  // If not full override, send partial refund amount (data value only, in kobo)
  if (!fullOverride) {
    refundBody.amount = Math.round(refundAmount * 100);
  }

  // Call Paystack refund API
  try {
    const refundRes = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(refundBody),
    });

    const refundData = await refundRes.json();

    if (!refundRes.ok || !refundData.status) {
      console.error(`Paystack refund failed for order ${shortId}:`, refundData);
      await supabase.from("refunds").update({
        status: "refund_failed",
        paystack_response: refundData,
        error_message: refundData.message || "Paystack refund API returned an error",
      }).eq("id", refundId);

      // Still reject the order but note refund failed
      await supabase.from("orders").update({ status: "rejected" }).eq("id", orderId);
      return; // Don't throw — order is rejected, refund just failed
    }

    // Success
    const paystackRefundId = refundData.data?.id ? String(refundData.data.id) : "";
    const refundStatus = refundData.data?.status === "processed" ? "refunded" : "refund_pending";

    await supabase.from("refunds").update({
      status: refundStatus,
      paystack_refund_id: paystackRefundId,
      paystack_response: refundData,
      total_refunded: refundAmount,
      error_message: "",
    }).eq("id", refundId);

    await supabase.from("orders").update({ status: "rejected" }).eq("id", orderId);

    console.log(`Order ${shortId} rejected, Paystack refund ${refundStatus} (${paystackRefundId}), amount: ${refundAmount}`);
  } catch (fetchErr) {
    console.error(`Paystack refund fetch error for order ${shortId}:`, fetchErr);
    await supabase.from("refunds").update({
      status: "refund_failed",
      error_message: fetchErr instanceof Error ? fetchErr.message : "Network error calling Paystack",
    }).eq("id", refundId);
    await supabase.from("orders").update({ status: "rejected" }).eq("id", orderId);
  }
}

// ── Wallet refund processing (existing logic) ──
async function processWalletRefund(
  supabase: any,
  refundId: string,
  order: any,
  refundRef: string,
  refundAmount: number,
  orderId: string,
  paidViaPaystackDirect: boolean = false,
) {
  // Update order status
  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "rejected" })
    .eq("id", orderId);

  if (updateError) throw updateError;

  // Refund wallet
  if (order.customer_id) {
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .select("wallet_balance")
      .eq("id", order.customer_id)
      .single();

    if (custErr || !customer) throw new Error("Customer not found for refund");

    const newBalance = Number(customer.wallet_balance) + refundAmount;

    const { error: walletErr } = await supabase
      .from("customers")
      .update({ wallet_balance: newBalance })
      .eq("id", order.customer_id);

    if (walletErr) throw walletErr;

    // Build a description that flags the original payment rail so admins can
    // distinguish wallet-paid refunds from Paystack-paid refunds in the ledger.
    const sourceLabel = paidViaPaystackDirect
      ? "Paystack-paid order"
      : "wallet-paid order";
    const description = `Refund - Order rejected (${order.short_id}) [source: ${sourceLabel}]`;

    // Record refund transaction
    const { error: txnErr } = await supabase.from("wallet_transactions").insert({
      customer_id: order.customer_id,
      type: "credit",
      amount: refundAmount,
      description,
      reference: refundRef,
    });


    if (txnErr) throw txnErr;

    // Update refund record
    await supabase.from("refunds").update({
      status: "refunded",
      total_refunded: refundAmount,
    }).eq("id", refundId);

    console.log(`Order ${order.short_id} rejected, wallet refund of ${refundAmount} issued to customer ${order.customer_id}`);
  } else {
    // No customer to refund (shouldn't happen for registered, but safety)
    await supabase.from("refunds").update({
      status: "refunded",
      total_refunded: 0,
      error_message: "No customer_id — no wallet to refund",
    }).eq("id", refundId);
  }
}
