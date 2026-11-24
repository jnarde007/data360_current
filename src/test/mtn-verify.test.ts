import { describe, it, expect } from "vitest";
import {
  normalizeGhanaPhone, isMtnNumber, mapRemoteStatus, isCacheFresh,
} from "../../supabase/functions/_shared/mtn-verify";

describe("MTN number verification rules", () => {
  it("normalizes 233 and 9-digit formats", () => {
    expect(normalizeGhanaPhone("233241234567")).toBe("0241234567");
    expect(normalizeGhanaPhone("241234567")).toBe("0241234567");
    expect(normalizeGhanaPhone("12345")).toBeNull();
  });
  it("only accepts MTN prefixes", () => {
    expect(isMtnNumber("0551234567")).toBe(true);
    expect(isMtnNumber("0201234567")).toBe(false);
  });
  it("maps remote statuses", () => {
    expect(mapRemoteStatus("verified")).toBe("verified");
    expect(mapRemoteStatus("queued")).toBe("queued");
    expect(mapRemoteStatus("error")).toBe("unavailable");
  });
  it("verified numbers never need re-checking", () => {
    const longAgo = new Date("2020-01-01");
    expect(isCacheFresh("verified", longAgo, new Date())).toBe(true);
  });
  it("queued numbers are re-checked after 2 minutes", () => {
    const now = new Date("2026-01-01T00:10:00Z");
    expect(isCacheFresh("queued", new Date("2026-01-01T00:09:00Z"), now)).toBe(true);
    expect(isCacheFresh("queued", new Date("2026-01-01T00:07:59Z"), now)).toBe(false);
  });
});
