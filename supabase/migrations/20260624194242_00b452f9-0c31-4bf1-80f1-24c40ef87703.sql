-- Fix This Week, Migration 2/3: SECURITY DEFINER view conversion.

-- 1) network_api_configs: allow anon to read ONLY (network, available_for_purchase)
GRANT SELECT (network, available_for_purchase) ON public.network_api_configs TO anon;
DROP POLICY IF EXISTS "Anon read network availability" ON public.network_api_configs;
CREATE POLICY "Anon read network availability"
  ON public.network_api_configs FOR SELECT
  TO anon
  USING (true);

ALTER VIEW public.available_networks SET (security_invoker = on);

-- 2) price_items: allow anon to read safe columns for the public price list
GRANT SELECT (id, network, product, size, price) ON public.price_items TO anon;
DROP POLICY IF EXISTS "Anon read price items" ON public.price_items;
CREATE POLICY "Anon read price items"
  ON public.price_items FOR SELECT
  TO anon
  USING (true);

ALTER VIEW public.public_price_items SET (security_invoker = on);

-- 3) checker_products: anon can read only active rows, safe columns only
GRANT SELECT (id, name, exam_type, price, status, created_at, updated_at)
  ON public.checker_products TO anon;
DROP POLICY IF EXISTS "Anon read active checker products" ON public.checker_products;
CREATE POLICY "Anon read active checker products"
  ON public.checker_products FOR SELECT
  TO anon
  USING (status = 'active');

ALTER VIEW public.checker_products_public SET (security_invoker = on);

-- 4) orders_admin: stays SECURITY DEFINER (admin aggregation), but revoke anon SELECT.
REVOKE SELECT ON public.orders_admin FROM anon;
REVOKE SELECT ON public.orders_admin FROM PUBLIC;
GRANT SELECT ON public.orders_admin TO authenticated;
