
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. orders.cost_price — hide from authenticated/anon, keep available to admins
--    via the existing SECURITY DEFINER view `public.orders_admin`.
-- ─────────────────────────────────────────────────────────────────────────────

-- Grant SELECT on the admin view so admin pages can read cost_price through it.
GRANT SELECT ON public.orders_admin TO authenticated;
GRANT ALL    ON public.orders_admin TO service_role;

-- Revoke broad table-level SELECT, then re-grant on every column EXCEPT cost_price.
REVOKE SELECT ON public.orders FROM authenticated;
REVOKE SELECT ON public.orders FROM anon;

GRANT SELECT (
  id, customer_id, network, bundle_size, recipient_phone, quantity,
  total_amount, status, created_at, short_id, delivery_mode, provider_name,
  provider_order_id, provider_reference, provider_response, webhook_history,
  grace_period_ends_at, payment_method, payment_reference, payment_verified_at,
  buyer_type, buyer_phone, buyer_email, tracking_token, linked_customer_id,
  affiliate_code, detected_network
) ON public.orders TO authenticated;

-- service_role keeps full access (bypasses column grants anyway, but explicit).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. customers.transaction_pin_hash — never readable from the client.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE SELECT ON public.customers FROM authenticated;
REVOKE SELECT ON public.customers FROM anon;

GRANT SELECT (
  id, full_name, email, phone, wallet_balance, affiliate_code, referred_by,
  status, created_at, auth_user_id, total_commission, available_commission,
  deleted_at, anonymized_at, email_verified, username, notification_preferences
) ON public.customers TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO service_role;
