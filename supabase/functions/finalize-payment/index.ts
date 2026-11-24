import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const h = { ...corsHeaders, "Content-Type": "application/json" };

/**
 * Unified payment finalization endpoint.
 *
 * Called by:  webhook, frontend callback, recovery cron, admin reprocess
 *
 * Input: { reference: string, source: "webhook"|"callback"|"recovery"|"admin", txData?: object }
 *
 * Returns a normalized response:
 *  { success, already_processed, status, paystack_status, order_id, purchase_id,
 *    short_id, partial_failure, message, items_succeeded, items_total }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const reference: string = body.reference;
    const source: string = body.source || "callback";
    const webhookTxData: any = body.txData || null;

    if (!reference) {
      return respond(400, { success: false, error: "Missing reference", message: "No payment reference provided." });
    }

    // ── 1. Find payment_attempt ─────────────────────────────
    const { data: attempt } = await supabase
      .from("payment_attempts")
      .select("*")
      .eq("paystack_reference", reference)
      .maybeSingle();

    if (!attempt) {
      console.warn(`[finalize-payment] No payment_attempt for ref=${reference}`);
      return respond(404, { success: false, error: "No payment attempt found", reference, message: "We could not find a record for this payment." });
    }

    const existingLog: any[] = Array.isArray(attempt.event_log) ? attempt.event_log : [];

    // Record source-specific timestamp
    const timestampUpdates: Record<string, any> = {};
    if (source === "webhook") timestampUpdates.webhook_received_at = attempt.webhook_received_at || new Date().toISOString();
    if (source === "callback") timestampUpdates.callback_received_at = attempt.callback_received_at || new Date().toISOString();
    if (source === "recovery") {
      timestampUpdates.recovery_attempts = (attempt.recovery_attempts || 0) + 1;
      timestampUpdates.last_recovery_at = new Date().toISOString();
    }

    // ── 2. Idempotency: already completed ───────────────────
    if (attempt.status === "completed" || attempt.status === "partially_completed") {
      console.log(`[finalize-payment] Already ${attempt.status} ref=${reference} (source=${source})`);
      await supabase.from("payment_attempts").update({
        ...timestampUpdates,
        event_log: [...existingLog, { type: "duplicate_ignored", source, timestamp: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      }).eq("id", attempt.id);

      const partial = attempt.items_total != null && attempt.items_succeeded != null && attempt.items_succeeded < attempt.items_total;

      // Fetch full order data so callers get grace_period_ends_at and orders array
      let orders: any[] = [];
      let gracePeriodEndsAt: string | null = null;
      if (attempt.attempt_type === "data_direct" && attempt.order_id) {
        // Fetch all orders created by this payment attempt from the event log
        const finalizedEvent = existingLog.find((e: any) => e.type === "finalized");
        if (finalizedEvent?.orders?.length) {
          orders = finalizedEvent.orders;
          gracePeriodEndsAt = orders[0]?.grace_period_ends_at || null;
        } else {
          // Fallback: fetch the primary order directly
          const { data: orderRow } = await supabase
            .from("orders")
            .select("id, short_id, grace_period_ends_at")
            .eq("id", attempt.order_id)
            .maybeSingle();
          if (orderRow) {
            orders = [{ order_id: orderRow.id, short_id: orderRow.short_id, grace_period_ends_at: orderRow.grace_period_ends_at }];
            gracePeriodEndsAt = orderRow.grace_period_ends_at;
          }
        }
      }

      return respond(200, {
        success: true,
        already_processed: true,
        status: attempt.status,
        order_id: attempt.order_id,
        purchase_id: attempt.purchase_id,
        short_id: orders[0]?.short_id || null,
        grace_period_ends_at: gracePeriodEndsAt,
        orders: orders.length > 0 ? orders : undefined,
        partial_failure: partial,
        items_succeeded: attempt.items_succeeded,
        items_total: attempt.items_total,
        message: partial
          ? `Payment partially completed: ${attempt.items_succeeded}/${attempt.items_total} items succeeded.`
          : "This payment was already processed.",
      });
    }

    // ── 3. Verify with Paystack ─────────────────────────────
    let txData = webhookTxData;
    let paystackTransactionId: string | null = attempt.paystack_transaction_id;

    if (!txData) {
      const { data: settingRow } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "paystack_secret_key")
        .single();
      const paystackSecretKey = settingRow?.value;
      if (!paystackSecretKey) {
        return respond(500, { success: false, error: "Paystack secret key not configured", message: "Payment configuration error." });
      }

      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${reference}`,
        { headers: { Authorization: `Bearer ${paystackSecretKey}` } }
      );
      const verifyData = await verifyRes.json();

      await supabase.from("payment_attempts").update({
        ...timestampUpdates,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", attempt.id);

      if (!verifyRes.ok || verifyData.data?.status !== "success") {
        const paystackStatus = verifyData.data?.status || "unknown";
        const isFinal = ["failed", "abandoned", "reversed"].includes(paystackStatus);

        if (isFinal || source === "recovery") {
          await supabase.from("payment_attempts").update({
            status: isFinal ? "failed" : "pending",
            error_message: `Paystack status: ${paystackStatus}`,
            paystack_response: verifyData.data || null,
            event_log: [...existingLog, { type: "verification_failed", source, paystack_status: paystackStatus, timestamp: new Date().toISOString() }],
            updated_at: new Date().toISOString(),
          }).eq("id", attempt.id);
        }

        return respond(400, {
          success: false,
          error: "Payment not successful",
          paystack_status: paystackStatus,
          status: isFinal ? "failed" : "pending",
          message: `Payment status from Paystack: ${paystackStatus}.`,
        });
      }

      txData = verifyData.data;
      paystackTransactionId = txData.id?.toString() || null;
    }

    // ── 4. Validate amount/currency/customer ────────────────
    const paidAmountKobo = txData.amount;
    const paidAmount = paidAmountKobo / 100;
    const paidCurrency = (txData.currency || "GHS").toUpperCase();
    const expectedCurrency = (attempt.currency || "GHS").toUpperCase();
    const expectedPaystackTotal = attempt.metadata?.paystack_total ?? attempt.amount;

    // Tolerance: allow 1% or GHS 0.50 drift for rounding
    const amountDiff = Math.abs(paidAmount - expectedPaystackTotal);
    const amountTolerance = Math.max(expectedPaystackTotal * 0.01, 0.50);

    if (paidCurrency !== expectedCurrency) {
      console.error(`[finalize-payment] Currency mismatch: paid=${paidCurrency} expected=${expectedCurrency} ref=${reference}`);
      await supabase.from("payment_attempts").update({
        status: "needs_review",
        error_message: `Currency mismatch: paid ${paidCurrency}, expected ${expectedCurrency}`,
        paystack_response: txData,
        paystack_transaction_id: paystackTransactionId,
        ...timestampUpdates,
        event_log: [...existingLog, { type: "validation_failed", reason: "currency_mismatch", source, paid: paidCurrency, expected: expectedCurrency, timestamp: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      }).eq("id", attempt.id);

      // Admin alert
      await createAdminAlert(supabase, "Currency Mismatch", `Payment ref ${reference}: paid ${paidCurrency}, expected ${expectedCurrency}. Amount: GHS ${paidAmount}`, reference);

      return respond(400, { success: false, error: "Currency mismatch", status: "needs_review", message: "Payment currency does not match expected currency." });
    }

    if (amountDiff > amountTolerance) {
      console.error(`[finalize-payment] Amount mismatch: paid=${paidAmount} expected=${expectedPaystackTotal} diff=${amountDiff} ref=${reference}`);
      await supabase.from("payment_attempts").update({
        status: "needs_review",
        error_message: `Amount mismatch: paid GHS ${paidAmount}, expected GHS ${expectedPaystackTotal} (diff: ${amountDiff.toFixed(2)})`,
        paystack_response: txData,
        paystack_transaction_id: paystackTransactionId,
        ...timestampUpdates,
        event_log: [...existingLog, { type: "validation_failed", reason: "amount_mismatch", source, paid: paidAmount, expected: expectedPaystackTotal, diff: amountDiff, timestamp: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      }).eq("id", attempt.id);

      await createAdminAlert(supabase, "Amount Mismatch", `Payment ref ${reference}: paid GHS ${paidAmount}, expected GHS ${expectedPaystackTotal} (diff: ${amountDiff.toFixed(2)})`, reference);

      return respond(400, { success: false, error: "Amount mismatch", status: "needs_review", message: `Paid amount (GHS ${paidAmount}) does not match expected (GHS ${expectedPaystackTotal}).` });
    }

    // Validate customer from metadata if available (skip for guest orders)
    const webhookCustomerId = txData.metadata?.customer_id;
    const isGuestAttempt = attempt.buyer_type === "guest";
    if (!isGuestAttempt && webhookCustomerId && webhookCustomerId !== attempt.customer_id) {
      console.error(`[finalize-payment] Customer mismatch: webhook=${webhookCustomerId} attempt=${attempt.customer_id} ref=${reference}`);
      await supabase.from("payment_attempts").update({
        status: "needs_review",
        error_message: `Customer mismatch: webhook ${webhookCustomerId} vs attempt ${attempt.customer_id}`,
        paystack_response: txData,
        paystack_transaction_id: paystackTransactionId,
        ...timestampUpdates,
        event_log: [...existingLog, { type: "validation_failed", reason: "customer_mismatch", source, timestamp: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      }).eq("id", attempt.id);

      await createAdminAlert(supabase, "Customer Mismatch", `Payment ref ${reference}: webhook customer ${webhookCustomerId} vs attempt ${attempt.customer_id}`, reference);

      return respond(400, { success: false, error: "Customer mismatch", status: "needs_review", message: "Payment customer does not match the checkout record." });
    }

    // ── 5. Optimistic lock: only accept safe starting statuses ─
    // "abandoned" is included because Mobile Money charges in Ghana sometimes get
    // approved by the customer AFTER our system has marked the attempt abandoned
    // (popup closed, or recovery sweep gave up). Once Paystack reports success, we
    // must still honor the payment and create the order/credit the wallet.
    const lockableStatuses = ["pending", "needs_review", "failed", "abandoned"];
    if (!lockableStatuses.includes(attempt.status) && attempt.status !== "processing") {
      // Status is not lockable and not processing — already terminal or unknown
      return respond(409, { success: false, error: "Payment cannot be finalized from current status", status: attempt.status, message: `Payment is in '${attempt.status}' state.` });
    }

    // For "processing" status, only allow re-entry from recovery/admin after staleness (>10 min)
    if (attempt.status === "processing") {
      const processingAge = Date.now() - new Date(attempt.updated_at).getTime();
      if (processingAge < 10 * 60 * 1000 && source !== "admin") {
        console.log(`[finalize-payment] Still processing (${Math.round(processingAge / 1000)}s old), skipping ref=${reference}`);
        return respond(409, { success: false, error: "Payment is being processed by another request", message: "Please wait, payment is being finalized." });
      }
      // Stale processing — allow recovery/admin to re-lock
      console.log(`[finalize-payment] Stale processing detected (${Math.round(processingAge / 1000)}s), allowing re-entry ref=${reference} source=${source}`);
    }

    const { data: lockResult } = await supabase
      .from("payment_attempts")
      .update({
        status: "processing",
        ...timestampUpdates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id)
      .eq("status", attempt.status)
      .select("id")
      .maybeSingle();

    if (!lockResult) {
      console.log(`[finalize-payment] Concurrent finalization detected ref=${reference}`);
      const { data: refetched } = await supabase
        .from("payment_attempts")
        .select("status, order_id, purchase_id, items_succeeded, items_total")
        .eq("id", attempt.id)
        .single();
      if (refetched?.status === "completed" || refetched?.status === "partially_completed") {
        const partial = refetched.items_total != null && refetched.items_succeeded != null && refetched.items_succeeded < refetched.items_total;
        return respond(200, {
          success: true,
          already_processed: true,
          status: refetched.status,
          order_id: refetched.order_id,
          purchase_id: refetched.purchase_id,
          partial_failure: partial,
          message: "Payment already processed by another request.",
        });
      }
      return respond(409, { success: false, error: "Payment is being processed by another request", message: "Please wait, payment is being finalized." });
    }

    // ── 6. Finalize based on attempt_type ───────────────────
    try {
      if (attempt.attempt_type === "data_direct") {
        return await finalizeDataDirect(supabase, attempt, txData, paystackTransactionId, existingLog, source, timestampUpdates);
      } else if (attempt.attempt_type === "checker_direct") {
        return await finalizeCheckerDirect(supabase, attempt, txData, paystackTransactionId, existingLog, source, timestampUpdates);
      } else {
        await supabase.from("payment_attempts").update({
          status: "needs_review",
          error_message: `Unknown attempt_type: ${attempt.attempt_type}`,
          updated_at: new Date().toISOString(),
        }).eq("id", attempt.id);
        return respond(400, { success: false, error: "Unknown payment type", status: "needs_review", message: "Could not determine payment type." });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown finalization error";
      console.error(`[finalize-payment] Finalization error ref=${reference}:`, e);
      await supabase.from("payment_attempts").update({
        status: "failed",
        error_message: errMsg,
        event_log: [...existingLog, { type: "finalization_error", source, error: errMsg, timestamp: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      }).eq("id", attempt.id);
      return respond(500, { success: false, error: errMsg, status: "failed", message: "An error occurred while finalizing your payment." });
    }
  } catch (error) {
    console.error("[finalize-payment] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return respond(500, { success: false, error: msg, message: "Unexpected error processing payment." });
  }
});

function respond(status: number, data: Record<string, any>): Response {
  return new Response(JSON.stringify(data), { status, headers: h });
}

/** Create an admin notification for payment anomalies */
async function createAdminAlert(supabase: any, title: string, message: string, reference: string) {
  try {
    await supabase.from("notifications").insert({
      target_type: "admin",
      target_id: null,
      type: "failure",
      title: `⚠️ Payment Alert: ${title}`,
      message,
      metadata: { paystack_reference: reference, alert_type: "payment_anomaly" },
    });
  } catch (e) {
    console.error("[finalize-payment] Failed to create admin alert:", e);
  }
}

