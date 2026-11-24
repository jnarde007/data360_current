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

const CONFIRMED_REFUND_STATUSES = ["refunded", "completed"];
const REFUND_TERMINAL = ["rejected", "refunded"];

/**
 * Admin-only reprocess of a FAILED + CONFIRMED-REFUNDED wallet order.
 *
 * It creates NO new payment, refund or fulfillment mechanism: it simply calls
 * the existing `place_order` RPC on behalf of the customer, which performs the
 * wallet balance check, the atomic wallet debit + ledger entry, the network
 * availability check and the duplicate-recipient guard, then hands the new
 * order to the existing cron/deliver-order fulfillment path. If the new order
 * fails again, the existing auto-refund path refunds the new debit.
 *
 * The original order row is never reopened (terminal statuses stay terminal).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { order_id, access_token } = body ?? {};
    if (!order_id) return json({ error: "Missing order_id" }, 400);

    // ── Auth: active admin only ──
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const token = access_token || bearer;
    let adminId: string | null = null;
    if (token && token !== serviceKey) {
      const { data: userRes } = await supabase.auth.getUser(token);
      const uid = userRes?.user?.id;
      if (uid) {
        const { data: adminRow } = await supabase
          .from("admin_users").select("id").eq("auth_user_id", uid).eq("status", "active").maybeSingle();
        adminId = adminRow?.id ?? null;
      }
    }
    if (!adminId) return json({ error: "Not authorized" }, 403);

    // ── Load order ──
    const { data: order } = await supabase
      .from("orders").select("*").eq("id", order_id).maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);

    const deny = (reason: string) => json({ success: false, error: reason }, 400);

    if (order.status === "delivered") return deny("This order was delivered.");
    if ((order.buyer_type || "registered") !== "registered" || !order.customer_id) {
      return deny("Only registered wallet customers can be reprocessed.");
    }
    if ((order.payment_method || "wallet").toLowerCase() !== "wallet") {
      return deny("Paystack payments must be paid again by the customer.");
    }
    if (!REFUND_TERMINAL.includes(order.status) && order.status !== "failed") {
      return deny("The order is still active.");
    }
    if (order.provider_order_id || order.provider_reference) {
      return deny("Provider resolution is still pending on the original request.");
    }
    if (order.grace_period_ends_at && new Date(order.grace_period_ends_at).getTime() > Date.now()) {
      return deny("The grace period has not ended.");
    }

    // ── Refund must be CONFIRMED and returned to the wallet ──
    const { data: refund } = await supabase
      .from("refunds").select("id, status, refund_method, refund_amount, total_refunded")
      .eq("order_id", order_id).order("created_at", { ascending: false }).limit(1).maybeSingle();

    let refundConfirmed =
      !!refund && CONFIRMED_REFUND_STATUSES.includes(refund.status) && refund.refund_method === "wallet";

    if (!refundConfirmed) {
      // Legacy path: wallet credit written before the refunds ledger existed.
      const { data: legacy } = await supabase
        .from("wallet_transactions").select("id")
        .eq("customer_id", order.customer_id)
        .eq("type", "credit")
        .eq("reference", `REF-${order.short_id}`)
        .maybeSingle();
      refundConfirmed = !!legacy;
    }
    if (!refundConfirmed) return deny("Customer refund has not been confirmed.");

    // ── Not already reprocessed (audit log is the source of truth) ──
    const { data: priorLogs } = await supabase
      .from("admin_activity_logs").select("id")
      .eq("action", "order_reprocessed").eq("target_id", order_id);
    if (priorLogs && priorLogs.length > 0) {
      return deny("This order has already been reprocessed.");
    }

    // ── Network must currently be available for purchase ──
    const { data: netCfg } = await supabase
      .from("network_api_configs").select("available_for_purchase").eq("network", order.network).maybeSingle();
    if (!netCfg || netCfg.available_for_purchase !== true) {
      return deny("This network is currently halted.");
    }

    // ── Reuse the existing order placement / wallet debit mechanism ──
    const { data: placed, error: placeErr } = await supabase.rpc("place_order", {
      p_customer_id: order.customer_id,
      p_network: order.network,
      p_bundle_size: order.bundle_size,
      p_recipient_phone: order.recipient_phone,
      p_quantity: order.quantity,
      p_total_amount: Number(order.total_amount),
      p_cost_price: Number(order.cost_price || 0),
      p_delivery_mode: "manual",
      p_provider_name: "",
    });

    if (placeErr) {
      const msg = placeErr.message || "Reprocess failed";
      console.error("[reprocess-order] place_order error:", msg);
      if (/Insufficient wallet balance/i.test(msg)) {
        return deny("Customer wallet balance is not enough to cover this order.");
      }
      if (/DUPLICATE_PENDING/i.test(msg)) {
        return deny("This recipient already has an active order.");
      }
      if (/NETWORK_UNAVAILABLE/i.test(msg)) {
        return deny("This network is currently halted.");
      }
      return deny(msg);
    }

    const result = placed as { order_id: string; short_id: string; grace_period_ends_at: string };

    await supabase.from("admin_activity_logs").insert({
      admin_id: adminId,
      action: "order_reprocessed",
      target_type: "order",
      target_id: order_id,
      details: {
        original_short_id: order.short_id,
        new_order_id: result.order_id,
        new_short_id: result.short_id,
        amount: Number(order.total_amount),
        network: order.network,
        bundle_size: order.bundle_size,
        recipient_phone: order.recipient_phone,
        refund_id: refund?.id ?? null,
      },
    });

    console.log(JSON.stringify({
      event: "order_reprocessed",
      original: order.short_id, replacement: result.short_id, admin_id: adminId,
    }));

    return json({ success: true, ...result });
  } catch (error) {
    console.error("reprocess-order error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
