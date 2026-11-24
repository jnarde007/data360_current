import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DOC_ENDPOINTS, API_BASE } from "@/lib/developer-api-docs";

const src = readFileSync("supabase/functions/developer-api/index.ts", "utf8");
describe("developer api docs", () => {
  it("documents only routes the service implements", () => {
    for (const e of DOC_ENDPOINTS) {
      const base = e.path.replace("/{order_id}", "");
      expect(src).toContain(`"${base}"`);
    }
    expect(DOC_ENDPOINTS).toHaveLength(8);
  });
  it("contains placeholders only, never real keys", () => {
    const all = JSON.stringify(DOC_ENDPOINTS);
    expect(all).not.toMatch(/d360_live_[A-Za-z0-9]{6,}/);
    expect(all).toContain("YOUR_API_KEY");
    expect(API_BASE).toMatch(/\/functions\/v1\/developer-api$/);
  });
});