/**
 * Auto-compensate partial bulk-order failures.
 * - Registered: credit wallet for the failed-item portion (idempotent via PSK-{ref}-partial-refund).
 * - Guest: insert a refund row with status=refund_pending for admin to process via Paystack/MoMo.
 * Returns refund summary or null if nothing to do.
 */
async function compensatePartialFailure(
  supabase: any,
  attempt: any,
  items: any[],
  itemResults: any[],
  isGuest: boolean,
  reference: string,
  source: string,
  duplicateBlocked: boolean = false,
): Promise<{ method: string; amount: number; status: string } | null> {
  // Sum failed-item prices only
  const failedAmount = itemResults.reduce((sum: number, r: any) => {
    if (!r.success && items[r.index]) {
      return sum + Number(items[r.index].price || 0);
    }
    return sum;
  }, 0);

  if (failedAmount <= 0) return null;

  const refundRef = `PSK-${reference}-partial-refund`;
  const failedCount = itemResults.filter((r: any) => !r.success).length;
  const tag = duplicateBlocked ? "Duplicate-recipient block" : "Partial bulk failure";
  const reasonText = duplicateBlocked
    ? `Duplicate-recipient block: ${failedCount} of ${items.length} item(s) had an active order already in the system — payment auto-refunded.`
    : `Partial bulk failure: ${failedCount} of ${items.length} items failed`;

  // Idempotency: bail if a refund row for this attempt already exists
  const { data: existingRefund } = await supabase
    .from("refunds")
    .select("id, status, refund_method, refund_amount")
    .eq("payment_attempt_id", attempt.id)
    .maybeSingle();

  if (existingRefund) {
    console.log(`[finalize-payment] Refund already exists for attempt ${attempt.id}`);
    return {
      method: existingRefund.refund_method,
      amount: Number(existingRefund.refund_amount),
      status: existingRefund.status,
    };
  }

  if (isGuest) {
    // Guest / store: queue a Paystack-method refund for admin to process via MoMo
    const { error: refErr } = await supabase.from("refunds").insert({
      order_id: attempt.order_id || "00000000-0000-0000-0000-000000000000",
      payment_attempt_id: attempt.id,
      customer_id: null,
      buyer_type: "guest",
      refund_method: "paystack",
      refund_amount: failedAmount,
      amount_paid: failedAmount,
      data_value: failedAmount,
      paystack_reference: reference,
      status: "refund_pending",
      refund_reason: reasonText,
      initiated_by: `finalize-payment:${source}${duplicateBlocked ? ":duplicate_block" : ""}`,
    });
    if (refErr) {
      console.error("[finalize-payment] Guest refund insert error:", refErr);
      return null;
    }
    return { method: "paystack", amount: failedAmount, status: "refund_pending" };
  }

  // Registered: atomically credit wallet for the failed portion
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, wallet_balance")
    .eq("id", attempt.customer_id)
    .single();

  if (custErr || !customer) {
    console.error("[finalize-payment] Customer not found for refund:", custErr);
    return null;
  }

  const { data: existingTxn } = await supabase
    .from("wallet_transactions")
    .select("id")
    .eq("reference", refundRef)
    .eq("type", "credit")
    .maybeSingle();

  const walletDescription = duplicateBlocked
    ? `Paystack refund → wallet (duplicate-recipient block, ref ${reference})`
    : `Paystack refund → wallet — ${failedCount} failed item(s) in bulk order`;

  if (!existingTxn) {
    const newBalance = Number(customer.wallet_balance) + failedAmount;
    const { error: balErr } = await supabase
      .from("customers")
      .update({ wallet_balance: newBalance })
      .eq("id", customer.id);
    if (balErr) {
      console.error("[finalize-payment] Wallet balance update error:", balErr);
      return null;
    }
    const { error: txnErr } = await supabase.from("wallet_transactions").insert({
      customer_id: customer.id,
      type: "credit",
      amount: failedAmount,
      description: walletDescription,
      reference: refundRef,
    });
    if (txnErr) {
      console.error("[finalize-payment] Refund wallet_transactions insert error:", txnErr);
    }
  }

  await supabase.from("refunds").insert({
    order_id: attempt.order_id || "00000000-0000-0000-0000-000000000000",
    payment_attempt_id: attempt.id,
    customer_id: customer.id,
    buyer_type: "registered",
    refund_method: "wallet",
    refund_amount: failedAmount,
    amount_paid: failedAmount,
    data_value: failedAmount,
    paystack_reference: reference,
    status: "refunded",
    total_refunded: failedAmount,
    refund_reason: reasonText,
    initiated_by: `finalize-payment:${source}${duplicateBlocked ? ":duplicate_block" : ""}`,
  }).catch((e: any) => console.error("[finalize-payment] Refund row error (non-fatal):", e));

  // Notify customer
  const notifTitle = duplicateBlocked ? "Refund credited (duplicate order blocked)" : "Partial refund credited";
  const notifMsg = duplicateBlocked
    ? `GHS ${failedAmount.toFixed(2)} from your Paystack payment was refunded to your wallet because the recipient already had an active order.`
    : `GHS ${failedAmount.toFixed(2)} refunded to your wallet for failed item(s) in your recent bulk order.`;
  await supabase.from("notifications").insert({
    target_type: "customer",
    target_id: customer.id,
    type: "wallet",
    title: notifTitle,
    message: notifMsg,
    metadata: { paystack_reference: reference, refund_amount: failedAmount, alert_type: duplicateBlocked ? "duplicate_block_refund" : "partial_refund", source: "paystack" },
  }).catch(() => {});

  return { method: "wallet", amount: failedAmount, status: "refunded" };
}

