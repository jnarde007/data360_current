
ALTER TABLE public.store_orders REPLICA IDENTITY FULL;
ALTER TABLE public.store_visits REPLICA IDENTITY FULL;
ALTER TABLE public.store_product_clicks REPLICA IDENTITY FULL;
ALTER TABLE public.store_checkout_initiations REPLICA IDENTITY FULL;
ALTER TABLE public.store_wallets REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='store_orders') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.store_orders';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='store_visits') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.store_visits';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='store_product_clicks') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.store_product_clicks';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='store_checkout_initiations') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.store_checkout_initiations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='store_wallets') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.store_wallets';
  END IF;
END $$;
