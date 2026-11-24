// Pure helpers for GET /v1/purchases and GET /v1/purchases/{ref}. No I/O.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_RE = /^[A-Za-z0-9-]{3,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

// Real orders.status values used by place_order, deliver-order, webhooks, cancel and reject.
export const ORDER_STATUSES: Record<string, string> = {
  pending_confirmation: "Order received, waiting to be queued",
  pending: "Queued for delivery",
  submitting: "Being sent to the network",
  processing: "Delivery in progress",
  delivered: "Delivered",
  failed: "Delivery failed",
  rejected: "Order rejected",
  customer_cancelled: "Cancelled",
};
const ALLOWED = new Set(["limit", "offset", "status", "from", "to"]);

export type ListQuery = { limit: number; offset: number; status: string | null; from: string | null; to: string | null };

export function parseOrderRef(ref: string): { kind: "id" | "short_id"; value: string } | null {
  const r = decodeURIComponent(ref || "").trim();
  if (UUID_RE.test(r)) return { kind: "id", value: r.toLowerCase() };
  if (SHORT_RE.test(r)) return { kind: "short_id", value: r.toUpperCase() };
  return null;
}

function toIso(v: string, endOfDay: boolean): string | null {
  if (!DATE_RE.test(v)) return null;
  const s = v.length === 10 ? `${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : v;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseListQuery(params: URLSearchParams): { ok: true; value: ListQuery } | { ok: false; error: string } {
  const extra = [...new Set([...params.keys()])].filter((k) => !ALLOWED.has(k));
  if (extra.length) return { ok: false, error: `Unsupported query parameter(s): ${extra.join(", ")}` };
  for (const k of ALLOWED) if (params.getAll(k).length > 1) return { ok: false, error: `${k} may only be given once` };
  const int = (k: string, def: number, min: number, max: number) => {
    const v = params.get(k);
    if (v === null || v === "") return def;
    if (!/^\d{1,9}$/.test(v)) return NaN;
    const n = Number(v);
    return n < min || n > max ? NaN : n;
  };
  const limit = int("limit", 20, 1, 100);
  if (isNaN(limit)) return { ok: false, error: "limit must be an integer between 1 and 100" };
  const offset = int("offset", 0, 0, 100000);
  if (isNaN(offset)) return { ok: false, error: "offset must be an integer between 0 and 100000" };
  const status = params.get("status") || null;
  if (status && !(status in ORDER_STATUSES)) return { ok: false, error: `status must be one of: ${Object.keys(ORDER_STATUSES).join(", ")}` };
  const fromRaw = params.get("from"), toRaw = params.get("to");
  const from = fromRaw ? toIso(fromRaw, false) : null;
  if (fromRaw && !from) return { ok: false, error: "from must be an ISO date (YYYY-MM-DD or full timestamp)" };
  const to = toRaw ? toIso(toRaw, true) : null;
  if (toRaw && !to) return { ok: false, error: "to must be an ISO date (YYYY-MM-DD or full timestamp)" };
  if (from && to && from > to) return { ok: false, error: "from must be before to" };
  return { ok: true, value: { limit, offset, status, from, to } };
}

// deno-lint-ignore no-explicit-any
export function shapePurchase(row: any) {
  const o = row.orders;
  // deno-lint-ignore no-explicit-any
  const refunds = ([...(o.refunds ?? [])] as any[]).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const rf = refunds[0];
  const times = [o.created_at, o.provider_completed_at, rf?.updated_at].filter(Boolean).map(String).sort();
  const failed = ["failed", "rejected", "customer_cancelled"].includes(o.status);
  return {
    order_id: o.id,
    short_id: o.short_id,
    client_reference: row.client_reference ?? null,
    network: o.network,
    bundle_size: o.bundle_size,
    recipient_phone: o.recipient_phone,
    amount_charged: Number(row.amount_charged ?? o.total_amount),
    currency: "GHS",
    status: o.status,
    status_description: ORDER_STATUSES[o.status] ?? "Status update pending",
    created_at: o.created_at,
    updated_at: times[times.length - 1],
    completed_at: o.status === "delivered" ? (o.provider_completed_at ?? null) : null,
    failure_reason: failed ? ORDER_STATUSES[o.status] : null,
    refund: rf ? { status: rf.status, amount: Number(rf.refund_amount), currency: "GHS" } : null,
  };
}

// Columns read from the database. Deliberately excludes cost, provider and payment internals.
export const PURCHASE_SELECT =
  "client_reference, amount_charged, created_at, orders!inner(id, short_id, network, bundle_size, recipient_phone, total_amount, status, created_at, provider_completed_at, refunds(status, refund_amount, created_at, updated_at))";

// Phase 7: usage history date range. Default = last 30 days (UTC); max 92 days.
export const MAX_HISTORY_DAYS = 92;
export function parseHistoryRange(params: URLSearchParams, now = new Date()):
  { ok: true; value: { from: string; to: string } } | { ok: false; error: string } {
  const extra = [...new Set([...params.keys()])].filter((k) => k !== "from" && k !== "to");
  if (extra.length) return { ok: false, error: `Unsupported query parameter(s): ${extra.join(", ")}` };
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const valid = (s: string) => D.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  const today = now.toISOString().slice(0, 10);
  const to = params.get("to") ?? today;
  if (!valid(to)) return { ok: false, error: "to must be a date in YYYY-MM-DD format" };
  const from = params.get("from") ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  if (!valid(from)) return { ok: false, error: "from must be a date in YYYY-MM-DD format" };
  if (from > to) return { ok: false, error: "from must be on or before to" };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_HISTORY_DAYS) return { ok: false, error: `Date range may cover at most ${MAX_HISTORY_DAYS} days` };
  return { ok: true, value: { from, to } };
}
