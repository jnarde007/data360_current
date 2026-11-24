// Content for the customer-facing API docs. Placeholders only — never real keys, phones or balances.
export const API_BASE = 'https://bpntlyplmitxiaounthf.supabase.co/functions/v1/developer-api';

const curlGet = (p: string) => `curl "${API_BASE}${p}" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`;
const jsGet = (p: string) => `const res = await fetch("${API_BASE}${p}", {\n  headers: { Authorization: \`Bearer \${process.env.DATA360_API_KEY}\` },\n});\nconst data = await res.json();`;

const AUTH_ERR = '401 invalid, missing or inactive key';
const SA_ERR = '401 invalid key · 403 Super Agent access required';
const PKG = '00000000-0000-0000-0000-000000000001';
const ORDER = '00000000-0000-0000-0000-0000000000aa';

export type DocEndpoint = {
  anchor: string; method: 'GET' | 'POST'; path: string; purpose: string; access: string;
  paramsTitle?: string; params?: [string, string][]; curl: string; js: string; response: string; errors: string;
};

export const DOC_ENDPOINTS: DocEndpoint[] = [
  {
    anchor: 'verify', method: 'GET', path: '/v1/auth/verify', purpose: 'Check that your API key works.',
    access: 'Any active API key.', curl: curlGet('/v1/auth/verify'), js: jsGet('/v1/auth/verify'),
    response: `{\n  "success": true,\n  "customer_id": "YOUR_CUSTOMER_ID",\n  "message": "Authentication successful"\n}`,
    errors: AUTH_ERR,
  },
  {
    anchor: 'packages', method: 'GET', path: '/v1/packages', purpose: 'List the data bundles you can buy right now. Prices shown are the standard prices; Super Agent purchases are charged your Super Agent price.',
    access: 'Any active API key.', curl: curlGet('/v1/packages'), js: jsGet('/v1/packages'),
    response: `{\n  "success": true,\n  "packages": [\n    { "id": "${PKG}", "network": "MTN", "size": "1GB", "price": 4.5, "currency": "GHS", "status": "available" }\n  ]\n}`,
    errors: AUTH_ERR,
  },
  {
    anchor: 'wallet', method: 'GET', path: '/v1/wallet', purpose: 'Read your current wallet balance.',
    access: 'Active Super Agent.', curl: curlGet('/v1/wallet'), js: jsGet('/v1/wallet'),
    response: `{\n  "success": true,\n  "customer_id": "YOUR_CUSTOMER_ID",\n  "wallet_balance": 100.0,\n  "currency": "GHS"\n}`,
    errors: SA_ERR,
  },
  {
    anchor: 'create-purchase', method: 'POST', path: '/v1/purchases', purpose: 'Buy a data bundle for a recipient, paid from your wallet.',
    access: 'Active Super Agent.', paramsTitle: 'Headers and body',
    params: [
      ['Idempotency-Key (header, required)', 'your unique value, 8–255 characters, e.g. a UUID'],
      ['package_id (required)', 'an id from /v1/packages'],
      ['recipient_phone (required)', 'Ghana number, e.g. 0241234567 or +233241234567'],
      ['client_reference (optional)', 'your own reference, up to 100 characters'],
    ],
    curl: `curl -X POST "${API_BASE}/v1/purchases" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: 7f3c1e2a-unique-per-purchase" \\\n  -d '{"package_id":"${PKG}","recipient_phone":"0240000000","client_reference":"MY-REF-001"}'`,
    js: `const res = await fetch("${API_BASE}/v1/purchases", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.DATA360_API_KEY}\`,\n    "Content-Type": "application/json",\n    "Idempotency-Key": crypto.randomUUID(), // reuse the same value when retrying this purchase\n  },\n  body: JSON.stringify({\n    package_id: "${PKG}",\n    recipient_phone: "0240000000",\n    client_reference: "MY-REF-001",\n  }),\n});\nconst data = await res.json();`,
    response: `// 201 Created (200 with "idempotent_replay": true on a safe retry)\n{\n  "success": true,\n  "order_id": "${ORDER}",\n  "short_id": "ORD-0000",\n  "status": "pending",\n  "amount_charged": 4.05,\n  "currency": "GHS",\n  "client_reference": "MY-REF-001"\n}`,
    errors: '400 invalid body or missing Idempotency-Key · 401 · 402 insufficient wallet balance · 403 · 404 package not found · 409 key reused / recipient has an active order · 422 invalid or wrong-network number · 503 network temporarily unavailable',
  },
  {
    anchor: 'list-purchases', method: 'GET', path: '/v1/purchases', purpose: 'List purchases made with the API, newest first. Website purchases are not included.',
    access: 'Active Super Agent.', paramsTitle: 'Query parameters (all optional)',
    params: [
      ['limit', '1–100, default 20'], ['offset', '0–100000, default 0'],
      ['status', 'pending_confirmation, pending, submitting, processing, delivered, failed, rejected or customer_cancelled'],
      ['from / to', 'YYYY-MM-DD or a full ISO timestamp'],
    ],
    curl: curlGet('/v1/purchases?limit=20&status=delivered'), js: jsGet('/v1/purchases?limit=20&status=delivered'),
    response: `{\n  "success": true,\n  "purchases": [ /* same fields as the lookup below */ ],\n  "pagination": { "limit": 20, "offset": 0, "total": 1 }\n}`,
    errors: '400 invalid parameter · ' + SA_ERR,
  },
  {
    anchor: 'get-purchase', method: 'GET', path: '/v1/purchases/{order_id}', purpose: 'Look up one API purchase by its order id or short id (e.g. ORD-0000).',
    access: 'Active Super Agent. Only your own API purchases.', curl: curlGet('/v1/purchases/ORD-0000'), js: jsGet('/v1/purchases/ORD-0000'),
    response: `{\n  "success": true,\n  "purchase": {\n    "order_id": "${ORDER}",\n    "short_id": "ORD-0000",\n    "client_reference": "MY-REF-001",\n    "network": "MTN",\n    "bundle_size": "1GB",\n    "recipient_phone": "0240000000",\n    "amount_charged": 4.05,\n    "currency": "GHS",\n    "status": "delivered",\n    "status_description": "Delivered",\n    "created_at": "2026-01-01T10:00:00.000Z",\n    "updated_at": "2026-01-01T10:02:00.000Z",\n    "completed_at": "2026-01-01T10:02:00.000Z",\n    "failure_reason": null,\n    "refund": null\n  }\n}`,
    errors: SA_ERR + ' · 404 order not found',
  },
  {
    anchor: 'usage', method: 'GET', path: '/v1/usage', purpose: 'Summary of your API purchases: totals by status, total charged, this month and last month.',
    access: 'Active Super Agent. Takes no query parameters.', curl: curlGet('/v1/usage'), js: jsGet('/v1/usage'),
    response: `{\n  "success": true,\n  "currency": "GHS",\n  "purchases": {\n    "total_purchases": 3,\n    "delivered": 2,\n    "failed_or_rejected": 1,\n    "pending_or_processing": 0,\n    "total_amount_charged": 12.15,\n    "current_month": { "month": "2026-01", "purchases": 3, "amount_charged": 12.15 },\n    "previous_month": { "month": "2025-12", "purchases": 0, "amount_charged": 0 }\n  },\n  "api_requests": { "available": false, "note": "Request-level statistics are not recorded yet" }\n}`,
    errors: '400 if query parameters are sent · ' + SA_ERR,
  },
  {
    anchor: 'usage-history', method: 'GET', path: '/v1/usage/history', purpose: 'Daily API purchase activity, one row per day (including days with none).',
    access: 'Active Super Agent.', paramsTitle: 'Query parameters (optional)',
    params: [['from', 'YYYY-MM-DD, default 29 days before "to"'], ['to', 'YYYY-MM-DD, default today (UTC)'], ['range', 'at most 92 days']],
    curl: curlGet('/v1/usage/history?from=2026-01-01&to=2026-01-31'), js: jsGet('/v1/usage/history?from=2026-01-01&to=2026-01-31'),
    response: `{\n  "success": true,\n  "currency": "GHS",\n  "from": "2026-01-01",\n  "to": "2026-01-31",\n  "days": [\n    { "date": "2026-01-01", "purchases": 2, "amount_charged": 8.1, "delivered": 2, "failed_or_rejected": 0 }\n  ]\n}`,
    errors: '400 invalid or too-long date range · ' + SA_ERR,
  },
];

