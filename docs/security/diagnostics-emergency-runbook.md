# Provider Diagnostics — Emergency Recovery Runbook

Audience: Super Admins. Scope: response when provider diagnostics are abused, leaking, or behaving unexpectedly.

All actions below are surfaced in **Admin Settings → Diagnostics Approval** (`DiagnosticsApprovalCard`). Nothing here requires shell or database access.

---

## 1. Pull the kill switch (stops everything)

Toggle **"Disable provider diagnostics globally"** to ON.

What this does:
- Sets `platform_settings.disable_provider_diagnostics = true`.
- `assert_provider_call_allowed` short-circuits with `kill_switch_enabled` on every diagnostic call — even with an open window and a valid token.
- The same RPC automatically closes any open approval window and wipes the stored token hash, so re-enabling the kill switch later does not silently re-open access.
- Audited to `provider_call_attempts` (kind=`blocked`, outcome=`kill_switch_enabled`).

Customer order placement is **not affected** — `deliver-order` does not consult this flag.

## 2. Close the approval window

Even with the kill switch on, explicitly close the window so the state is unambiguous: toggle **"Allow live provider diagnostics"** to OFF.

This clears `diagnostics_live_calls_allowed`, `diagnostics_live_calls_expires_at`, and `diagnostics_live_calls_token_hash`.

## 3. Rotate the diagnostic token

If you suspect a token leaked, click **"Rotate one-time token"** in the card (or open a fresh window — opening one always issues a new token). The previous token's hash is overwritten, so any copy of it becomes useless on the next call.

Tokens are stored as a SHA-256 hash in `platform_settings`; the plaintext only exists in the response that originally issued it and in the in-memory client state of the Super Admin who requested it.

## 4. Review the audit log

Inspect `provider_call_attempts` in the admin DB view (Reports → Provider Calls, or query directly):

- Filter `outcome IN ('denied','network_error')` and recent `created_at` to see every blocked attempt and the `blocked_reason` (e.g. `not_super_admin`, `invalid_token_or_replay`, `rate_limit_per_minute`, `order_placement_forbidden_for_diagnostics`, `kill_switch_enabled`).
- Filter `kind = 'blocked'` grouped by `admin_id` to identify the actor.
- Cross-check the Super Admin notification feed — every order-placement attempt, every non-admin attempt, and any burst of 3+ blocked calls within 5 minutes triggers an in-app notification.

Records older than 180 days are purged automatically by the daily `cleanup-provider-call-attempts` cron.

## 5. Re-enable diagnostics (once safe)

1. Toggle the kill switch OFF.
2. Open a **short** approval window (5–15 min) with a clear reason in the "note" field.
3. Use the freshly-issued token for **one** call; opening another window or rotating issues a new one.
4. Confirm in the audit log that the next call is `outcome = allowed` and that no follow-up bursts occur.

---

## Invariants that always hold (do not rely on humans)

- `provider-diagnostic` exposes only `balance` and `status_lookup`. Posting `action=place_order` or `action=topup` returns `400 unsupported_action`.
- `assert_provider_call_allowed(_kind => 'order_placement', ...)` always raises and emits a Super Admin alert — there is no path that returns `allowed` for order placement.
- `deliver-order` refuses any order that lacks `payment_verified_at` (Paystack) or a matching `wallet_transactions` debit row (wallet) and any row flagged `diagnostic = true`.
- Provider API keys are read from `network_api_configs` / Deno env on the server. They are never included in responses to the client.
- `notify_super_admins` is wrapped in `EXCEPTION WHEN OTHERS` — alert failures cannot break the calling RPC or the kill switch.
