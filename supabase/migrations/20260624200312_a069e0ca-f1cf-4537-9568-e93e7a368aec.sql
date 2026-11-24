DROP POLICY IF EXISTS "Anon read network availability" ON public.network_api_configs;
DROP POLICY IF EXISTS "Anon read price items" ON public.price_items;
REVOKE SELECT ON public.network_api_configs FROM anon;
REVOKE SELECT ON public.price_items FROM anon;