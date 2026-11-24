// Pure rules for MTN number eligibility checks (shared by verify-mtn-number and tests).
export type MtnVerifyStatus = "verified" | "queued" | "unverified" | "unavailable";

const MTN_PREFIXES = ["024", "025", "053", "054", "055", "059"];

export function normalizeGhanaPhone(raw: string): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  let p = d;
  if (p.startsWith("233") && p.length === 12) p = "0" + p.slice(3);
  else if (p.length === 9) p = "0" + p;
  return /^0\d{9}$/.test(p) ? p : null;
}

export function isMtnNumber(phone: string): boolean {
  return MTN_PREFIXES.includes(phone.slice(0, 3));
}

export function mapRemoteStatus(s: unknown): MtnVerifyStatus {
  const v = String(s || "").toLowerCase();
  if (v === "verified") return "verified";
  if (v === "queued" || v === "pending") return "queued";
  if (v === "unverified" || v === "not_verified" || v === "invalid") return "unverified";
  return "unavailable";
}

// How long a cached result may be reused before re-checking (ms). Verified never expires.
export const CACHE_TTL_MS: Record<MtnVerifyStatus, number> = {
  verified: Number.POSITIVE_INFINITY,
  queued: 2 * 60 * 1000,
  unverified: 10 * 60 * 1000,
  unavailable: 0,
};

export function isCacheFresh(status: MtnVerifyStatus, checkedAt: Date, now: Date): boolean {
  return now.getTime() - checkedAt.getTime() < CACHE_TTL_MS[status];
}
