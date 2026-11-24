DROP POLICY IF EXISTS "store_visits_public_insert" ON public.store_visits;
CREATE POLICY "store_visits_public_insert"
  ON public.store_visits
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_visits.store_id
        AND s.status = 'active'
    )
  );

DROP POLICY IF EXISTS "store_product_clicks_public_insert" ON public.store_product_clicks;
CREATE POLICY "store_product_clicks_public_insert"
  ON public.store_product_clicks
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_product_clicks.store_id
        AND s.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.store_products sp
      WHERE sp.id = store_product_clicks.store_product_id
        AND sp.store_id = store_product_clicks.store_id
        AND sp.active = true
    )
  );