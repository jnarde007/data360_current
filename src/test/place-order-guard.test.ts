import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const sql = readFileSync("drizzle/migrations/0021_place_order_caller_and_price_guard.sql", "utf8");

describe("place_order security guard (migration 0021)", () => {
  it("rejects anonymous callers", () => {
    expect(sql).toMatch(/v_caller_role = 'anon' THEN\s+RAISE EXCEPTION 'UNAUTHORIZED/);
  });
  it("requires a signed-in customer to own p_customer_id", () => {
    expect(sql).toContain("WHERE id = p_customer_id AND auth_user_id = v_caller_uid AND deleted_at IS NULL");
  });
  it("forces browser callers to the server price (catalog or Super Agent)", () => {
    expect(sql).toContain("COALESCE(v_sa_price, v_catalog_price) * GREATEST(COALESCE(p_quantity, 1), 1)");
    expect(sql).toContain("abs(p_total_amount - v_expected_total) > 0.01");
  });
  it("only service_role plus the wrapper flag skips the grace period", () => {
    expect(sql).toContain("v_caller_role = 'service_role' AND current_setting('data360.api_immediate', true) = 'on'");
  });
  it("removes public and anon execute rights", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.place_order\([^)]*\) FROM PUBLIC, anon;/);
  });
});
