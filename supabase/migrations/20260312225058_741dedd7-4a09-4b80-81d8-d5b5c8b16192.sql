
-- Update public_price_items to include cost_price for authenticated order placement
-- This is needed because place_order() currently accepts p_cost_price from the client
DROP VIEW IF EXISTS public.public_price_items;

CREATE VIEW public.public_price_items AS
  SELECT id, network, product, size, price, cost_price
  FROM public.price_items;

-- Only authenticated users (not anon) since cost_price is included
GRANT SELECT ON public.public_price_items TO authenticated;
