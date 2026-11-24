// Privacy-safe request monitoring helpers. Only fixed labels are produced:
// never raw paths, keys, hashes, headers, bodies, phone numbers or error text.
export type Endpoint =
  | "verify" | "packages" | "wallet" | "purchase_create" | "purchase_list"
  | "purchase_get" | "usage" | "usage_history";

export function endpointLabel(route: string, method: string, detailRef: string | null): Endpoint | null {
  if (detailRef !== null) return detailRef && !detailRef.includes("/") ? "purchase_get" : null;
  switch (route) {
    case "/v1/auth/verify": return "verify";
    case "/v1/packages": return "packages";
    case "/v1/wallet": return "wallet";
    case "/v1/usage": return "usage";
    case "/v1/usage/history": return "usage_history";
    case "/v1/purchases": return method === "POST" ? "purchase_create" : "purchase_list";
    default: return null;
  }
}

const EXACT = new Set([400, 401, 402, 403, 404, 405, 409, 422, 429]);
export function outcomeBucket(status: number): string {
  if (status >= 200 && status < 300) return "2xx";
  if (EXACT.has(status)) return String(status);
  if (status >= 400 && status < 500) return "4xx";
  return "5xx";
}

export type MonitorCtx = { endpoint: Endpoint | null; customerId: string | null; keyId: string | null; invalidKey: boolean };
export const newMonitorCtx = (): MonitorCtx => ({ endpoint: null, customerId: null, keyId: null, invalidKey: false });
