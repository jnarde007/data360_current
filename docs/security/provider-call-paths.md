# Provider API call paths — security audit

Date: 2026-06-24
Scope: every code path that can issue an outbound HTTP request to a provider API (iGet, Portal-02 for MTN, Paystack provider endpoints).

## Hard rules (enforced)

1. **Diagnostics can never place a real order.** `provider-diagnostic` has no `place_order`/`topup` action. The `assert_provider_call_allowed` RPC also denies `_kind = 'order_placement'` unconditionally and emits a Super Admin alert.
2. **Only `deliver-order` may hit a provider `/orders/place` endpoint.** That function rejects any order row that is not backed by a verified Paystack payment or a matching wallet debit row, and rejects rows flagged `diagnostic = true`.
3. **Global kill switch.** Super Admin toggle `disable_provider_diagnostics` blocks every diagnostic call regardless of window/token/role.
4. **Rate limits.** Per admin: max 5 diagnostic calls per minute, 20 per hour. Excess attempts are blocked + audited.
5. **One-time tokens.** Each diagnostic call consumes the current confirmation token; replays are rejected and audited.
6. **Alerts.** Notifications are sent to all Super Admins on (a) any blocked `order_placement` attempt, (b) any non-Super-Admin attempt, and (c) 3+ blocked attempts in a 5-minute window.

## Inventory of provider HTTP call sites

| # | File | Outbound endpoint | Trigger | Guarded by | Status |
|---|------|-------------------|---------|------------|--------|
| 1 | `supabase/functions/deliver-order/index.ts` | iGet `/api/developer/orders/place`, Portal-02 `/order/{network}` | Server cron / paystack webhook / wallet checkout. Always driven by a row in `public.orders`. | Re-checks the order row, requires `payment_verified_at` (Paystack) **or** a matching `wallet_transactions` debit row (wallet), rejects `diagnostic = true`. Audited. | **Protected** |
| 2 | `supabase/functions/provider-diagnostic/index.ts` | iGet `/api/developer/orders/reference/{ref}`, Portal-02 `/balance`, Portal-02 `/order/reference/{ref}` | Admin UI only (`verify_jwt = true`). | Super Admin JWT + open diagnostics window + valid one-time token + kill switch + per-admin rate limit. Audited. No `place` endpoint exposed. | **Protected** |
| 3 | `supabase/functions/poll-iget-orders/index.ts` | iGet `/api/developer/orders/reference/{ref}` (read-only status) | `pg_cron` every 30s. Iterates only orders already submitted by `deliver-order`. | Read-only status fetch. Cannot create or charge anything. | **Read-only, safe** |
| 4 | `supabase/functions/poll-mtn-orders/index.ts` | Portal-02 `/order/status/{ref}` (read-only status) | `pg_cron` every 30s, orders already submitted. | Read-only status fetch. | **Read-only, safe** |
| 5 | `supabase/functions/fetch-provider-balances/index.ts` | Portal-02 `/balance` | `pg_cron` (every few minutes), admin UI button. | Read-only balance fetch. No order side effects. | **Read-only, safe** |

### Other things that look provider-ish but are not

- `paystack-*` functions (`paystack-webhook`, `verify-paystack`, `finalize-payment`, `paystack-direct-*`, `payout-initiate`, `payout-retry`, `reconcile-payouts`, `paystack-blind-sweep`) hit the **Paystack** API for charges / refunds / transfers. They are explicitly NOT in scope for "provider order placement" — they don't talk to iGet/Portal-02. Each one is gated as documented in its own module. Provider diagnostics cannot reach Paystack either: `provider-diagnostic` only accepts provider `iGet` or `Portal-02`.
- `process-pending-orders` does not call providers itself; it only orchestrates by invoking `deliver-order` for eligible order rows.

## Result

Every path that could ever reach an iGet / Portal-02 `/orders/place` endpoint is now mediated by either:
- a verified customer order in `deliver-order` (the only one), or
- the explicitly sanctioned `provider-diagnostic` channel, which does not expose order placement at all.

There are no shell scripts, background jobs, or unguarded edge functions that bypass these protections.
