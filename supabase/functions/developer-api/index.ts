import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { extractBearerKey, sha256Hex } from "./auth.ts";
import { parseHistoryRange, parseListQuery, parseOrderRef, shapePurchase, PURCHASE_SELECT } from "./orders.ts";
import { endpointLabel, outcomeBucket, newMonitorCtx, type MonitorCtx } from "./monitor.ts";
import { validatePurchaseBody, validateIdempotencyKey, mapPurchaseError } from "./purchase.ts";

const INVALID = "Invalid or inactive API key";
const ROUTES = new Set(["/v1/auth/verify", "/v1/packages", "/v1/wallet", "/v1/purchases", "/v1/usage", "/v1/usage/history"]);

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

function routeOf(url: string): string {
  const path = new URL(url).pathname;
  const i = path.indexOf("/developer-api");
  return (i >= 0 ? path.slice(i + "/developer-api".length) : path).replace(/\/+$/, "") || "/";
}

// Phase 2 authentication, shared by every route. Identity comes ONLY from the key.
async function authenticate(db: SupabaseClient, header: string | null): Promise<{ customerId: string; keyId: string } | null> {
  const key = extractBearerKey(header);
  if (!key) return null;
  const hash = await sha256Hex(key);
  const { data: row, error } = await db
    .from("customer_api_keys")
    .select("id, is_active, revoked_at, customers!inner(id, status, deleted_at)")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error) throw new Error("lookup_failed");
  // deno-lint-ignore no-explicit-any
  const c = (row as any)?.customers;
  if (!row || !row.is_active || row.revoked_at || !c || c.status !== "active" || c.deleted_at) return null;
  await db.from("customer_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { customerId: c.id as string, keyId: row.id as string };
}

// Same source and rules as the customer Buy Data page: public_price_items (no cost_price),
// product = 'Data', network must be available_for_purchase in available_networks.
async function listPackages(db: SupabaseClient) {
  const { data: nets, error: nErr } = await db.from("available_networks").select("network, available_for_purchase");
  if (nErr) throw new Error("networks_failed");
  // deno-lint-ignore no-explicit-any
  const open = new Set((nets ?? []).filter((n: any) => n.available_for_purchase === true).map((n: any) => n.network));
  const { data, error } = await db
    .from("public_price_items")
    .select("id, network, size, price")
    .eq("product", "Data")
    .order("network")
    .order("price");
  if (error) throw new Error("packages_failed");
  return (data ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((p: any) => open.has(p.network))
    // deno-lint-ignore no-explicit-any
    .map((p: any) => ({
      id: p.id,
      network: p.network,
      size: p.size,
      price: Number(p.price),
      currency: "GHS",
      status: "available",
    }));
}

// Phase 5: wallet purchase for active Super Agents. All money/order logic lives in
// place_developer_api_order -> place_order (atomic claim + debit + order in one transaction).
async function handlePurchase(db: SupabaseClient, req: Request, customerId: string) {
  const { data: sa, error: saErr } = await db.from("super_agents").select("status").eq("customer_id", customerId).maybeSingle();
  if (saErr) throw new Error("super_agent_lookup_failed");
  if (!sa || sa.status !== "active") return json({ success: false, error: "Super Agent access required" }, 403);

  const idem = validateIdempotencyKey(req.headers.get("Idempotency-Key"));
  if (!idem) return json({ success: false, error: "Idempotency-Key header is required (8-255 printable characters)" }, 400);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  const v = validatePurchaseBody(body);
  if (!v.ok) return json({ success: false, error: v.error }, 400);

  const { data, error } = await db.rpc("place_developer_api_order", {
    p_customer_id: customerId,
    p_package_id: v.value.package_id,
    p_recipient_phone: v.value.recipient_phone,
    p_idempotency_key_hash: await sha256Hex(idem),
    p_client_reference: v.value.client_reference ?? undefined,
  });
  if (error) {
    const mapped = mapPurchaseError(error.message);
    if (mapped.status === 500) console.error("developer-api purchase failed:", error.code ?? "unknown");
    return json({ success: false, error: mapped.error }, mapped.status);
  }
  // deno-lint-ignore no-explicit-any
  const r = data as any;
  if (!r.replay) {
    // Immediate dispatch. deliver-order's atomic claim prevents double submission; if this call
    // fails, process-pending-orders picks the order up on its next run (grace already ended).
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/deliver-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ order_id: r.order_id }),
      });
    } catch { console.error("developer-api dispatch deferred to cron"); }
    const { data: o } = await db.from("orders").select("status").eq("id", r.order_id).maybeSingle();
    if (o?.status) r.status = o.status;
  }
  const out: Record<string, unknown> = {
    success: true, order_id: r.order_id, short_id: r.short_id, status: r.status,
    amount_charged: Number(r.amount_charged), currency: "GHS",
  };
  if (r.client_reference) out.client_reference = r.client_reference;
  if (r.replay) out.idempotent_replay = true;
  return json(out, r.replay ? 200 : 201);
}