export const ERROR_ROWS: [string, string, string][] = [
  ['400', 'varies, e.g. "limit must be an integer between 1 and 100"', 'Invalid request, parameter or body, or missing Idempotency-Key.'],
  ['401', 'Invalid or inactive API key', 'Key missing, wrong, revoked, or the account is not active.'],
  ['402', 'Insufficient wallet balance', 'Top up your wallet before buying.'],
  ['403', 'Super Agent access required', 'This endpoint needs active Super Agent access on an active account.'],
  ['404', 'Order not found / Package not found / Not found', 'Unknown order or package, an order that is not yours, or an unknown address.'],
  ['405', 'Method not allowed', 'Wrong HTTP method for this address.'],
  ['409', 'Idempotency-Key was already used with a different request', 'Use a new Idempotency-Key for a new purchase.'],
  ['409', 'Recipient already has an active order', 'Wait until the current order for this number finishes.'],
  ['422', 'Invalid recipient phone number', 'Use a valid Ghana number.'],
  ['422', 'Recipient number does not belong to the package network', 'The number is on a different network from the bundle.'],
  ['500', 'Internal server error', 'Something went wrong on our side. Retry with the same Idempotency-Key.'],
  ['503', 'Network temporarily unavailable', 'This network is paused for purchases. Try again later.'],
];
