GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT SELECT ON public.stores TO anon;
GRANT ALL ON public.stores TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_products TO authenticated;
GRANT SELECT ON public.store_products TO anon;
GRANT ALL ON public.store_products TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_wallets TO authenticated;
GRANT ALL ON public.store_wallets TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_withdrawals TO authenticated;
GRANT ALL ON public.store_withdrawals TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_orders TO authenticated;
GRANT ALL ON public.store_orders TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_visits TO authenticated;
GRANT SELECT, INSERT ON public.store_visits TO anon;
GRANT ALL ON public.store_visits TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_product_clicks TO authenticated;
GRANT SELECT, INSERT ON public.store_product_clicks TO anon;
GRANT ALL ON public.store_product_clicks TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_checkout_initiations TO authenticated;
GRANT SELECT, INSERT ON public.store_checkout_initiations TO anon;
GRANT ALL ON public.store_checkout_initiations TO service_role;