// Phase 6: read-only tracking. Scoped to developer_api_purchases rows owned by the key's customer,
// so website orders and other customers' orders are never reachable.
async function handleReadPurchases(db: SupabaseClient, req: Request, customerId: string, ref: string | null) {
  const { data: active, error: saErr } = await db.rpc("_super_agent_active", { p_customer_id: customerId });
  if (saErr) throw new Error("super_agent_lookup_failed");
  if (active !== true) return json({ success: false, error: "Super Agent access required" }, 403);

  if (ref !== null) {
    const r = parseOrderRef(ref);
    if (!r) return json({ success: false, error: "Order not found" }, 404);
    const { data, error } = await db.from("developer_api_purchases").select(PURCHASE_SELECT)
      .eq("customer_id", customerId).eq(`orders.${r.kind}`, r.value).limit(1).maybeSingle();
    if (error) throw new Error("purchase_lookup_failed");
    if (!data) return json({ success: false, error: "Order not found" }, 404);
    return json({ success: true, purchase: shapePurchase(data) });
  }

  const q = parseListQuery(new URL(req.url).searchParams);
  if (!q.ok) return json({ success: false, error: q.error }, 400);
  const { limit, offset, status, from, to } = q.value;
  let query = db.from("developer_api_purchases").select(PURCHASE_SELECT, { count: "exact" })
    .eq("customer_id", customerId).not("order_id", "is", null);
  if (status) query = query.eq("orders.status", status);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error("purchase_list_failed");
  return json({ success: true, purchases: (data ?? []).map(shapePurchase), pagination: { limit, offset, total: count ?? 0 } });
}

async function handle(req: Request, mon: MonitorCtx): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const route = routeOf(req.url);
  const detailRef = route.startsWith("/v1/purchases/") ? route.slice("/v1/purchases/".length) : null;
  if (!ROUTES.has(route) && (!detailRef || detailRef.includes("/"))) return json({ success: false, error: "Not found" }, 404);
  if (detailRef !== null && req.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" });
  const isPurchase = route === "/v1/purchases";
  if (req.method === "GET" || req.method === "POST") mon.endpoint = endpointLabel(route, req.method, detailRef);
  if (isPurchase && req.method !== "POST" && req.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405, { Allow: "GET, POST, OPTIONS" });
  if (!isPurchase && req.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const auth = await authenticate(db, req.headers.get("Authorization"));
    if (!auth) { mon.invalidKey = true; return json({ success: false, error: INVALID }, 401); }
    const customerId = auth.customerId;
    mon.customerId = auth.customerId; mon.keyId = auth.keyId;

    if (isPurchase && req.method === "POST") return await handlePurchase(db, req, customerId);
    if (isPurchase || detailRef !== null) return await handleReadPurchases(db, req, customerId, detailRef);
    if (route === "/v1/usage" || route === "/v1/usage/history") {
      // Phase 7: read-only purchase statistics. Request-level logging does not exist yet.
      const { data: active, error: saErr } = await db.rpc("_super_agent_active", { p_customer_id: customerId });
      if (saErr) throw new Error("super_agent_lookup_failed");
      if (active !== true) return json({ success: false, error: "Super Agent access required" }, 403);
      if (route === "/v1/usage") {
        if ([...new URL(req.url).searchParams.keys()].length) return json({ success: false, error: "This endpoint takes no query parameters" }, 400);
        const { data, error } = await db.rpc("developer_api_usage_summary", { p_customer_id: customerId });
        if (error) throw new Error("usage_failed");
        return json({ success: true, currency: "GHS", purchases: data,
          api_requests: { available: false, note: "Request-level statistics are not recorded yet" } });
      }
      const r = parseHistoryRange(new URL(req.url).searchParams);
      if (!r.ok) return json({ success: false, error: r.error }, 400);
      const { data, error } = await db.rpc("developer_api_usage_history", { p_customer_id: customerId, p_from: r.value.from, p_to: r.value.to });
      if (error) throw new Error("usage_history_failed");
      return json({ success: true, currency: "GHS", from: r.value.from, to: r.value.to, days: data });
    }
    if (route === "/v1/wallet") {
      // Phase 4: active Super Agents only. Read-only; uses the same customers.wallet_balance
      // the dashboard shows (commission/store locked funds live in separate columns/tables).
      const { data: sa, error: saErr } = await db
        .from("super_agents").select("status").eq("customer_id", customerId).maybeSingle();
      if (saErr) throw new Error("super_agent_lookup_failed");
      if (!sa || sa.status !== "active") {
        return json({ success: false, error: "Super Agent access required" }, 403);
      }
      const { data: c, error: cErr } = await db
        .from("customers").select("wallet_balance").eq("id", customerId).single();
      if (cErr || !c) throw new Error("wallet_lookup_failed");
      return json({ success: true, customer_id: customerId, wallet_balance: Number(c.wallet_balance), currency: "GHS" });
    }
    if (route === "/v1/packages") {
      return json({ success: true, packages: await listPackages(db) });
    }
    return json({ success: true, customer_id: customerId, message: "Authentication successful" });
  } catch (e) {
    console.error("developer-api error:", e instanceof Error ? e.message : "unknown");
    return json({ success: false, error: "Internal server error" }, 500);
  }
}

// Phase 9: count the request AFTER the response is produced, in the background.
// Monitoring never blocks, delays or fails a request; enforcement is not implemented.
async function recordRequest(mon: MonitorCtx, status: number) {
  if (!mon.endpoint) return;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const { error } = mon.customerId && mon.keyId
      ? await db.rpc("api_monitor_record", { p_customer_id: mon.customerId, p_api_key_id: mon.keyId, p_endpoint: mon.endpoint, p_outcome: outcomeBucket(status) })
      : mon.invalidKey ? await db.rpc("api_monitor_record_invalid", { p_endpoint: mon.endpoint }) : { error: null };
    if (error) throw new Error("record_failed");
  } catch {
    console.error("developer-api monitor: record_failed");
    try { await db.rpc("api_monitor_record_failure", { p_kind: "record_failed" }); } catch { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  const mon = newMonitorCtx();
  const res = await handle(req, mon);
  try {
    const p = recordRequest(mon, res.status);
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {});
  } catch { /* monitoring must never affect the response */ }
  return res;
});
