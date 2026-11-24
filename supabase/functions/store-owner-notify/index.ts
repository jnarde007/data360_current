// store-owner-notify
// Central function for every SMS sent to a store OWNER (never a store buyer).
// Triggered by:
//   - client (store_created, store_approved, store_rejected, store_withdrawal_requested,
//             store_withdrawal_paid, store_withdrawal_rejected, store_payout_failed,
//             store_suspended)
//   - DB trigger via net.http_post (store_new_order)
//   - send-profit-digests function (store_profit_digest)
//
// Edit live wording in /admin/stores → "SMS Templates". Each event uses a stable
// idempotency key so duplicate invocations are silently de-duplicated by
// send-sms.
//
// Notes:
//   • store_profit_available is intentionally NOT sent as SMS anymore — it is
//     surfaced as an in-app notification (handled by trg_store_owner_notify)
//     and rolled up into a daily SMS digest by send-profit-digests.
//   • First-sale congratulations is fired automatically by the store_new_order
//     handler when the store has only ever had one paid order.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type EventName =
  | "store_created"
  | "store_approved"
  | "store_rejected"
  | "store_new_order"          // DEPRECATED — kept for admin template compat, never SMSed
  | "store_first_sale"
  | "store_first_sale_only"    // Trigger-emitted — sends ONLY the first-sale SMS, no new-order SMS
  | "store_withdrawal_requested"
  | "store_withdrawal_paid"
  | "store_withdrawal_rejected"
  | "store_payout_failed"
  | "store_suspended"
  | "store_profit_digest";

// ── CHANNEL ROUTING ────────────────────────────────────────────────────
// CRITICAL events always SMS (cannot be disabled by user preferences).
// Everything else is in-app only.
const CRITICAL_SMS_EVENTS = new Set<EventName>([
  "store_approved",
  "store_rejected",
  "store_suspended",
  "store_first_sale",
  "store_first_sale_only",
  "store_withdrawal_requested",
  "store_withdrawal_paid",
  "store_withdrawal_rejected",
  "store_payout_failed",
  "store_profit_digest",
]);

// ── DEFAULT SMS TEMPLATES (fallback if DB row is missing) ──────────────
const DEFAULT_TEMPLATES: Record<EventName, string> = {
  store_created:
    "Store {store_name} submitted for review. Approval usually within 24h. You'll get a notification once it's live.",
  store_approved:
    "Store {store_name} is live. Share your link: buy-data360.com/s/{slug}. Manage products and orders in My Store.",
  store_rejected:
    "Store {store_name} wasn't approved.{reason_suffix} Update your details in My Store and resubmit for review.",
  store_new_order:
    "New sale on {store_name}. Order {short_id} - GHS {amount}. GHS {profit} profit unlocks after delivery. View in My Store.",
  store_first_sale:
    "Congratulations! {store_name} just received its first sale (Order {short_id}, GHS {amount}). Keep sharing your link to grow.",
  store_first_sale_only:
    "Congratulations! {store_name} just received its first sale (Order {short_id}, GHS {amount}). Keep sharing your link to grow.",
  store_withdrawal_requested:
    "Withdrawal of GHS {amount} to {momo_number} received. Typically paid within 24h on business days. You'll get an SMS on payout.",
  store_withdrawal_paid:
    "GHS {amount} paid to MoMo {momo_number}. {paystack_reference_suffix}Check your phone for the MoMo confirmation.",
  store_withdrawal_rejected:
    "Your withdrawal of GHS {amount} was not approved.{reason_suffix} Funds returned to your available balance.",
  store_payout_failed:
    "We could not complete your payout of GHS {amount} to {momo_number}. Please verify your MoMo details and try again from My Store.",
  store_suspended:
    "Your store {store_name} has been temporarily suspended.{reason_suffix} Contact support or review details in My Store.",
  store_profit_digest:
    "Today GHS {daily_profit} profit became available from {order_count} delivered order(s). Available balance: GHS {available_total}.",
};

function fmt(n: any): string {
  const v = Number(n || 0);
  return Number.isFinite(v) ? v.toFixed(2) : "0.00";
}

