
-- ============================================================
-- SECURITY HARDENING: RLS Policy Overhaul + Function search_path
-- ============================================================

-- ============================================================
-- 1. Helper functions (SECURITY DEFINER, fixed search_path)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.customers WHERE auth_user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = auth.uid() AND status = 'active'
  )
$$;

-- ============================================================
-- 2. orders — customers own, admins full
-- ============================================================

DROP POLICY IF EXISTS "Allow anon delete orders" ON public.orders;
DROP POLICY IF EXISTS "Allow anon insert orders" ON public.orders;
DROP POLICY IF EXISTS "Allow anon read orders" ON public.orders;
DROP POLICY IF EXISTS "Allow anon update orders" ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated delete orders" ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated insert orders" ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated read orders" ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated update orders" ON public.orders;

CREATE POLICY "Customers read own orders or admin"
  ON public.orders FOR SELECT TO authenticated
  USING (customer_id = public.get_my_customer_id() OR public.is_admin());

CREATE POLICY "Admins update orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete orders"
  ON public.orders FOR DELETE TO authenticated
  USING (public.is_admin());

-- INSERT: handled by place_order (SECURITY DEFINER) and edge functions (service role)

-- ============================================================
-- 3. customers — own record + admin, anon SELECT for login check
-- ============================================================

DROP POLICY IF EXISTS "Allow anon delete customers" ON public.customers;
DROP POLICY IF EXISTS "Allow anon insert customers" ON public.customers;
DROP POLICY IF EXISTS "Allow anon read customers" ON public.customers;
DROP POLICY IF EXISTS "Allow anon update customers" ON public.customers;
DROP POLICY IF EXISTS "Allow authenticated delete customers" ON public.customers;
DROP POLICY IF EXISTS "Allow authenticated insert customers" ON public.customers;
DROP POLICY IF EXISTS "Allow authenticated read customers" ON public.customers;
DROP POLICY IF EXISTS "Allow authenticated update customers" ON public.customers;

CREATE POLICY "Anon read customers for login check"
  ON public.customers FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated read own or admin"
  ON public.customers FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Authenticated update own or admin"
  ON public.customers FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Admins delete customers"
  ON public.customers FOR DELETE TO authenticated
  USING (public.is_admin());

-- INSERT: handled by handle_new_user trigger (SECURITY DEFINER)

-- ============================================================
-- 4. admin_users — admin only, anon SELECT for login check
-- ============================================================

DROP POLICY IF EXISTS "Allow anon delete admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow anon insert admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow anon read admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow anon update admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated delete admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated insert admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated read admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated update admin_users" ON public.admin_users;

CREATE POLICY "Anon read admin_users for login check"
  ON public.admin_users FOR SELECT TO anon
  USING (true);

CREATE POLICY "Admins read admin_users"
  ON public.admin_users FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert admin_users"
  ON public.admin_users FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update admin_users"
  ON public.admin_users FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete admin_users"
  ON public.admin_users FOR DELETE TO authenticated
  USING (public.is_admin());

-- ============================================================
-- 5. topups — customers own, admins full
-- ============================================================

DROP POLICY IF EXISTS "Allow anon delete topups" ON public.topups;
DROP POLICY IF EXISTS "Allow anon insert topups" ON public.topups;
DROP POLICY IF EXISTS "Allow anon read topups" ON public.topups;
DROP POLICY IF EXISTS "Allow anon update topups" ON public.topups;
DROP POLICY IF EXISTS "Allow authenticated delete topups" ON public.topups;
DROP POLICY IF EXISTS "Allow authenticated insert topups" ON public.topups;
DROP POLICY IF EXISTS "Allow authenticated read topups" ON public.topups;
DROP POLICY IF EXISTS "Allow authenticated update topups" ON public.topups;

CREATE POLICY "Customers read own topups or admin"
  ON public.topups FOR SELECT TO authenticated
  USING (customer_id = public.get_my_customer_id() OR public.is_admin());

CREATE POLICY "Admins update topups"
  ON public.topups FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete topups"
  ON public.topups FOR DELETE TO authenticated
  USING (public.is_admin());

-- INSERT: handled by edge functions (verify-paystack, paystack-webhook) using service role

-- ============================================================
-- 6. price_items — public read, admin write
-- ============================================================

DROP POLICY IF EXISTS "Allow anon delete price_items" ON public.price_items;
DROP POLICY IF EXISTS "Allow anon insert price_items" ON public.price_items;
DROP POLICY IF EXISTS "Allow anon update price_items" ON public.price_items;
DROP POLICY IF EXISTS "Allow public read price_items" ON public.price_items;
DROP POLICY IF EXISTS "Allow authenticated delete price_items" ON public.price_items;
DROP POLICY IF EXISTS "Allow authenticated insert price_items" ON public.price_items;
DROP POLICY IF EXISTS "Allow authenticated read price_items" ON public.price_items;
DROP POLICY IF EXISTS "Allow authenticated update price_items" ON public.price_items;

CREATE POLICY "Public read price_items"
  ON public.price_items FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Admins insert price_items"
  ON public.price_items FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update price_items"
  ON public.price_items FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete price_items"
  ON public.price_items FOR DELETE TO authenticated
  USING (public.is_admin());

-- ============================================================
-- 7. network_api_configs — authenticated read, admin write
-- ============================================================

