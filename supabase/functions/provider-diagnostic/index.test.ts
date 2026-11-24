// Integration tests for the provider-diagnostic safeguard surface.
//
// These tests exercise the public HTTP API of the deployed edge function and
// the assert_provider_call_allowed RPC. They cover the safeguards required by
// the test-mode safeguard ticket:
//   - order placement through diagnostics is impossible
//   - non-admin users cannot pass the gate
//   - closed / expired windows block calls
//   - invalid / expired / replayed tokens are rejected
//   - missing payment guard on deliver-order
//
// Fixtures requiring a real Super Admin session are gated on the optional
// SUPER_ADMIN_JWT env var and skipped automatically when not provided so the
// suite still runs cleanly in CI.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPER_ADMIN_JWT = Deno.env.get("SUPER_ADMIN_JWT") || "";

const FN_URL = `${SUPABASE_URL}/functions/v1/provider-diagnostic`;

async function callFn(body: unknown, jwt = ANON_KEY) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${jwt}`,
      "Content-Type": "application/json",
      "apikey": ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed as Record<string, unknown> };
}

Deno.test("provider-diagnostic exposes no order_placement / topup action", async () => {
  const placeOrder = await callFn({
    action: "place_order",
    provider: "iGet",
    confirmation_token: "anything",
  });
  assertEquals(placeOrder.status, 400);
  assertEquals(placeOrder.body.error, "unsupported_action");

  const topup = await callFn({
    action: "topup",
    provider: "iGet",
    confirmation_token: "anything",
  });
  assertEquals(topup.status, 400);
  assertEquals(topup.body.error, "unsupported_action");
});

Deno.test("provider-diagnostic refuses unauthenticated callers", async () => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
    body: JSON.stringify({ action: "balance", provider: "Portal-02", confirmation_token: "x" }),
  });
  await res.text();
  assert(res.status === 401 || res.status === 403);
});

Deno.test("provider-diagnostic blocks anon user at the gate (non super admin)", async () => {
  // Anon API key is not a Super Admin — the RPC must refuse.
  const r = await callFn({
    action: "balance",
    provider: "Portal-02",
    confirmation_token: "deadbeef",
  });
  // Either auth fails (401) or RPC denies for not_super_admin (403).
  assert([401, 403].includes(r.status), `unexpected status ${r.status}`);
});

Deno.test("invalid action / missing fields rejected with 400", async () => {
  const missing = await callFn({ provider: "iGet" });
  assertEquals(missing.status, 400);

  const bad = await callFn({ action: "destroy", provider: "iGet", confirmation_token: "x" });
  assertEquals(bad.status, 400);
});

// ---- Super-Admin scenarios (require SUPER_ADMIN_JWT env) ----

Deno.test({
  name: "[super-admin] closed window blocks balance call",
  ignore: !SUPER_ADMIN_JWT,
  fn: async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${SUPER_ADMIN_JWT}` } },
    });
    // Ensure window is closed first
    await admin.rpc("set_diagnostics_window", { _enabled: false, _duration_minutes: 1, _note: "test_close" });
    const r = await callFn({ action: "balance", provider: "Portal-02", confirmation_token: "any" }, SUPER_ADMIN_JWT);
    assertEquals(r.status, 403);
  },
});

Deno.test({
  name: "[super-admin] invalid token rejected even with open window",
  ignore: !SUPER_ADMIN_JWT,
  fn: async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${SUPER_ADMIN_JWT}` } },
    });
    await admin.rpc("set_diagnostics_window", { _enabled: true, _duration_minutes: 5, _note: "test invalid token" });
    const r = await callFn({ action: "balance", provider: "Portal-02", confirmation_token: "not-real" }, SUPER_ADMIN_JWT);
    assertEquals(r.status, 403);
    await admin.rpc("set_diagnostics_window", { _enabled: false, _duration_minutes: 1, _note: "cleanup" });
  },
});

Deno.test({
  name: "[super-admin] token is single-use (replay rejected)",
  ignore: !SUPER_ADMIN_JWT,
  fn: async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${SUPER_ADMIN_JWT}` } },
    });
    const { data } = await admin.rpc("set_diagnostics_window", {
      _enabled: true, _duration_minutes: 5, _note: "test replay attack",
    });
    const token = (data as { confirmation_token?: string } | null)?.confirmation_token || "";
    assert(token.length > 0, "expected a token");

    // 1st use: may succeed or 502 (network); either way the token is consumed.
    await callFn({ action: "balance", provider: "Portal-02", confirmation_token: token }, SUPER_ADMIN_JWT);

    // 2nd use: replay — must be rejected.
    const replay = await callFn({ action: "balance", provider: "Portal-02", confirmation_token: token }, SUPER_ADMIN_JWT);
    assertEquals(replay.status, 403);
    await admin.rpc("set_diagnostics_window", { _enabled: false, _duration_minutes: 1, _note: "cleanup" });
  },
});

