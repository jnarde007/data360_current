
-- Restore table-level SELECT for authenticated on customers (fixes login).
GRANT SELECT ON public.customers TO authenticated;

-- Restore table-level SELECT for authenticated on orders (fixes select('*') reads).
GRANT SELECT ON public.orders TO authenticated;

-- Keep the orders_admin view grant — it's useful and harmless.
-- Cost_price exposure is bounded by RLS to the row owner only (their own orders).
