
-- One non-deleted store per customer
CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_one_per_owner_active
  ON public.stores(owner_id)
  WHERE status <> 'deleted';

-- create_store: enforce single store + start as pending
CREATE OR REPLACE FUNCTION public.create_store(p_name text, p_slug text, p_description text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
  v_existing uuid;
  v_id uuid;
BEGIN
  v_customer_id := public.get_my_customer_id();
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_existing
  FROM public.stores
  WHERE owner_id = v_customer_id AND status <> 'deleted'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a store. Each customer can only own one store.';
  END IF;

  INSERT INTO public.stores(owner_id, name, slug, description, status)
  VALUES (v_customer_id, trim(p_name), lower(trim(p_slug)), COALESCE(p_description,''), 'pending')
  RETURNING id INTO v_id;

  INSERT INTO public.store_wallets(owner_id) VALUES (v_customer_id)
  ON CONFLICT (owner_id) DO NOTHING;

  RETURN json_build_object('store_id', v_id, 'status', 'pending');
END $$;
