
-- 1) Column-level revokes (defence-in-depth for direct Data-API SELECTs)
REVOKE SELECT (cost_price) ON public.orders FROM anon, authenticated;
REVOKE SELECT (cost_price) ON public.price_items FROM anon, authenticated;
REVOKE SELECT (transaction_pin_hash) ON public.customers FROM anon, authenticated;

-- 2) Remove anon access entirely from auth-only tables (no anon policies exist)
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.orders FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.price_items FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.customers FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.affiliate_withdrawals FROM anon;

-- 3) Strip sensitive columns from Realtime publication payload.
--    Realtime broadcasts ignore column-level GRANTs, so we must scope the publication.
ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders
  (id, customer_id, network, bundle_size, recipient_phone, quantity, total_amount,
   status, created_at, short_id, delivery_mode, provider_name, provider_order_id,
   provider_reference, provider_response, webhook_history, grace_period_ends_at,
   payment_method, payment_reference, payment_verified_at, buyer_type, buyer_phone,
   buyer_email, tracking_token, linked_customer_id, affiliate_code);

ALTER PUBLICATION supabase_realtime DROP TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers
  (id, full_name, email, phone, wallet_balance, affiliate_code, referred_by, status,
   created_at, auth_user_id, total_commission, available_commission, deleted_at,
   anonymized_at, email_verified, username, notification_preferences);

-- 4) Lock down store_checkout_initiations INSERT to validated, active stores.
DROP POLICY IF EXISTS "Anyone can record checkout initiation" ON public.store_checkout_initiations;
CREATE POLICY "Validated checkout initiation insert"
  ON public.store_checkout_initiations
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_checkout_initiations.store_id
        AND s.status = 'active'
    )
  );

-- 5) Document affiliate_withdrawals INSERT path (service_role/edge function only).
--    No authenticated INSERT policy exists; deny-by-default is intentional.
COMMENT ON TABLE public.affiliate_withdrawals IS
  'Withdrawal rows are created exclusively by the request-affiliate-withdrawal edge function (service_role) which performs atomic balance deduction and validation. Direct INSERT from authenticated clients is intentionally denied.';
