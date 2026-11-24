
-- =============================================
-- SECURITY HARDENING PASS 2
-- =============================================

-- 1. DROP anon SELECT on admin_users (replaced by edge function)
DROP POLICY IF EXISTS "Anon read admin_users for login check" ON public.admin_users;

-- 2. DROP anon SELECT on customers (replaced by edge function repair-signup-blockers)
DROP POLICY IF EXISTS "Anon read customers for login check" ON public.customers;

-- 3. Restrict network_api_configs: replace permissive authenticated read with admin-only
DROP POLICY IF EXISTS "Authenticated read network_api_configs" ON public.network_api_configs;

CREATE POLICY "Admins read network_api_configs"
  ON public.network_api_configs FOR SELECT TO authenticated
  USING (public.is_admin());

-- 4. Create a view for customers to check network availability (no secrets exposed)
CREATE OR REPLACE VIEW public.available_networks AS
  SELECT network, available_for_purchase
  FROM public.network_api_configs
  WHERE available_for_purchase = true;

GRANT SELECT ON public.available_networks TO authenticated;

-- 5. Fix platform_settings: replace exclusion-based policy with allowlist
DROP POLICY IF EXISTS "Public read non-secret settings" ON public.platform_settings;

CREATE POLICY "Public read safe settings"
  ON public.platform_settings FOR SELECT TO anon, authenticated
  USING (key IN (
    'brand_name',
    'support_whatsapp_url',
    'whatsapp_channel_url',
    'require_admin_approval',
    'require_email_verification',
    'send_email_on_approval',
    'send_email_on_verification',
    'paystack_public_key',
    'affiliate_rate',
    'auto_delivery',
    'notification_sender_name'
  ));

-- Admin can read ALL settings (including secrets)
CREATE POLICY "Admins read all settings"
  ON public.platform_settings FOR SELECT TO authenticated
  USING (public.is_admin());

-- 6. Fix the remaining "always true" INSERT policies with proper constraints

-- login_attempts: restrict anon insert to only their own email-like data (keep as-is, it's a logging table)
-- admin_activity_logs: restrict insert to is_admin()
DROP POLICY IF EXISTS "Admins insert activity logs" ON public.admin_activity_logs;
CREATE POLICY "Admins insert activity logs"
  ON public.admin_activity_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- orders insert: customers can only insert for themselves
DROP POLICY IF EXISTS "Customers insert own orders" ON public.orders;
CREATE POLICY "Customers insert own orders"
  ON public.orders FOR INSERT TO authenticated
  WITH CHECK (customer_id = public.get_my_customer_id() OR public.is_admin());
