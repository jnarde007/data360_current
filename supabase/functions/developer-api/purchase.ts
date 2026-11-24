// Pure helpers for POST /v1/purchases. No I/O; never log keys.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = new Set(["package_id", "recipient_phone", "client_reference"]);

export type PurchaseInput = { package_id: string; recipient_phone: string; client_reference: string | null };

export function validateIdempotencyKey(h: string | null): string | null {
  if (!h) return null;
  const k = h.trim();
  return k.length >= 8 && k.length <= 255 && /^[\x21-\x7e]+$/.test(k) ? k : null;
}

export function validatePurchaseBody(body: unknown): { ok: true; value: PurchaseInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Request body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !ALLOWED.has(k));
  if (extra.length) return { ok: false, error: `Unsupported field(s): ${extra.join(", ")}` };
  if (typeof b.package_id !== "string" || !UUID_RE.test(b.package_id)) return { ok: false, error: "package_id must be a valid package UUID" };
  if (typeof b.recipient_phone !== "string" || !/^\+?[0-9\s-]{9,16}$/.test(b.recipient_phone)) return { ok: false, error: "recipient_phone is required" };
  let ref: string | null = null;
  if (b.client_reference !== undefined && b.client_reference !== null) {
    if (typeof b.client_reference !== "string" || b.client_reference.length > 100) return { ok: false, error: "client_reference must be a string of at most 100 characters" };
    ref = b.client_reference.trim() || null;
  }
  return { ok: true, value: { package_id: b.package_id.toLowerCase(), recipient_phone: b.recipient_phone, client_reference: ref } };
}

// Map a database error message to a safe public response. Never echo raw DB text.
export function mapPurchaseError(message: string): { status: number; error: string } {
  const m = message || "";
  if (m.startsWith("SA_REQUIRED")) return { status: 403, error: "Super Agent access required" };
  if (m.startsWith("IDEMPOTENCY_CONFLICT")) return { status: 409, error: "Idempotency-Key was already used with a different request" };
  if (m.startsWith("DUPLICATE_PENDING")) return { status: 409, error: "Recipient already has an active order" };
  if (m.startsWith("Insufficient wallet balance")) return { status: 402, error: "Insufficient wallet balance" };
  if (m.startsWith("PACKAGE_NOT_FOUND")) return { status: 404, error: "Package not found" };
  if (m.startsWith("NETWORK_UNAVAILABLE")) return { status: 503, error: "Network temporarily unavailable" };
  if (m.startsWith("INVALID_PHONE")) return { status: 422, error: "Invalid recipient phone number" };
  if (m.startsWith("NETWORK_MISMATCH")) return { status: 422, error: "Recipient number does not belong to the package network" };
  if (m.startsWith("INVALID_REQUEST")) return { status: 400, error: "Invalid request" };
  return { status: 500, error: "Internal server error" };
}