DROP POLICY IF EXISTS "Authenticated delete network_api_configs" ON public.network_api_configs;
DROP POLICY IF EXISTS "Authenticated insert network_api_configs" ON public.network_api_configs;
DROP POLICY IF EXISTS "Authenticated read network_api_configs" ON public.network_api_configs;
DROP POLICY IF EXISTS "Authenticated update network_api_configs" ON public.network_api_configs;

CREATE POLICY "Authenticated read network_api_configs"
  ON public.network_api_configs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins insert network_api_configs"
  ON public.network_api_configs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update network_api_configs"
  ON public.network_api_configs FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete network_api_configs"
  ON public.network_api_configs FOR DELETE TO authenticated
  USING (public.is_admin());

-- ============================================================
-- 8. platform_settings — public read (non-secret), admin write
-- ============================================================

DROP POLICY IF EXISTS "Allow anon insert settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Allow anon update settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Allow authenticated insert settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Allow authenticated read all settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Allow authenticated update settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Allow public read of non-secret settings" ON public.platform_settings;

CREATE POLICY "Public read non-secret settings"
  ON public.platform_settings FOR SELECT TO anon, authenticated
  USING (key <> 'paystack_secret_key');

CREATE POLICY "Admins insert settings"
  ON public.platform_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update settings"
  ON public.platform_settings FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 9. wallet_transactions — customers own, admins full read + insert
-- ============================================================

DROP POLICY IF EXISTS "Anon read wallet_transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Authenticated insert wallet_transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Authenticated read wallet_transactions" ON public.wallet_transactions;

CREATE POLICY "Customers read own transactions or admin"
  ON public.wallet_transactions FOR SELECT TO authenticated
  USING (customer_id = public.get_my_customer_id() OR public.is_admin());

CREATE POLICY "Admins insert wallet_transactions"
  ON public.wallet_transactions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ============================================================
-- 10. affiliate_withdrawals — customers own, admins manage
-- ============================================================

DROP POLICY IF EXISTS "Anon read affiliate_withdrawals" ON public.affiliate_withdrawals;
DROP POLICY IF EXISTS "Authenticated insert affiliate_withdrawals" ON public.affiliate_withdrawals;
DROP POLICY IF EXISTS "Authenticated read affiliate_withdrawals" ON public.affiliate_withdrawals;
DROP POLICY IF EXISTS "Authenticated update affiliate_withdrawals" ON public.affiliate_withdrawals;

CREATE POLICY "Customers read own withdrawals or admin"
  ON public.affiliate_withdrawals FOR SELECT TO authenticated
  USING (customer_id = public.get_my_customer_id() OR public.is_admin());

CREATE POLICY "Customers insert own withdrawals"
  ON public.affiliate_withdrawals FOR INSERT TO authenticated
  WITH CHECK (customer_id = public.get_my_customer_id());

CREATE POLICY "Admins update withdrawals"
  ON public.affiliate_withdrawals FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 11. admin_activity_logs — admin only
-- ============================================================

DROP POLICY IF EXISTS "Admins insert activity logs" ON public.admin_activity_logs;
DROP POLICY IF EXISTS "Admins read activity logs" ON public.admin_activity_logs;

CREATE POLICY "Admins read activity logs"
  ON public.admin_activity_logs FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert activity logs"
  ON public.admin_activity_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ============================================================
-- 12. login_attempts — anon+auth insert, admin read
-- ============================================================

DROP POLICY IF EXISTS "Anon insert login attempts" ON public.login_attempts;
DROP POLICY IF EXISTS "Anon read login attempts" ON public.login_attempts;
DROP POLICY IF EXISTS "Authenticated insert login attempts" ON public.login_attempts;
DROP POLICY IF EXISTS "Authenticated read login attempts" ON public.login_attempts;

CREATE POLICY "Anyone can insert login attempts"
  ON public.login_attempts FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins read login attempts"
  ON public.login_attempts FOR SELECT TO authenticated
  USING (public.is_admin());

-- ============================================================
-- 13. security_logs — keep insert open, restrict read to own + admin
-- ============================================================

DROP POLICY IF EXISTS "Anon insert security logs" ON public.security_logs;
DROP POLICY IF EXISTS "Authenticated insert security logs" ON public.security_logs;
DROP POLICY IF EXISTS "Users read own security logs" ON public.security_logs;

CREATE POLICY "Anyone can insert security logs"
  ON public.security_logs FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Users read own or admin reads all"
  ON public.security_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================
-- 14. Fix function search_path warnings
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_order_short_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.short_id IS NULL OR NEW.short_id = '' THEN
    NEW.short_id := 'ORD-' || nextval('orders_short_id_seq')::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_topup_short_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.short_id IS NULL OR NEW.short_id = '' THEN
    NEW.short_id := 'TOP-' || nextval('topups_short_id_seq')::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_customer_signup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.email IS NULL OR trim(NEW.email) = '' THEN
    RAISE EXCEPTION 'Email is required for signup';
  END IF;
  IF NEW.email !~ '^[^@ ]+@[^@ ]+\.[^@ ]{2,}$' THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  IF NEW.phone IS NULL OR trim(NEW.phone) = '' THEN
    RAISE EXCEPTION 'Phone number is required for signup';
  END IF;
  IF NEW.phone !~ '^(0[235][0-9]{8}|(\+?233)[235][0-9]{8})$' THEN
    RAISE EXCEPTION 'A valid Ghana phone number is required';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_terminal_order_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  terminal_statuses text[] := ARRAY['delivered', 'rejected', 'refunded', 'customer_cancelled', 'cancelled_before_processing'];
BEGIN
  IF OLD.status = ANY(terminal_statuses) AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change order status from terminal status "%". This order is permanently closed.', OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;
