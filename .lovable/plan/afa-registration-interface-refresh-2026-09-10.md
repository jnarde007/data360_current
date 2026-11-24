# AFA Registration Interface Refresh

## Scope
Improve only the presentation of the admin AFA registration page and the registered-customer AFA page. Preserve all existing data access, permissions, submissions, payments, statuses, and admin actions.

## Admin AFA view
- Keep search, status filtering, sorting, details expansion, and Approve/Reject/Edit behavior unchanged.
- Redesign each record as a compact sectioned dossier with a prominent status, reference, amount, and readable submission timestamp.
- Clearly separate **Placed By** (existing buyer phone/email/type) from **Beneficiary / Registration Details** (existing beneficiary name, registration number, and location).
- Group existing payment details and system identifiers into clearly labeled sections.
- Keep final-status locking and confirmation dialogs unchanged.

## Customer AFA view
- Keep the registration form and all submission/payment behavior unchanged.
- Redesign history records to show status and lifecycle context first, followed by reference, submitted date/time, beneficiary details, payment amount/method/status, and any existing customer-visible note.
- Do not expose internal IDs, provider data, costs, or records belonging to another customer.

## Visual direction
- Use the selected DATA360 blue and AFA gold treatment through existing semantic theme styles.
- Follow the selected Outfit/Figtree hierarchy already represented by the app’s display/body typography.
- Use compact sectioned records, restrained semantic badges, clear spacing, and responsive stacking.

## Data limitations
- Admin buyer name is not present in the page’s existing frontend data, so **Placed By** will use buyer phone, email, and buyer type only.
- Admin payment status and updated timestamp are not present in the existing frontend data and will not be invented.
- Customer history does not currently receive location, so location will not be added.

## Verification
- Check desktop and mobile layouts for both pages.
- Verify admin Details, Approve, Reject, and Edit controls remain wired to their original handlers.
- Run focused lint/tests and review the preview build diagnostics.
- Confirm no backend, database, security policy, API, authentication, payment, or AFA business-logic files changed.
