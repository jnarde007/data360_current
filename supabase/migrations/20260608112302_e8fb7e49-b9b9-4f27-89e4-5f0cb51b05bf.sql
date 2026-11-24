DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='stores') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.stores';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='store_products') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.store_products';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='store_withdrawals') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.store_withdrawals';
  END IF;
END $$;

ALTER TABLE public.stores REPLICA IDENTITY FULL;
ALTER TABLE public.store_products REPLICA IDENTITY FULL;
ALTER TABLE public.store_withdrawals REPLICA IDENTITY FULL;
ALTER TABLE public.store_orders REPLICA IDENTITY FULL;
ALTER TABLE public.store_wallets REPLICA IDENTITY FULL;
ALTER TABLE public.store_visits REPLICA IDENTITY FULL;
ALTER TABLE public.store_product_clicks REPLICA IDENTITY FULL;
ALTER TABLE public.store_checkout_initiations REPLICA IDENTITY FULL;