export function renderTemplate(template: string, data: Record<string, any>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k) => (data[k] === undefined || data[k] === null ? "" : String(data[k])))
    .replace(/[ \t]+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const event = body.event as EventName;
    if (!event || !DEFAULT_TEMPLATES[event]) {
      return new Response(JSON.stringify({ error: "Unknown event" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve owner_id + template data for each event.
    let ownerId: string | null = null;
    let data: any = {};
    let idempotencyKey = "";
    // Second message to send after the primary one (e.g. first-sale congrats).
    let chained: { event: EventName; data: any; key: string } | null = null;

    if (event === "store_created") {
      const { store_id } = body;
      const { data: s } = await supabase.from("stores").select("owner_id, name, slug").eq("id", store_id).maybeSingle();
      if (!s) return ok({ skipped: "store_not_found" });
      ownerId = s.owner_id;
      data = { store_name: s.name, slug: s.slug };
      idempotencyKey = `store_created_${store_id}`;
      // In-app only — no SMS for submission confirmation.
      await supabase.from("notifications").insert({
        target_type: "customer",
        target_id: ownerId,
        type: "store_created",
        title: "Store submitted for review",
        message: `Store ${s.name} is under review. Approval usually within 24h — you'll get an SMS once it's live.`,
        metadata: { store_id, slug: s.slug },
      });
      return ok({ sent: false, channel: "in_app", event });
    }

    else if (event === "store_new_order") {
      // Legacy direct invocation: route to in-app only (no SMS).
      const { store_order_id } = body;
      const { data: so } = await supabase
        .from("store_orders")
        .select("id, store_owner_id, store_id, amount_paid, profit, order_id, stores(name)")
        .eq("id", store_order_id)
        .maybeSingle();
      if (!so) return ok({ skipped: "store_order_not_found" });
      const { data: o } = await supabase.from("orders").select("short_id").eq("id", so.order_id).maybeSingle();
      const storeName = (so as any).stores?.name || "your store";
      const shortId = o?.short_id || "";
      await supabase.from("notifications").insert({
        target_type: "customer",
        target_id: so.store_owner_id,
        type: "store_new_order",
        title: "New order",
        message: `New sale on ${storeName}. Order ${shortId} — GHS ${fmt(so.amount_paid)} (GHS ${fmt(so.profit)} profit unlocks on delivery).`,
        metadata: { store_order_id, order_id: so.order_id, profit: so.profit, amount: so.amount_paid },
      });
      return ok({ sent: false, channel: "in_app", event });
    }

    else if (event === "store_first_sale_only") {
      // Emitted by the trigger when this is the very first paid order on the store.
      const { store_order_id } = body;
      const { data: so } = await supabase
        .from("store_orders")
        .select("id, store_owner_id, store_id, amount_paid, order_id, stores(name)")
        .eq("id", store_order_id)
        .maybeSingle();
      if (!so) return ok({ skipped: "store_order_not_found" });
      const { data: o } = await supabase.from("orders").select("short_id").eq("id", so.order_id).maybeSingle();
      ownerId = so.store_owner_id;
      const storeName = (so as any).stores?.name || "your store";
      const shortId = o?.short_id || "";
      data = { store_name: storeName, short_id: shortId, amount: fmt(so.amount_paid) };
      idempotencyKey = `store_first_sale_${(so as any).store_id}`;
    }

    else if (event === "store_approved") {
      const { store_id } = body;
      const { data: s } = await supabase.from("stores").select("owner_id, name, slug").eq("id", store_id).maybeSingle();
      if (!s) return ok({ skipped: "store_not_found" });
      ownerId = s.owner_id;
      data = { store_name: s.name, slug: s.slug };
      idempotencyKey = `store_approved_${store_id}`;
    }

    else if (event === "store_rejected") {
      const { store_id, reason } = body;
      const { data: s } = await supabase.from("stores").select("owner_id, name, slug").eq("id", store_id).maybeSingle();
      if (!s) return ok({ skipped: "store_not_found" });
      ownerId = s.owner_id;
      const r = (reason || "").toString().trim();
      data = {
        store_name: s.name,
        slug: s.slug,
        reason: r,
        reason_suffix: r ? ` Reason: ${r}.` : "",
      };
      idempotencyKey = `store_rejected_${store_id}_${r.slice(0, 24)}`;
    }

    else if (event === "store_suspended") {
      const { store_id, reason } = body;
      const { data: s } = await supabase.from("stores").select("owner_id, name").eq("id", store_id).maybeSingle();
      if (!s) return ok({ skipped: "store_not_found" });
      ownerId = s.owner_id;
      const r = (reason || "").toString().trim();
      data = {
        store_name: s.name,
        reason: r,
        reason_suffix: r ? ` Reason: ${r}.` : "",
      };
      idempotencyKey = `store_suspended_${store_id}_${Date.now().toString().slice(0, 8)}`;
    }

    // Note: legacy `store_new_order` is now handled in the early-return block above (in-app only).



    else if (event === "store_withdrawal_requested") {
      const { withdrawal_id } = body;
      const { data: w } = await supabase.from("store_withdrawals").select("owner_id, amount, momo_number").eq("id", withdrawal_id).maybeSingle();
      if (!w) return ok({ skipped: "withdrawal_not_found" });
      ownerId = w.owner_id;
      data = { amount: fmt(w.amount), momo_number: w.momo_number };
      idempotencyKey = `store_withdrawal_requested_${withdrawal_id}`;
    }

    else if (event === "store_withdrawal_paid") {
      const { withdrawal_id } = body;
      const { data: w } = await supabase.from("store_withdrawals").select("owner_id, amount, momo_number, paystack_reference").eq("id", withdrawal_id).maybeSingle();
      if (!w) return ok({ skipped: "withdrawal_not_found" });
      ownerId = w.owner_id;
      const ref = (w as any).paystack_reference || "";
      data = {
        amount: fmt(w.amount),
        momo_number: w.momo_number,
        paystack_reference: ref,
        paystack_reference_suffix: ref ? `Ref: ${ref}. ` : "",
      };
      idempotencyKey = `store_withdrawal_paid_${withdrawal_id}`;
    }

    else if (event === "store_withdrawal_rejected") {
      const { withdrawal_id, reason } = body;
      const { data: w } = await supabase.from("store_withdrawals").select("owner_id, amount, momo_number").eq("id", withdrawal_id).maybeSingle();
      if (!w) return ok({ skipped: "withdrawal_not_found" });
      ownerId = w.owner_id;
      const r = (reason || "").toString().trim();
      data = {
        amount: fmt(w.amount),
        momo_number: w.momo_number,
        reason: r,
        reason_suffix: r ? ` Reason: ${r}.` : "",
      };
      idempotencyKey = `store_withdrawal_rejected_${withdrawal_id}`;
    }

    else if (event === "store_payout_failed") {
      const { withdrawal_id, reason } = body;
      const { data: w } = await supabase.from("store_withdrawals").select("owner_id, amount, momo_number").eq("id", withdrawal_id).maybeSingle();
      if (!w) return ok({ skipped: "withdrawal_not_found" });
      ownerId = w.owner_id;
      const r = (reason || "").toString().trim();
      data = {
        amount: fmt(w.amount),
        momo_number: w.momo_number,
        reason: r,
        reason_suffix: r ? ` Reason: ${r}.` : "",
      };
      idempotencyKey = `store_payout_failed_${withdrawal_id}`;
    }

    else if (event === "store_profit_digest") {
      // Called by send-profit-digests with already-aggregated data.
      const { owner_id, daily_profit, order_count, available_total, digest_date } = body;
      if (!owner_id) return ok({ skipped: "no_owner_id" });
      ownerId = owner_id;
      data = {
        daily_profit: fmt(daily_profit),
        order_count: String(order_count ?? 0),
        available_total: fmt(available_total),
      };
      idempotencyKey = `store_profit_digest_${owner_id}_${digest_date || new Date().toISOString().slice(0, 10)}`;
    }

    if (!ownerId) return ok({ skipped: "no_owner" });

    // Channel routing: all events in this code path are SMS-eligible (CRITICAL).
    // Non-critical events return earlier with in-app only delivery.
    if (!CRITICAL_SMS_EVENTS.has(event)) {
      console.log(`[store-owner-notify] ${event}: not in critical SMS set, in-app only handled elsewhere`);
      return ok({ skipped: "not_sms_eligible" });
    }

    // Look up the owner's phone + preferences.
    const { data: owner } = await supabase
      .from("customers")
      .select("phone, notification_preferences")
      .eq("id", ownerId)
      .maybeSingle();
    const phone = owner?.phone;
    const prefs = (owner?.notification_preferences as Record<string, any>) || {};

    // Mirror critical SMS as an in-app notification too (so the bell shows it).
    try {
      await supabase.from("notifications").insert({
        target_type: "customer",
        target_id: ownerId,
        type: event,
        title: titleFor(event),
        message: renderTemplate(
          (await getTemplate(supabase, event)) || DEFAULT_TEMPLATES[event],
          data,
        ),
        metadata: { ...data, event },
      });
    } catch (_) { /* best-effort */ }

    if (!phone) {
      console.log(`[store-owner-notify] ${event}: owner ${ownerId} has no phone, skipping SMS`);
      return ok({ skipped: "no_phone", in_app: true });
    }

    // Profit digest is the one critical event a user CAN opt out of (it's a summary).
    if (event === "store_profit_digest" && prefs.profit_digest_sms === false) {
      return ok({ skipped: "opted_out_profit_digest_sms", in_app: true });
    }

    async function send(ev: EventName, vars: Record<string, any>, idem: string) {
      const template = (await getTemplate(supabase, ev)) || DEFAULT_TEMPLATES[ev];
      const message = renderTemplate(template, vars);
      const { error } = await supabase.functions.invoke("send-sms", {
        body: {
          to: phone,
          message,
          event_type: ev,
          customer_id: ownerId,
          idempotency_key: idem,
        },
      });
      if (error) console.error(`[store-owner-notify] send-sms error for ${ev}:`, error);
    }

    await send(event, data, idempotencyKey);
    if (chained) await send(chained.event, chained.data, chained.key);

    return ok({ sent: true, event, idempotency_key: idempotencyKey, chained: chained?.event || null });
  } catch (e: any) {
    console.error("[store-owner-notify] error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function ok(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function getTemplate(supabase: any, ev: EventName): Promise<string | null> {
  const { data: row } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", `store_sms_template_${ev}`)
    .maybeSingle();
  return (row?.value as string | undefined)?.trim() || null;
}

function titleFor(ev: EventName): string {
  switch (ev) {
    case "store_approved": return "Store approved";
    case "store_rejected": return "Store not approved";
    case "store_suspended": return "Store suspended";
    case "store_first_sale":
    case "store_first_sale_only": return "First sale 🎉";
    case "store_withdrawal_requested": return "Withdrawal received";
    case "store_withdrawal_paid": return "Withdrawal paid";
    case "store_withdrawal_rejected": return "Withdrawal not approved";
    case "store_payout_failed": return "Payout failed";
    case "store_profit_digest": return "Daily profit summary";
    default: return "Store update";
  }
}

