
-- 1) login_attempts: remove public insert ability
DROP POLICY IF EXISTS "Anyone can insert login attempts" ON public.login_attempts;
REVOKE INSERT ON public.login_attempts FROM anon, authenticated;
GRANT INSERT ON public.login_attempts TO service_role;

-- 2) orders.cost_price: hide from customers (and from any authenticated direct read)
REVOKE SELECT (cost_price) ON public.orders FROM anon, authenticated;

-- Admin-only view so admin pages can still read cost_price
CREATE OR REPLACE VIEW public.admin_orders_with_cost
WITH (security_invoker=off) AS
SELECT * FROM public.orders WHERE public.is_admin();

GRANT SELECT ON public.admin_orders_with_cost TO authenticated;
GRANT ALL ON public.admin_orders_with_cost TO service_role;

-- 3) otp_codes: revoke admin read; OTPs should be opaque even to admins.
--    Verification flow uses the service role and bypasses RLS.
DROP POLICY IF EXISTS "Admins read otp_codes" ON public.otp_codes;
