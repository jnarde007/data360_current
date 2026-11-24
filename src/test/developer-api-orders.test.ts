import { describe, it, expect } from "vitest";
import { parseListQuery, parseOrderRef, shapePurchase } from "../../supabase/functions/developer-api/orders";

const q = (s: string) => parseListQuery(new URLSearchParams(s));
describe("developer api order tracking rules", () => {
  it("defaults to limit 20, offset 0", () => {
    expect(q("")).toEqual({ ok: true, value: { limit: 20, offset: 0, status: null, from: null, to: null } });
  });
  it("caps limit at 100", () => {
    expect(q("limit=100").ok).toBe(true);
    expect(q("limit=101").ok).toBe(false);
    expect(q("limit=0").ok).toBe(false);
    expect(q("offset=-1").ok).toBe(false);
  });
  it("accepts only real order statuses", () => {
    expect(q("status=delivered").ok).toBe(true);
    expect(q("status=refunded").ok).toBe(false);
  });
  it("validates date range", () => {
    const r = q("from=2026-11-01&to=2026-11-02");
    expect(r.ok && r.value.to).toBe("2026-11-02T23:59:59.999Z");
    expect(q("from=2026-11-05&to=2026-11-01").ok).toBe(false);
    expect(q("from=yesterday").ok).toBe(false);
  });
  it("rejects unknown params such as customer_id", () => {
    expect(q("customer_id=x").ok).toBe(false);
  });
  it("parses UUID and short id refs", () => {
    expect(parseOrderRef("ord-6038")).toEqual({ kind: "short_id", value: "ORD-6038" });
    expect(parseOrderRef("11111111-2222-3333-4444-555555555555")?.kind).toBe("id");
    expect(parseOrderRef("a,b;drop")).toBeNull();
  });
  it("returns charged amount and no internal fields", () => {
    const out = shapePurchase({ client_reference: "R1", amount_charged: "4.05", orders: {
      id: "o", short_id: "ORD-1", network: "MTN", bundle_size: "1GB", recipient_phone: "0241234567",
      total_amount: 4.05, status: "rejected", created_at: "2026-11-01T00:00:00Z", provider_completed_at: null,
      cost_price: 3, provider_response: {}, refunds: [{ status: "refunded", refund_amount: 4.05, created_at: "a", updated_at: "2026-11-02T00:00:00Z" }] } });
    expect(out.amount_charged).toBe(4.05);
    expect(out.refund).toEqual({ status: "refunded", amount: 4.05, currency: "GHS" });
    expect(out.failure_reason).toBe("Order rejected");
    expect(JSON.stringify(out)).not.toMatch(/cost|provider/);
  });
});

import { parseHistoryRange } from "../../supabase/functions/developer-api/orders";
const h = (s: string) => parseHistoryRange(new URLSearchParams(s), new Date("2026-11-16T23:00:00Z"));
describe("developer api usage history range", () => {
  it("defaults to the last 30 days", () => {
    expect(h("")).toEqual({ ok: true, value: { from: "2026-10-18", to: "2026-11-16" } });
  });
  it("allows 92 days, rejects 93", () => {
    expect(h("from=2026-01-01&to=2026-04-02").ok).toBe(true);
    expect(h("from=2026-01-01&to=2026-04-03").ok).toBe(false);
  });
  it("rejects invalid dates and reversed ranges", () => {
    expect(h("from=2026-02-30").ok).toBe(false);
    expect(h("from=2026-11-10&to=2026-11-01").ok).toBe(false);
    expect(h("customer_id=x").ok).toBe(false);
  });
});