async function finalizeDataDirect(
  supabase: any,
  attempt: any,
  txData: any,
  paystackTransactionId: string | null,
  existingLog: any[],
  source: string,
  timestampUpdates: Record<string, any>,
): Promise<Response> {
  const items = attempt.metadata?.items || [];
  const network = attempt.metadata?.network;
  const reference = attempt.paystack_reference;

  // Safety: if items array is empty, the payment cannot be finalized — metadata is incomplete
  if (!items.length || !network) {
    console.error(`[finalize-payment] data_direct has no items or network in metadata ref=${reference}`);
    await supabase.from("payment_attempts").update({
      status: "needs_review",
      error_message: "Missing order items or network in payment metadata — cannot create orders",
      event_log: [...existingLog, { type: "finalization_failed", source, reason: "empty_items_metadata", timestamp: new Date().toISOString() }],
      ...timestampUpdates,
      updated_at: new Date().toISOString(),
    }).eq("id", attempt.id);

    await createAdminAlert(supabase, "Missing Order Metadata", `Payment ref ${reference} has no items/network in metadata. Order cannot be created automatically — needs manual review.`, reference);

    return respond(400, {
      success: false,
      error: "Payment metadata incomplete",
      status: "needs_review",
      message: "Your payment was received but order details are missing. Please contact support.",
    });
  }

  const createdOrders: any[] = [];
  const itemResults: any[] = [];
  const isGuest = attempt.buyer_type === "guest";
  const affiliateCode = attempt.affiliate_code || attempt.metadata?.affiliate_code || "";
  const buyerPhone = attempt.buyer_phone || attempt.metadata?.buyer_phone || "";
  const buyerEmail = attempt.buyer_email || attempt.metadata?.buyer_email || "";

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ref = items.length > 1 ? `${reference}-${i}` : reference;

    try {
      let orderResult: any;
      let orderErr: any;

      if (isGuest) {
        // Guest order — use the guest-specific function (no customer_id needed)
        const rpcRes = await supabase.rpc("place_order_guest_paystack", {
          p_network: network,
          p_bundle_size: item.bundleLabel,
          p_recipient_phone: item.phone,
          p_quantity: 1,
          p_total_amount: item.price,
          p_payment_reference: `PSK-${ref}`,
          p_buyer_phone: buyerPhone,
          p_buyer_email: buyerEmail,
          p_affiliate_code: affiliateCode,
          p_cost_price: 0,
          p_delivery_mode: "manual",
          p_provider_name: "",
        });
        orderResult = rpcRes.data;
        orderErr = rpcRes.error;
      } else {
        // Registered user order — existing flow
        const rpcRes = await supabase.rpc("place_order_paystack", {
          p_customer_id: attempt.customer_id,
          p_network: network,
          p_bundle_size: item.bundleLabel,
          p_recipient_phone: item.phone,
          p_quantity: 1,
          p_total_amount: item.price,
          p_payment_reference: `PSK-${ref}`,
          p_cost_price: 0,
          p_delivery_mode: "manual",
          p_provider_name: "",
        });
        orderResult = rpcRes.data;
        orderErr = rpcRes.error;
      }

      if (orderErr) {
        console.error(`[finalize-payment] place_order error item ${i} (guest=${isGuest}):`, orderErr);
        itemResults.push({ index: i, success: false, error: orderErr.message });
        continue;
      }

      const result = orderResult as any;
      if (result?.already_processed) {
        createdOrders.push({ order_id: result.order_id, short_id: result.short_id, tracking_token: result.tracking_token, already_existed: true });
        itemResults.push({ index: i, success: true, already_processed: true, order_id: result.order_id });
      } else if (result?.order_id) {
        createdOrders.push({ order_id: result.order_id, short_id: result.short_id, grace_period_ends_at: result.grace_period_ends_at, tracking_token: result.tracking_token });
        itemResults.push({ index: i, success: true, order_id: result.order_id });
      } else if (result?.error) {
        itemResults.push({ index: i, success: false, error: result.error });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      console.error(`[finalize-payment] Error processing data_direct item ${i}:`, e);
      itemResults.push({ index: i, success: false, error: errMsg });
    }
  }

  const succeededCount = itemResults.filter(r => r.success).length;
  const allSucceeded = succeededCount === items.length;
  const anySucceeded = succeededCount > 0;
  const partialFailure = anySucceeded && !allSucceeded;
  const finalStatus = allSucceeded ? "completed" : anySucceeded ? "partially_completed" : "failed";

  await supabase.from("payment_attempts").update({
    status: finalStatus,
    finalized_at: new Date().toISOString(),
    finalized_by: source,
    order_id: createdOrders[0]?.order_id || null,
    paystack_transaction_id: paystackTransactionId,
    paystack_response: txData,
    items_succeeded: succeededCount,
    items_total: items.length,
    error_message: allSucceeded ? null : `${items.length - succeededCount}/${items.length} items failed`,
    event_log: [...existingLog, {
      type: "finalized",
      source,
      orders: createdOrders,
      item_results: itemResults,
      timestamp: new Date().toISOString(),
    }],
    ...timestampUpdates,
    updated_at: new Date().toISOString(),
  }).eq("id", attempt.id);

  // Auto-compensate any failed items (partial OR full failure, e.g. duplicate-recipient block)
  const anyFailed = succeededCount < items.length;
  let partialRefund: { method: string; amount: number; status: string } | null = null;
  if (anyFailed) {
    const duplicateBlocked = itemResults.some((r: any) => !r.success && /DUPLICATE_PENDING/i.test(String(r.error || '')));
    try {
      partialRefund = await compensatePartialFailure(
        supabase,
        attempt,
        items,
        itemResults,
        isGuest,
        reference,
        source,
        duplicateBlocked,
      );
    } catch (e) {
      console.error(`[finalize-payment] Refund error ref=${reference}:`, e);
    }

    const refundLine = partialRefund
      ? ` Refund: ${partialRefund.method} GHS ${partialRefund.amount.toFixed(2)} (${partialRefund.status}).`
      : ' Auto-refund FAILED — manual action required.';
    const title = duplicateBlocked
      ? "Order Blocked — Duplicate Recipient"
      : (partialFailure ? "Partial Order Failure" : "Order Failed");
    await createAdminAlert(
      supabase,
      title,
      `Order ref ${reference}: ${succeededCount}/${items.length} items succeeded. ${items.length - succeededCount} failed${duplicateBlocked ? ' (duplicate recipient blocked — payment auto-refunded)' : ''}.${refundLine}`,
      reference,
    );
  }

  // Send confirmation emails (fire & forget)
  for (let i = 0; i < createdOrders.length; i++) {
    const order = createdOrders[i];
    const item = items[i];
    if (item && order && !order.already_existed) {
      supabase.functions.invoke("send-transactional-email", {
        body: {
          template: "order-confirmation",
          customer_id: attempt.customer_id,
          data: { short_id: order.short_id, recipient_phone: item.phone, network, bundle_size: item.bundleLabel, total_amount: item.price },
        },
      }).catch(() => {});
    }
  }

  // Send guest payment confirmation SMS with tracking info (buyer phone only).
  // Skip entirely if this order originated from a store — store buyers receive no SMS.
  if (isGuest && buyerPhone && createdOrders.length > 0) {
    const firstOrder = createdOrders[0];
    const { data: storeLink } = await supabase.from("store_orders").select("id").eq("order_id", firstOrder.order_id).maybeSingle();
    if (!storeLink) {
      const orderIds = createdOrders.map((o: any) => o.short_id).join(", ");
      const trackingToken = firstOrder.tracking_token || "";
      const trackingUrl = trackingToken ? `https://buy-data360.com/guest/track?token=${trackingToken}` : "";
      const trackingLine = trackingUrl
        ? `\nTrack your order here: ${trackingUrl}`
        : "";
      const smsMessage = `Your order has been placed successfully.\nOrder ID: ${orderIds}${trackingLine}`;
      supabase.functions.invoke("send-sms", {
        body: {
          to: buyerPhone,
          message: smsMessage,
          event_type: "guest_payment_confirmed",
          related_order_id: firstOrder.order_id,
          idempotency_key: `guest_confirm_${reference}`,
        },
      }).catch((e: any) => console.error("Guest confirmation SMS error:", e));
    }
  }

  console.log(`[finalize-payment] data_direct ${finalStatus}: ${succeededCount}/${items.length} orders, ref=${reference}, source=${source}`);

  return respond(200, {
    success: anySucceeded,
    finalized: true,
    status: finalStatus,
    partial_failure: partialFailure,
    items_succeeded: succeededCount,
    items_total: items.length,
    orders: createdOrders,
    item_results: itemResults,
    order_id: createdOrders[0]?.order_id,
    short_id: createdOrders[0]?.short_id,
    grace_period_ends_at: createdOrders[0]?.grace_period_ends_at,
    message: allSucceeded
      ? `All ${items.length} order(s) placed successfully.`
      : anySucceeded
        ? `${succeededCount}/${items.length} orders placed. Some items failed — contact support.`
        : "All order items failed to process.",
  });
}

