import { describe, it, expect } from "vitest";
import { validatePurchaseBody, validateIdempotencyKey, mapPurchaseError } from "../../supabase/functions/developer-api/purchase";

const pkg = "11111111-2222-3333-4444-555555555555";
describe("developer api purchase rules", () => {
  it("rejects caller-supplied price/customer fields", () => {
    expect(validatePurchaseBody({ package_id: pkg, recipient_phone: "0241234567", price: 1 }).ok).toBe(false);
    expect(validatePurchaseBody({ package_id: pkg, recipient_phone: "0241234567", customer_id: pkg }).ok).toBe(false);
  });
  it("accepts a valid request", () => {
    expect(validatePurchaseBody({ package_id: pkg, recipient_phone: "0241234567", client_reference: "A1" }).ok).toBe(true);
  });
  it("requires an idempotency key", () => {
    expect(validateIdempotencyKey(null)).toBeNull();
    expect(validateIdempotencyKey("order-12345")).toBe("order-12345");
  });
  it("maps errors to the agreed status codes", () => {
    expect(mapPurchaseError("Insufficient wallet balance").status).toBe(402);
    expect(mapPurchaseError("SA_REQUIRED").status).toBe(403);
    expect(mapPurchaseError("IDEMPOTENCY_CONFLICT").status).toBe(409);
    expect(mapPurchaseError("DUPLICATE_PENDING: x").status).toBe(409);
    expect(mapPurchaseError("PACKAGE_NOT_FOUND").status).toBe(404);
    expect(mapPurchaseError("NETWORK_MISMATCH: x").status).toBe(422);
    expect(mapPurchaseError("NETWORK_UNAVAILABLE: x").status).toBe(503);
    expect(mapPurchaseError("relation foo does not exist")).toEqual({ status: 500, error: "Internal server error" });
  });
});
