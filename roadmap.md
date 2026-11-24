# MTN second-provider integration (final spec: two mutually exclusive toggles)

## MTN customer verification wording
- [x] Update shared verification messages and customer recheck label without changing verification or checkout rules.
- [x] Existing verification tests passed (5); mobile/light/dark and desktop status rendering checked with controlled responses on signed-in checkout, including rechecking and silent fallback. No purchases made. No separate failed/unsupported state exists, so no new state or automatic-refund promise was added.

## MTN iGet status-check repair
- [x] Confirm repeated wrong-provider status requests against current code and live logs.
- [x] Share MTN iGet URL/key resolution between delivery and polling without changing purchase or refund rules.
- [x] Diagnostic routing verified: it selects by provider (the MTN row is Portal-02), so it already uses AT/Telecel iGet settings; no diagnostic change needed. All 41 regression tests passed. Deployed delivery/poller; the 06:38 UTC cron confirmed completed and marked ORD-6031 and ORD-6033 delivered without resubmission.

- [x] iGet tracking confirmed reusable: existing AT/Telecel iGet integration uses the same place + Get-Order-by-Reference endpoints.
- [x] Replace single-select provider setting with two mutually exclusive toggles (Portal-02 API / iGet API), enforced in DB and UI.
- [x] Pin provider (Manual / Portal-02 / iGet) at order creation for all channels; both OFF = manual workflow.
- [x] deliver-order: honor pinned provider, iGet MTN via IGET_API_KEY + saved bundle type; uncertain submissions never retried or auto-rerouted.
- [x] Admin UI: two toggles, delivery mode display, confirmation on switch; keep provider reporting.
- [x] Test all scenarios without real purchases; verify AT/Telecel and Portal-02 untouched. Super Admin UI verified live (toggle on/off, confirmation dialog, mode banner, settings restored to manual).
- [x] Final report delivered. Remaining setup step for user: add IGET_API_KEY secret before enabling the iGet toggle.

# MTN iGet configuration UI redesign (UI/UX only)

- [x] Add a clearly labelled "MTN iGet API Configuration" section styled like the MTN/Portal-02 config card: status banner (Manual Processing / IGET AUTOMATIC DELIVERY), enable toggle, read-only base URL, masked API key (backend secret, never displayed), provider name, bundle type, webhook info, one Save button.
- [x] Relabel the generic MTN network card as "MTN / Portal-02" for visual consistency.
- [x] No DB/backend/routing/auth changes; keep MTN Provider Management switcher and reporting intact.
- [x] Verify: config values preserved, toggles still work, banner changes, Portal-02 + reporting untouched, build passes, Super Admin UI check.

# MTN iGet UI simplification (UI/UX only)

- [x] Remove the large "MTN iGet API Configuration" section and the Last change / Changed by block.
- [x] Add a simple "MTN / iGet" provider card matching the existing network card pattern (Available for Customers, API Delivery, Base URL, API Key, API Secret, Provider Name, Bundle Type, Webhook URL, Save button).
- [x] Keep MTN Provider Management switcher as the ONLY provider-selection control (no duplicate toggles in the card); keep reporting below.
- [x] No DB/backend/routing/auth changes; verify save/read of bundle type, toggles, build, Super Admin UI check.

# Lively card design

- [x] Network-tinted top stripe, header glow, and order summary on Buy Data, Guest, and Checker cards.
