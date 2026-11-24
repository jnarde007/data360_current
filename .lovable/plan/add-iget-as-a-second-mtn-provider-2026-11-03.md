# Add iGet as a second MTN provider

## What will remain unchanged

- Keep the existing Portal02 integration, credentials, delivery path and tracking.
- Preserve the website design, customer purchase screens, selling prices, customer wallets, commissions and existing refund policy.
- Keep AT and Telecel integrations and their current availability/API toggles unchanged.
- Never move existing orders between providers or place real purchases during testing.

## Inspection findings

- The application already has separate Portal02 and iGet delivery branches, provider references on orders, provider polling, and admin settings.
- Portal02 is configured for MTN. iGet is configured for AT and Telecel.
- Current configuration has MTN API delivery disabled, AT API delivery enabled, and Telecel API delivery disabled; all three networks are available for purchase. These switches will not be silently enabled.
- Delivery currently selects the provider from the latest network configuration. It does not reliably honor the provider saved when the order was created. This must be corrected before enabling switching.
- Existing iGet polling reads credentials from each network’s configuration. New MTN iGet orders must use the iGet backend secret, not MTN’s Portal02 credentials.

## Documentation needed before enabling iGet for MTN

The public iGet website only displays “API is running…”. Its official Get Order and non-purchasing authentication documentation could not be verified.

Please provide an official documentation link, PDF, Postman collection, or written specification from iGet covering:

1. Exact Get Order endpoint, authentication, parameters and response examples.
2. A non-purchasing authentication check and its success/error responses, or confirmation that none exists.
3. Placement response fields for order reference, transaction reference, actual purchase cost, status and failure reason.
4. Whether the optional reference supports duplicate prevention and lookup after a timeout, and whether callbacks are supported or required.
5. MTN product availability and capacities for the three specified bundle types.

The supplied placement endpoint and product list will guide implementation, but existing code is not a substitute for official tracking documentation. An unverified connection will never be shown as verified. Activation will remain blocked until safe tracking is established.

## Implementation steps

### 1. Secure provider selection and order pinning

- Add an admin-only MTN provider management section to the existing admin API/settings area.
- Persist Portal02/iGet selection, MTN iGet bundle type, last switch time and administrator with a tracked migration and server-side authorization.
- Default to Portal02; do not change existing network credentials or toggles.
- Centralize provider assignment at order insertion so wallet, registered Paystack, guest, store and reprocessed purchases all receive a trusted provider choice.
- Snapshot the MTN bundle type with the order. An administrator’s later changes must not affect existing purchases.
- Preserve legacy order associations using existing provider evidence; unresolved legacy orders must not inherit a later selection.
- Require the exact requested confirmation before saving a switch, and audit every successful switch.

### 2. Safe delivery and independent tracking

- Make the existing delivery function honor the pinned provider, leaving Portal02’s request branch intact.
- Add MTN-specific iGet configuration using backend-only `IGET_API_KEY` and the supplied base URL.
- Validate phone, supported capacity and selected bundle type before submission. Keep AT/Telecel validation and payloads unchanged.
- Generate and persist a unique submission reference before calling iGet; preserve returned order and transaction references and documented purchase-cost evidence separately from existing financial calculations.
- Add explicit timeout/uncertain-response protection so a submitted purchase is not automatically retried, refunded or sent to another provider.
- Extend iGet’s existing poller for pinned MTN iGet orders only after verifying the official endpoint. Keep Portal02 polling independent.
- Map iGet `pending`, `processing`, `completed` and `failed` from provider order status, never HTTP success alone.
- Use the existing guarded provider-diagnostic channel for any documented read-only authentication check. Never probe guessed endpoints.

### 3. Admin reporting

- Display active provider and separately labeled Portal02/iGet connection evidence, including unknown/unverified states.
- Add provider and date filters with per-provider total, successful, failed and pending counts.
- Show provider purchase costs separately from customer wallet balances; successful-order revenue excludes Paystack processing fees.
- Distinguish realized profit from pending estimates, and exclude failed/refunded/cancelled orders from successful financial totals.
- Identify the saved provider in order history without redesigning customer purchase screens.

### 4. Verification and handover

- Run focused tests for both switching directions, immutable existing-order associations, all creation channels, authorization, persistence, supported capacities/types, returned references, status mapping and timeout/duplicate protection.
- Test financial behavior in isolated or rolled-back database transactions, with outbound purchases disabled.
- Check the admin controls and reports in desktop and mobile layouts using an authorized session when available.
- Check the automatic preview build and relevant regression tests.
- Report changed files, database changes, secret configuration, switching instructions, tracking behavior, test results and any remaining blockers.
- Do not claim Portal02/AT/Telecel live purchases were verified without authorized real transactions. No real purchase or deployment will be initiated as a test.

## Technical approach

- Reuse React components, existing order fields, server-side admin validation and tracked SQL migrations.
- Prefer a shared insert-time routing trigger/helper over rewriting the wallet and Paystack purchase functions. This centralizes provider pinning across all channels without replacing their payment logic.
- Add only the order metadata genuinely needed for immutable bundle selection, submission safety and provider evidence.
- Apply grants and RLS to any new application table. Keep secrets out of browser code, public settings and reports.
- Do not modify managed client initialization or connect a second backend.

## Current boundary

Inspection is complete; no application code, database records, provider configuration, credentials, orders or deployment have been changed. Only the requirements, task list and this plan have been recorded.