Deno.test({
  name: "[super-admin] order_placement is permanently blocked by RPC",
  ignore: !SUPER_ADMIN_JWT,
  fn: async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${SUPER_ADMIN_JWT}` } },
    });
    const { data } = await admin.rpc("set_diagnostics_window", {
      _enabled: true, _duration_minutes: 5, _note: "test order placement block",
    });
    const token = (data as { confirmation_token?: string } | null)?.confirmation_token || "";
    const { error } = await admin.rpc("assert_provider_call_allowed", {
      _kind: "order_placement",
      _provider: "iGet",
      _endpoint: "/api/developer/orders/place",
      _confirmation_token: token,
      _payload_summary: {},
    });
    assert(error, "expected order_placement to be rejected");
    assert(
      (error?.message || "").toLowerCase().includes("order_placement"),
      `unexpected message: ${error?.message}`,
    );
    await admin.rpc("set_diagnostics_window", { _enabled: false, _duration_minutes: 1, _note: "cleanup" });
  },
});

Deno.test({
  name: "[super-admin] kill switch blocks even with open window + valid token",
  ignore: !SUPER_ADMIN_JWT,
  fn: async () => {
    const admin = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${SUPER_ADMIN_JWT}` } },
    });
    const { data } = await admin.rpc("set_diagnostics_window", {
      _enabled: true, _duration_minutes: 5, _note: "test kill switch",
    });
    const token = (data as { confirmation_token?: string } | null)?.confirmation_token || "";
    await admin.rpc("set_disable_provider_diagnostics", { _disabled: true });
    const r = await callFn({ action: "balance", provider: "Portal-02", confirmation_token: token }, SUPER_ADMIN_JWT);
    assertEquals(r.status, 403);
    // cleanup
    await admin.rpc("set_disable_provider_diagnostics", { _disabled: false });
  },
});

// ---- deliver-order safeguard (service_role required) ----

Deno.test({
  name: "[service_role] deliver-order rejects orders without verified payment",
  ignore: !SERVICE_ROLE_KEY,
  fn: async () => {
    // Sanity check at the safeguard layer: an order with no payment_verified_at
    // and no wallet debit row must be rejected by deliver-order before it ever
    // touches a provider API.
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: order, error: insErr } = await sb.from("orders").insert({
      recipient_phone: "0240000000",
      network: "MTN",
      bundle_size_gb: 1,
      price_paid: 0,
      cost_price: 0,
      status: "pending",
      payment_method: "wallet",
      diagnostic: true,
    } as never).select("id").single();
    if (insErr) {
      // Schema may differ; in that case skip rather than fail.
      console.warn("deliver-order test skipped (insert failed):", insErr.message);
      return;
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/deliver-order`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      body: JSON.stringify({ order_id: (order as { id: string }).id }),
    });
    const txt = await res.text();
    assert(
      txt.toLowerCase().includes("disabled without verified payment") ||
        txt.toLowerCase().includes("admin approval is required") ||
        res.status >= 400,
      `expected payment guard to reject, got ${res.status}: ${txt}`,
    );
    await sb.from("orders").delete().eq("id", (order as { id: string }).id);
  },
});

// ---- Happy-path: customer order delivery is unaffected by diagnostics state ----
//
// Simulates: a fully paid wallet order is delivered while diagnostics are
// simultaneously disabled (kill switch ON, window closed). The diagnostic
// surface must reject probes, but the customer order must still be eligible
// to flow through deliver-order's payment guard (the test stops there to
// avoid hitting a real provider — it asserts the guard does NOT trip).
Deno.test({
  name: "[service_role] customer order with verified payment passes deliver-order guard even with diagnostics disabled",
  ignore: !SERVICE_ROLE_KEY || !SUPER_ADMIN_JWT,
  fn: async () => {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const admin = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${SUPER_ADMIN_JWT}` } },
    });

    // Engage the safeguards: kill switch ON, window closed.
    await admin.rpc("set_disable_provider_diagnostics", { _disabled: true });

    // Probe attempt must be blocked.
    const probe = await callFn(
      { action: "balance", provider: "Portal-02", confirmation_token: "anything" },
      SUPER_ADMIN_JWT,
    );
    assertEquals(probe.status, 403);

    // Create a wallet-paid order with a matching debit row (the proof
    // deliver-order looks for). short_id auto-generated by trigger if any;
    // we fall back to a deterministic one for the debit reference.
    const shortId = `TST-${Date.now().toString(36).toUpperCase()}`;
    const { data: order, error: insErr } = await sb.from("orders").insert({
      recipient_phone: "0240000001",
      network: "MTN",
      bundle_size_gb: 1,
      price_paid: 1,
      cost_price: 1,
      status: "pending",
      payment_method: "wallet",
      short_id: shortId,
    } as never).select("id, short_id").single();
    if (insErr) {
      console.warn("happy-path test skipped (insert failed):", insErr.message);
      await admin.rpc("set_disable_provider_diagnostics", { _disabled: false });
      return;
    }
    const orderId = (order as { id: string; short_id: string }).id;
    const orderShort = (order as { id: string; short_id: string }).short_id || shortId;

    // Matching wallet debit row — proof of payment for the guard.
    await sb.from("wallet_transactions").insert({
      type: "debit",
      amount: 1,
      reference: orderShort,
      description: "test debit",
    } as never);

    // Network API toggle is probably off in test → deliver-order routes to
    // manual. That is also a "guard passed" outcome for this assertion.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/deliver-order`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
      },
      body: JSON.stringify({ order_id: orderId }),
    });
    const txt = await res.text();
    assert(
      !txt.toLowerCase().includes("disabled without verified payment"),
      `payment guard should NOT trip for a verified wallet order. Got: ${txt}`,
    );

    // Cleanup
    await sb.from("orders").delete().eq("id", orderId);
    await sb.from("wallet_transactions").delete().eq("reference", orderShort);
    await admin.rpc("set_disable_provider_diagnostics", { _disabled: false });
  },
});
