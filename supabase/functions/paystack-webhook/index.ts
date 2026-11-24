import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(sig) === signature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.text();
    const signature = req.headers.get("x-paystack-signature") || "";

    // Get Paystack secret key
    const { data: settingRow } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "paystack_secret_key")
      .single();

    const paystackSecret = settingRow?.value;
    if (!paystackSecret) {
      console.error("[paystack-webhook] Secret key not configured");
      return new Response(JSON.stringify({ error: "Not configured" }), { status: 500, headers: h });
    }

    // Verify webhook signature
    const valid = await verifySignature(body, signature, paystackSecret);
    if (!valid) {
      console.error("[paystack-webhook] Invalid signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401, headers: h });
    }

    const event = JSON.parse(body);
    console.log(`[paystack-webhook] event=${event.event} ref=${event.data?.reference}`);

    // ── Transfer events → payout pipeline ──
    if (event.event === "transfer.success" || event.event === "transfer.failed" || event.event === "transfer.reversed") {
      const td = event.data || {};
      const transferRef: string = td.reference || "";
      const transferCode: string = td.transfer_code || "";

      // Locate payout by either reference or transfer_code
      let payoutRow: any = null;
      if (transferRef) {
        const { data } = await supabase.from("payouts").select("id,status").eq("paystack_transfer_reference", transferRef).maybeSingle();
        payoutRow = data;
      }
      if (!payoutRow && transferCode) {
        const { data } = await supabase.from("payouts").select("id,status").eq("paystack_transfer_code", transferCode).maybeSingle();
        payoutRow = data;
      }
      if (!payoutRow) {
        console.warn(`[paystack-webhook] No payout found for transfer ref=${transferRef} code=${transferCode}`);
        return new Response(JSON.stringify({ received: true, no_match: true }), { status: 200, headers: h });
      }

      if (event.event === "transfer.success") {
        const { error } = await supabase.rpc("apply_payout_success", { p_payout_id: payoutRow.id, p_response: td });
        if (error) console.error("[paystack-webhook] apply_payout_success error:", error);
      } else {
        const newStatus = event.event === "transfer.reversed" ? "reversed" : "failed";
        const reason = td.reason || td.message || td.failures?.[0]?.message || "";
        const { error } = await supabase.rpc("apply_payout_failure", {
          p_payout_id: payoutRow.id,
          p_new_status: newStatus,
          p_reason: reason,
          p_response: td,
        });
        if (error) console.error("[paystack-webhook] apply_payout_failure error:", error);
      }

      return new Response(JSON.stringify({ received: true, payout_id: payoutRow.id, event: event.event }), { status: 200, headers: h });
    }

    // Only handle charge.success below
    if (event.event !== "charge.success") {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: h });
    }

    const txData = event.data;
    const reference = txData.reference;
    const metadata = txData.metadata || {};
    const txType = metadata.type || "";

    // ── Direct checkout payments → delegate to finalize-payment ──
    if (txType === "data_direct" || txType === "checker_direct") {
      const { data: attempt } = await supabase
        .from("payment_attempts")
        .select("id, status")
        .eq("paystack_reference", reference)
        .maybeSingle();

      if (!attempt) {
        // No exact match — try to find a matching pre-checkout attempt
        console.warn(`[paystack-webhook] No payment_attempt for ${txType} ref=${reference}, attempting smart match`);
        const customerId = metadata.customer_id || "";
        const buyerType = metadata.buyer_type || "";
        const buyerPhone = (metadata.buyer_phone || "").replace(/[^0-9]/g, "");

        let matchedAttempt: any = null;

        // For guest orders, match by buyer_phone; for registered, match by customer_id
        if (buyerType === "guest" && buyerPhone.length >= 9) {
          const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: candidates } = await supabase
            .from("payment_attempts")
            .select("*")
            .eq("buyer_type", "guest")
            .eq("buyer_phone", buyerPhone)
            .eq("attempt_type", txType)
            .eq("status", "pending")
            .gte("created_at", tenMinAgo)
            .order("created_at", { ascending: false })
            .limit(5);

          if (candidates?.length) {
            const paidAmount = txData.amount / 100;
            matchedAttempt = candidates.find((c: any) => {
              const expectedTotal = c.metadata?.paystack_total ?? c.amount;
              return Math.abs(expectedTotal - paidAmount) < 1;
            });
          }
        } else if (customerId) {
          const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: candidates } = await supabase
            .from("payment_attempts")
            .select("*")
            .eq("customer_id", customerId)
            .eq("attempt_type", txType)
            .eq("status", "pending")
            .gte("created_at", tenMinAgo)
            .order("created_at", { ascending: false })
            .limit(5);

          if (candidates?.length) {
            const paidAmount = txData.amount / 100;
            matchedAttempt = candidates.find((c: any) => {
              const expectedTotal = c.metadata?.paystack_total ?? c.amount;
              return Math.abs(expectedTotal - paidAmount) < 1;
            });
          }
        }

        if (matchedAttempt) {
          // High-confidence match found — update the original attempt's reference so finalize-payment can use it
          console.log(`[paystack-webhook] Matched orphan to pre-checkout attempt ${matchedAttempt.id} (original ref=${matchedAttempt.paystack_reference}), updating reference to ${reference}`);
          const matchLog = Array.isArray(matchedAttempt.event_log) ? matchedAttempt.event_log : [];
          await supabase.from("payment_attempts").update({
            paystack_reference: reference,
            webhook_received_at: new Date().toISOString(),
            paystack_transaction_id: txData.id?.toString(),
            event_log: [...matchLog, {
              type: "reference_remapped",
              original_reference: matchedAttempt.paystack_reference,
              paystack_reference: reference,
              source: "webhook",
              timestamp: new Date().toISOString(),
            }],
            updated_at: new Date().toISOString(),
          }).eq("id", matchedAttempt.id);

          // Now delegate to finalize-payment — the attempt now has the correct reference AND the items metadata
          try {
            const finalizeRes = await supabase.functions.invoke("finalize-payment", {
              body: { reference, source: "webhook", txData },
            });
            console.log(`[paystack-webhook] finalize-payment (remapped) result for ref=${reference}:`, finalizeRes.data);
          } catch (e) {
            console.error(`[paystack-webhook] finalize-payment invocation error (remapped) ref=${reference}:`, e);
          }

          return new Response(JSON.stringify({ received: true, remapped: true, matched_attempt: matchedAttempt.id }), { status: 200, headers: h });
        }

        // No match found — store as orphan for manual review
        const orphanCustomerId = customerId || "00000000-0000-0000-0000-000000000000";
        await supabase.from("payment_attempts").upsert({
          paystack_reference: reference,
          customer_id: orphanCustomerId,
          attempt_type: txType,
          status: "needs_review",
          amount: txData.amount / 100,
          metadata,
          buyer_type: buyerType || "registered",
          buyer_phone: buyerPhone,
          buyer_email: metadata.buyer_email || "",
          affiliate_code: metadata.affiliate_code || "",
          paystack_transaction_id: txData.id?.toString(),
          paystack_response: txData,
          webhook_received_at: new Date().toISOString(),
          error_message: "Webhook received but no pre-checkout record found — needs manual review",
          event_log: [{
            type: "webhook_orphan",
            matched_attempt_id: null,
            buyer_type: buyerType || "registered",
            timestamp: new Date().toISOString(),
          }],
        }, { onConflict: "paystack_reference" });

        // Admin alert for orphan
        try {
          await supabase.from("notifications").insert({
            target_type: "admin",
            target_id: null,
            type: "failure",
            title: "⚠️ Orphan Webhook Payment",
            message: `Paystack payment ref ${reference} (GHS ${txData.amount / 100}) has no matching checkout record. No match found — needs manual review.`,
            metadata: { paystack_reference: reference, alert_type: "orphan_webhook" },
          });
        } catch { /* non-fatal */ }

        return new Response(JSON.stringify({ received: true, needs_review: true }), { status: 200, headers: h });
      }

      if (attempt.status === "completed") {
        console.log(`[paystack-webhook] Already completed ref=${reference}`);
        return new Response(JSON.stringify({ received: true, already_processed: true }), { status: 200, headers: h });
      }

      // Delegate to finalize-payment with pre-verified txData
      try {
        const finalizeRes = await supabase.functions.invoke("finalize-payment", {
          body: { reference, source: "webhook", txData },
        });
        console.log(`[paystack-webhook] finalize-payment result for ref=${reference}:`, finalizeRes.data);
      } catch (e) {
        console.error(`[paystack-webhook] finalize-payment invocation error ref=${reference}:`, e);
      }

      return new Response(JSON.stringify({ received: true, delegated: true }), { status: 200, headers: h });
    }

    // ── Store order fallback (in case client onSuccess never fired) ──
    if (metadata.kind === "store_order" && metadata.store_slug) {
      const productKind = metadata.product_kind || "data";
      const recipientPhone = (metadata.recipient_phone || metadata.buyer_phone || "").toString();
      const buyerPhone = (metadata.buyer_phone || metadata.recipient_phone || "").toString();
      const buyerEmail = (metadata.buyer_email || txData.customer?.email || "").toString();
      const quantity = Number(metadata.quantity) || 1;

      try {
        if (productKind === "data") {
          const { data, error } = await supabase.rpc("place_store_order_paystack", {
            p_store_slug: metadata.store_slug,
            p_price_item_id: metadata.price_item_id,
            p_recipient_phone: recipientPhone,
            p_quantity: quantity,
            p_payment_reference: reference,
            p_buyer_phone: buyerPhone,
            p_buyer_email: buyerEmail,
          });
          console.log(`[paystack-webhook] store_order data fallback ref=${reference}`, { data, error });
        } else {
          const { data, error } = await supabase.rpc("place_store_checker_paystack", {
            p_store_slug: metadata.store_slug,
            p_checker_product_id: metadata.checker_product_id,
            p_quantity: quantity,
            p_payment_reference: reference,
            p_buyer_phone: buyerPhone,
            p_buyer_email: buyerEmail,
            p_sms_phone: recipientPhone,
          });
          console.log(`[paystack-webhook] store_order checker fallback ref=${reference}`, { data, error });
        }
      } catch (e) {
        console.error(`[paystack-webhook] store_order fallback error ref=${reference}:`, e);
      }
      return new Response(JSON.stringify({ received: true, store_order: true }), { status: 200, headers: h });
    }

    // ── AFA registration (paystack-direct) ─────────────────────────────
    // AFA charges must NEVER be credited as wallet top-ups. The AFA registration
    // is created synchronously by paystack-direct-afa from the client onSuccess.
    // If that failed, the record is still recoverable from afa_registrations by
    // payment_reference; either way, we acknowledge and stop here.
    if (txType === "afa" || (typeof reference === "string" && reference.startsWith("AFA-"))) {
      const { data: afaRow } = await supabase
        .from("afa_registrations")
        .select("id, short_id")
        .eq("payment_reference", reference)
        .maybeSingle();

      if (!afaRow) {
        try {
          await supabase.from("payment_attempts").upsert({
            paystack_reference: reference,
            customer_id: metadata.customer_id || "00000000-0000-0000-0000-000000000000",
            attempt_type: "afa",
            status: "needs_review",
            amount: txData.amount / 100,
            metadata,
            buyer_type: metadata.buyer_type || "registered",
            buyer_phone: (metadata.buyer_phone || "").replace(/[^0-9]/g, ""),
            buyer_email: metadata.buyer_email || txData.customer?.email || "",
            affiliate_code: metadata.affiliate_code || "",
            paystack_transaction_id: txData.id?.toString(),
            paystack_response: txData,
            webhook_received_at: new Date().toISOString(),
            error_message: "AFA Paystack charge with no afa_registrations row — manual review required",
            event_log: [{ type: "afa_orphan", timestamp: new Date().toISOString() }],
          }, { onConflict: "paystack_reference" });
        } catch (e) {
          console.error(`[paystack-webhook] AFA orphan flag failed ref=${reference}:`, e);
        }
      }
      return new Response(JSON.stringify({ received: true, afa: true, already_local: !!afaRow }), { status: 200, headers: h });
    }

    // ── Wallet top-up processing ─────────────────────────────
    // SAFETY: only credit the wallet when the payment is EXPLICITLY a wallet top-up.
    // Anything else (AFA, data, checker, store, unknown) must never become a wallet credit
    // — that's how we previously leaked GHS 15.30 per AFA-direct payment.
    const isWalletTopup =
      txType === "wallet_topup" ||
      metadata.purpose === "wallet_topup" ||
      metadata.credit_amount != null ||
      (Array.isArray(metadata.custom_fields) &&
        metadata.custom_fields.some((f: any) => f?.variable_name === "credit_amount"));

    if (!isWalletTopup) {
      console.warn(`[paystack-webhook] Untyped charge with no handler — flagging as orphan ref=${reference} type=${txType}`);
      try {
        await supabase.from("payment_attempts").upsert({
          paystack_reference: reference,
          customer_id: metadata.customer_id || "00000000-0000-0000-0000-000000000000",
          attempt_type: txType || "unknown",
          status: "needs_review",
          amount: txData.amount / 100,
          metadata,
          buyer_type: metadata.buyer_type || "registered",
          buyer_phone: (metadata.buyer_phone || "").replace(/[^0-9]/g, ""),
          buyer_email: metadata.buyer_email || txData.customer?.email || "",
          affiliate_code: metadata.affiliate_code || "",
          paystack_transaction_id: txData.id?.toString(),
          paystack_response: txData,
          webhook_received_at: new Date().toISOString(),
          error_message: "Charge.success with no matching local handler — needs manual review",
          event_log: [{ type: "untyped_orphan", tx_type: txType, timestamp: new Date().toISOString() }],
        }, { onConflict: "paystack_reference" });
      } catch (e) {
        console.error(`[paystack-webhook] untyped orphan flag failed ref=${reference}:`, e);
      }
      return new Response(JSON.stringify({ received: true, needs_review: true }), { status: 200, headers: h });
    }

    const pskRef = `PSK-${reference}`;

    // Fast idempotency check
    const { data: existingTx } = await supabase
      .from("wallet_transactions")
      .select("id")
      .eq("reference", pskRef)
      .eq("type", "credit")
      .limit(1);

    if (existingTx && existingTx.length > 0) {
      console.log(`[paystack-webhook] Already processed ref=${reference} (duplicate)`);
      return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: h });
    }

    const customerId = metadata.customer_id;
    let creditAmount: number | null = null;
    if (metadata.credit_amount != null && !isNaN(Number(metadata.credit_amount))) {
      creditAmount = Number(metadata.credit_amount);
    }
    if (creditAmount == null && Array.isArray(metadata.custom_fields)) {
      const cf = metadata.custom_fields.find((f: any) => f.variable_name === 'credit_amount');
      if (cf?.value != null && !isNaN(Number(cf.value))) {
        creditAmount = Number(cf.value);
      }
    }
    if (creditAmount == null) {
      creditAmount = txData.amount / 100;
      console.warn(`[paystack-webhook] No credit_amount in metadata, falling back to full amount ${creditAmount}`);
    }


    let customer: { id: string; wallet_balance: number } | null = null;

    if (customerId) {
      const { data } = await supabase
        .from("customers")
        .select("id, wallet_balance")
        .eq("id", customerId)
        .single();
      customer = data;
    }

    if (!customer && txData.customer?.email) {
      const { data } = await supabase
        .from("customers")
        .select("id, wallet_balance")
        .eq("email", txData.customer.email)
        .single();
      customer = data;
    }

    if (!customer) {
      console.error(`[paystack-webhook] Customer not found. customer_id=${customerId}, email=${txData.customer?.email}`);
      await supabase.from("topups").insert({
        amount: creditAmount,
        method: "paystack",
        network: "",
        momo_number: txData.customer?.email || reference,
        status: "pending",
        payment_reference: `PSK-${reference}`,
      });
      return new Response(JSON.stringify({ received: true, error: "Customer not found, recorded as pending" }), { status: 200, headers: h });
    }

    const { data: topupRow } = await supabase
      .from("topups")
      .select("short_id")
      .eq("customer_id", customer.id)
      .eq("method", "paystack")
      .eq("status", "approved")
      .eq("amount", creditAmount)
      .order("created_at", { ascending: false })
      .limit(1);
    const topupRef = topupRow?.[0]?.short_id || "";
    const description = topupRef
      ? `Wallet top-up via Paystack (${topupRef})`
      : `Wallet top-up via Paystack`;

    const { data: creditResult, error: creditErr } = await supabase.rpc("credit_wallet_paystack", {
      p_customer_id: customer.id,
      p_reference: pskRef,
      p_amount: creditAmount,
      p_description: description,
    });

    if (creditErr) {
      console.error("[paystack-webhook] credit_wallet_paystack error:", creditErr);
      return new Response(JSON.stringify({ received: true, error: "Failed to credit wallet" }), { status: 200, headers: h });
    }

    const result = creditResult as any;
    if (result?.already_processed) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: h });
    }
    if (result?.error) {
      return new Response(JSON.stringify({ received: true, error: result.error }), { status: 200, headers: h });
    }

    console.log(`[paystack-webhook] Credited GHS ${creditAmount} to customer ${customer.id}, ref=${reference}`);

    const topupShortId = topupRef || pskRef;
    supabase.functions.invoke("send-transactional-email", {
      body: {
        template: "wallet-topup",
        customer_id: customer.id,
        data: { amount: creditAmount, new_balance: result.new_balance, method: "Paystack", short_id: topupShortId },
      },
    }).catch((e: any) => console.error("Topup email error:", e));

    return new Response(JSON.stringify({ received: true, credited: true }), { status: 200, headers: h });
  } catch (error) {
    console.error("[paystack-webhook] error:", error);
    return new Response(JSON.stringify({ received: true, error: "Processing error" }), { status: 200, headers: h });
  }
});
