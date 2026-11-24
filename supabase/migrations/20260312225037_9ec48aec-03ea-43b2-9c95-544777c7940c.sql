
-- Fix public_price_items view: remove security_invoker so non-admins can read through it
-- (safe because it only exposes id, network, product, size, price — no cost_price)
DROP VIEW IF EXISTS public.public_price_items;

CREATE VIEW public.public_price_items AS
  SELECT id, network, product, size, price
  FROM public.price_items;

GRANT SELECT ON public.public_price_items TO anon, authenticated;
