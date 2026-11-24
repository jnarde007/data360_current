
-- 1. Remove customer/anon column access to orders.cost_price.
--    Admin reads continue through the public.orders_admin view (view owner retains privileges).
REVOKE SELECT (cost_price) ON public.orders FROM authenticated;
REVOKE SELECT (cost_price) ON public.orders FROM anon;

-- 2. Remove customer/anon access to customers.transaction_pin_hash.
--    PIN verification happens server-side via SECURITY DEFINER paths / service_role.
REVOKE SELECT (transaction_pin_hash) ON public.customers FROM authenticated;
REVOKE SELECT (transaction_pin_hash) ON public.customers FROM anon;

-- 3. Explicit INSERT policy for service_role on login_attempts so brute-force tracking
--    from edge functions cannot silently fail.
DROP POLICY IF EXISTS "Service role inserts login attempts" ON public.login_attempts;
CREATE POLICY "Service role inserts login attempts"
ON public.login_attempts
FOR INSERT
TO service_role
WITH CHECK (true);

GRANT INSERT ON public.login_attempts TO service_role;
