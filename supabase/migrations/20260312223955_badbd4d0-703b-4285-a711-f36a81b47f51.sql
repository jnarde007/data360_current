
-- 1. Belt-and-suspenders: re-revoke UPDATE on customers for anon too, and re-apply column grants
REVOKE UPDATE ON public.customers FROM anon;
REVOKE UPDATE ON public.customers FROM authenticated;
GRANT UPDATE (full_name, phone, transaction_pin_hash) ON public.customers TO authenticated;
GRANT UPDATE ON public.customers TO service_role;

-- 2. Fix price_items: create a safe view without cost_price
CREATE OR REPLACE VIEW public.public_price_items
  WITH (security_invoker = true) AS
  SELECT id, network, product, size, price
  FROM public.price_items;

GRANT SELECT ON public.public_price_items TO anon, authenticated;

-- 3. available_networks is a VIEW (not a table), so RLS doesn't apply — it inherits from base table via security_invoker
-- This is a false positive, no action needed
