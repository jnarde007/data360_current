// Pure helpers for Developer API key authentication. Never log the key.
const KEY_RE = /^d360_live_[0-9a-f]{64}$/;

export function extractBearerKey(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer ([^\s]+)$/.exec(header.trim());
  if (!m) return null;
  return KEY_RE.test(m[1]) ? m[1] : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
