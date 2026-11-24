import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Unified automatic refund processor.
 *
 * Trigger: a provider (Portal-02 / iGet) confirmed the order was refunded on
 * their side, or an admin retries a stuck refund.
 *
 * Destination policy (account-based, NOT buyer_type):
 *   • Buyer has a platform wallet  → wallet credit (even if paid via Paystack).
 *   • No wallet (guest/store link) → Paystack refund on the original payment.
 *   • Paystack impossible/failed   → parked as `failed`; admin may approve the
 *                                    MoMo fallback using the captured number.
 *
 * The DB function `handle_provider_refund` is the single source of truth for
 * idempotency: it locks the order, refuses a second live refund and performs
 * the wallet credit atomically with the ledger entry.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      order_id,
      provider_reference = "",
      provider_name = "Portal-02",
      amount = null,
      reason = "Provider confirmed refund",
      access_token,
    } = body ?? {};

    if (!order_id) return json({ error: "Missing order_id" }, 400);

    // ── Auth: service-role caller, or an authenticated admin ──
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    let authorized = bearer === serviceKey;

    if (!authorized) {
      const token = access_token || bearer;
      if (token) {
        const { data: userRes } = await supabase.auth.getUser(token);
        const uid = userRes?.user?.id;
        if (uid) {
          const { data: adminRow } = await supabase
            .from("admin_users")
            .select("id")
            .eq("auth_user_id", uid)
            .eq("status", "active")
            .maybeSingle();
          authorized = !!adminRow;
        }
      }
    }
    if (!authorized) return json({ error: "Not authorized" }, 403);

    // ── 1. Atomic decision + wallet path ──
    const { data: result, error: rpcErr } = await supabase.rpc("handle_provider_refund", {
      p_order_id: order_id,
      p_provider_reference: provider_reference,
      p_provider_name: provider_name,
      p_amount: amount,
      p_reason: reason,
    });

    if (rpcErr) {
      console.error("[process-order-refund] rpc error:", rpcErr);
      return json({ error: rpcErr.message }, 500);
    }
    if (!result?.success) {
      return json({ success: false, error: result?.error || "REFUND_FAILED" }, 400);
    }

    console.log(JSON.stringify({ event: "refund_decision", order_id, ...result }));

    const { data: order } = await supabase
      .from("orders")
      .select("id, short_id, recipient_phone, buyer_phone, buyer_type, total_amount, payment_reference, customer_id")
      .eq("id", order_id)
      .maybeSingle();

    const maskPhone = (p: string) =>
      p && p.length >= 6 ? `${p.slice(0, 4)}****${p.slice(-2)}` : p || "";

    if (result.duplicate) {
      return json({ success: true, duplicate: true, ...result });
    }

    // ── 2. Wallet path already completed inside the RPC ──
    if (result.destination === "wallet") {
      if (order) {
        const { data: cust } = await supabase
          .from("customers")
          .select("phone")
          .eq("id", result.customer_id)
          .maybeSingle();
        const { data: storeLink } = await supabase
          .from("store_orders").select("id").eq("order_id", order_id).maybeSingle();
        if (cust?.phone && !storeLink) {
          supabase.functions.invoke("send-sms", {
            body: {
              to: cust.phone,
              message: `GHS ${Number(result.amount).toFixed(2)} has been refunded to your wallet. Your order for ${maskPhone(order.recipient_phone)} could not be completed.`,
              event_type: "refund_successful",
              related_order_id: order_id,
              customer_id: result.customer_id,
              idempotency_key: `refund_wallet_${order_id}`,
            },
          }).catch((e: unknown) => console.error("refund SMS error:", e));
        }
      }
      return json({ success: true, ...result });
    }

    // ── 3. Paystack path ──
    const refundId = result.refund_id as string;
    const touch = async (patch: Record<string, unknown>, event: string, detail: string) => {
      const { data: cur } = await supabase.from("refunds").select("timeline").eq("id", refundId).maybeSingle();
      const timeline = Array.isArray(cur?.timeline) ? cur!.timeline : [];
      await supabase.from("refunds").update({
        ...patch,
        timeline: [...timeline, { at: new Date().toISOString(), event, detail }],
      }).eq("id", refundId);
    };

    // Backfill the MoMo fallback number captured at guest checkout, so admins
    // always have a payout destination if the Paystack refund can't go through.
    try {
      const { data: refundRow } = await supabase
        .from("refunds").select("momo_number").eq("id", refundId).maybeSingle();
      if (!refundRow?.momo_number) {
        const { data: attemptMeta } = await supabase
          .from("payment_attempts")
          .select("metadata, buyer_phone")
          .eq("order_id", order_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const fallback =
          (attemptMeta?.metadata as Record<string, unknown> | null)?.refund_momo_number ||
          attemptMeta?.buyer_phone || order?.buyer_phone || "";
        if (fallback) {
          await supabase.from("refunds").update({ momo_number: String(fallback) }).eq("id", refundId);
        }
      }
    } catch (e) {
      console.error("[process-order-refund] momo backfill failed:", e);
    }

    const { data: settingRow } = await supabase
      .from("platform_settings").select("value").eq("key", "paystack_secret_key").maybeSingle();
    const secretKey = settingRow?.value || Deno.env.get("PAYSTACK_SECRET_KEY");

    if (!secretKey) {
      await touch(
        { status: "failed", error_message: "Paystack secret key not configured" },
        "failed", "Paystack secret key not configured — MoMo fallback required",
      );
      return json({ success: false, refund_id: refundId, error: "PAYSTACK_KEY_MISSING" }, 500);
    }

    await touch({ status: "processing", processed_at: new Date().toISOString() }, "processing", "Calling Paystack refund API");

    // Resolve a Paystack transaction identifier
    const { data: attempt } = await supabase
      .from("payment_attempts")
      .select("paystack_transaction_id, paystack_reference")
      .eq("order_id", order_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let txIdentifier = attempt?.paystack_transaction_id || "";
    const psRef = attempt?.paystack_reference || order?.payment_reference || result.paystack_reference || "";

    if (!txIdentifier && psRef) {
      const vres = await fetch(`https://api.paystack.co/transaction/verify/${psRef}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const vdata = await vres.json().catch(() => ({}));
      if (vres.ok && vdata?.data?.id) txIdentifier = String(vdata.data.id);
    }

    if (!txIdentifier) {
      await touch(
        { status: "failed", error_message: "No Paystack transaction found for this order" },
        "failed", "No Paystack transaction found — MoMo fallback required",
      );
      return json({ success: false, refund_id: refundId, error: "NO_PAYSTACK_TRANSACTION" }, 200);
    }

    const amountToRefund = Number(result.amount);
    const pres = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: txIdentifier, amount: Math.round(amountToRefund * 100) }),
    });
    const pdata = await pres.json().catch(() => ({}));

    if (!pres.ok || !pdata?.status) {
      await touch(
        {
          status: "failed",
          paystack_transaction_id: txIdentifier,
          paystack_response: pdata,
          error_message: pdata?.message || "Paystack refund API error",
        },
        "failed", pdata?.message || "Paystack refund API error",
      );
      return json({ success: false, refund_id: refundId, error: pdata?.message || "PAYSTACK_REFUND_FAILED" }, 200);
    }

    const processed = pdata?.data?.status === "processed";
    await touch(
      {
        status: processed ? "completed" : "processing",
        paystack_transaction_id: txIdentifier,
        paystack_refund_id: pdata?.data?.id ? String(pdata.data.id) : "",
        paystack_response: pdata,
        total_refunded: processed ? amountToRefund : 0,
        completed_at: processed ? new Date().toISOString() : null,
        error_message: "",
      },
      processed ? "completed" : "submitted",
      `Paystack refund ${processed ? "processed" : "pending settlement"}`,
    );

    // Notify the buyer (never store buyers)
    const { data: storeLink } = await supabase
      .from("store_orders").select("id").eq("order_id", order_id).maybeSingle();
    if (order?.buyer_phone && !storeLink) {
      supabase.functions.invoke("send-sms", {
        body: {
          to: order.buyer_phone,
          message: `GHS ${amountToRefund.toFixed(2)} has been refunded to your payment method. Your order for ${maskPhone(order.recipient_phone)} could not be completed.`,
          event_type: "refund_successful",
          related_order_id: order_id,
          idempotency_key: `refund_paystack_${order_id}`,
        },
      }).catch((e: unknown) => console.error("refund SMS error:", e));
    }

    return json({
      success: true,
      refund_id: refundId,
      destination: "paystack",
      status: processed ? "completed" : "processing",
      amount: amountToRefund,
    });
  } catch (error) {
    console.error("process-order-refund error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});