// ── Checker Direct Finalization ─────────────────────────────

async function finalizeCheckerDirect(
  supabase: any,
  attempt: any,
  txData: any,
  paystackTransactionId: string | null,
  existingLog: any[],
  source: string,
  timestampUpdates: Record<string, any>,
): Promise<Response> {
  const { product_id, quantity, sms_phone } = attempt.metadata || {};
  const reference = attempt.paystack_reference;

  const { data: purchaseResult, error: purchaseErr } = await supabase.rpc("purchase_checker_paystack", {
    p_customer_id: attempt.customer_id,
    p_product_id: product_id,
    p_payment_reference: `PSK-${reference}`,
    p_sms_phone: sms_phone || "",
    p_quantity: Math.max(1, parseInt(quantity) || 1),
  });

  if (purchaseErr) {
    console.error("[finalize-payment] purchase_checker_paystack error:", purchaseErr);
    await supabase.from("payment_attempts").update({
      status: "failed",
      error_message: purchaseErr.message,
      paystack_transaction_id: paystackTransactionId,
      paystack_response: txData,
      ...timestampUpdates,
      event_log: [...existingLog, { type: "finalization_failed", source, error: purchaseErr.message, timestamp: new Date().toISOString() }],
      updated_at: new Date().toISOString(),
    }).eq("id", attempt.id);
    return respond(500, { success: false, error: purchaseErr.message, status: "failed", message: "Failed to assign checker codes." });
  }

  const result = purchaseResult as any;

  if (result && !result.success && !result.already_processed) {
    await supabase.from("payment_attempts").update({
      status: "failed",
      error_message: result.error || "Purchase failed",
      paystack_transaction_id: paystackTransactionId,
      paystack_response: txData,
      ...timestampUpdates,
      event_log: [...existingLog, { type: "finalization_failed", source, error: result.error, timestamp: new Date().toISOString() }],
      updated_at: new Date().toISOString(),
    }).eq("id", attempt.id);
    return respond(400, { success: false, error: result.error || "Purchase failed", status: "failed", message: result.error || "Could not complete checker purchase." });
  }

  await supabase.from("payment_attempts").update({
    status: "completed",
    finalized_at: new Date().toISOString(),
    finalized_by: source,
    purchase_id: result?.purchase_id || null,
    paystack_transaction_id: paystackTransactionId,
    paystack_response: txData,
    items_succeeded: 1,
    items_total: 1,
    ...timestampUpdates,
    event_log: [...existingLog, { type: "finalized", source, result, timestamp: new Date().toISOString() }],
    updated_at: new Date().toISOString(),
  }).eq("id", attempt.id);

  console.log(`[finalize-payment] checker_direct completed ref=${reference}, source=${source}`);

  // Send checker SMS if sms_phone was provided
  if (sms_phone && result?.codes && !result?.already_processed) {
    const codes = Array.isArray(result.codes) ? result.codes : [];
    const codeLines = codes.map((c: any) => `${c.serial_number} - ${c.pin}`).join("\n");
    const smsMessage = `Your ${result.product_name || "Checker"} code(s):\n\n${codeLines}\n\nPlease keep these details safe.`;
    supabase.functions.invoke("send-sms", {
      body: {
        to: sms_phone,
        message: smsMessage,
        event_type: "checker_purchase",
        related_purchase_id: result.purchase_id,
        customer_id: attempt.customer_id,
        idempotency_key: `checker_${result.purchase_id}`,
      },
    }).then(async () => {
      // Update sms_status on the purchase
      await supabase.from("checker_purchases").update({ sms_status: "sent" }).eq("id", result.purchase_id);
    }).catch(async (e: any) => {
      console.error("[finalize-payment] Checker SMS error:", e);
      await supabase.from("checker_purchases").update({ sms_status: "failed" }).eq("id", result.purchase_id);
    });
  }

  return respond(200, {
    success: true,
    finalized: true,
    status: "completed",
    partial_failure: false,
    purchase_id: result?.purchase_id,
    short_id: result?.short_id,
    product_name: result?.product_name,
    amount: result?.amount,
    quantity: result?.quantity,
    codes: result?.codes,
    already_processed: result?.already_processed || false,
    message: result?.already_processed ? "Checker codes already assigned." : "Checker codes assigned successfully.",
  });
}
