
-- 1) Drop direct customer INSERT on orders — all order creation flows through SECURITY DEFINER RPCs
--    (place_order_paystack, place_order_guest_paystack, place_order, etc.) which validate amount,
--    cost_price, payment reference, and network availability server-side.
DROP POLICY IF EXISTS "Customers insert own orders" ON public.orders;

-- Keep an admin-only INSERT pathway for manual admin order creation if ever needed
DROP POLICY IF EXISTS "Admins insert orders" ON public.orders;
CREATE POLICY "Admins insert orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- 2) Drop direct customer INSERT on affiliate_withdrawals — handled by request_affiliate_withdrawal RPC
DROP POLICY IF EXISTS "Customers insert own withdrawals" ON public.affiliate_withdrawals;

-- 3) Drop direct customer INSERT on afa_registrations — handled by place_afa_wallet RPC
--    (and Paystack edge function which uses service_role)
DROP POLICY IF EXISTS "Customers insert own afa" ON public.afa_registrations;

-- Keep admin INSERT capability (admin pathway)
DROP POLICY IF EXISTS "Admins insert afa" ON public.afa_registrations;
CREATE POLICY "Admins insert afa"
ON public.afa_registrations
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- 4) Add documentation comment on the customer guard trigger
COMMENT ON FUNCTION public.guard_customer_sensitive_updates() IS
'Blocks any non-admin UPDATE on public.customers that touches financial / identity-critical columns. All such changes must go through SECURITY DEFINER RPCs.';

-- 5) Ensure RLS is enabled on every public table that holds customer-scoped data (defence in depth)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afa_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checker_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checker_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
