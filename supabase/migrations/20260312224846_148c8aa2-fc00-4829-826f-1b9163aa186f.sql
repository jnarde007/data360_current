
-- Fix: available_networks view needs to work for non-admin authenticated users
-- Since security_invoker passes through caller's RLS (admin-only), customers get 0 rows
-- Solution: remove security_invoker so view runs with owner privileges (safe because view only exposes non-sensitive columns)
DROP VIEW IF EXISTS public.available_networks;

CREATE VIEW public.available_networks AS
  SELECT network, available_for_purchase
  FROM public.network_api_configs
  WHERE available_for_purchase = true;

-- Grant read to authenticated users
GRANT SELECT ON public.available_networks TO authenticated;

-- Also fix public_price_items view (same issue - security_invoker blocks non-admin access to base table... actually price_items has public SELECT, so it's fine)
-- Verify: price_items has "Public read price_items" with USING(true) for anon,authenticated - so security_invoker works fine there
