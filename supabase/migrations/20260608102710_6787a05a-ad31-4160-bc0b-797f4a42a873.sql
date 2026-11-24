-- 1) Add columns for rejection reason + timestamp
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- 2) Allow 'rejected' as a status
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_status_check;
ALTER TABLE public.stores ADD CONSTRAINT stores_status_check
  CHECK (status IN ('pending','active','suspended','rejected','deleted'));

-- 3) Rebuild unique-per-owner index so rejected/deleted don't block re-creation
DROP INDEX IF EXISTS public.ux_stores_one_per_owner_active;
CREATE UNIQUE INDEX ux_stores_one_per_owner_active
  ON public.stores(owner_id)
  WHERE status NOT IN ('deleted','rejected');

-- 4) Rework admin_delete_store: pending → rejected (preserve record), others → deleted
CREATE OR REPLACE FUNCTION public.admin_delete_store(p_store_id uuid, p_reason text DEFAULT '')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store RECORD;
  v_admin_id uuid;
  v_new_slug text;
  v_suffix text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT id INTO v_admin_id FROM public.admin_users
   WHERE auth_user_id = auth.uid() AND status='active' LIMIT 1;

  SELECT * INTO v_store FROM public.stores WHERE id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;

  IF v_store.status IN ('deleted','rejected') THEN
    RETURN json_build_object('success', true, 'already_terminal', true);
  END IF;

  -- Free slug so it can be reused
  v_suffix := substr(replace(gen_random_uuid()::text,'-',''), 1, 8);
  v_new_slug := left('del-' || v_suffix || '-' || v_store.slug, 40);
  IF right(v_new_slug, 1) = '-' THEN
    v_new_slug := left(v_new_slug, length(v_new_slug)-1) || '0';
  END IF;

  IF v_store.status = 'pending' THEN
    -- Rejection: keep the record so owner sees status + reason
    UPDATE public.stores
       SET status = 'rejected',
           rejection_reason = NULLIF(trim(p_reason), ''),
           rejected_at = now(),
           slug = v_new_slug
     WHERE id = p_store_id;

    UPDATE public.store_products SET active = false WHERE store_id = p_store_id;

    IF v_admin_id IS NOT NULL THEN
      INSERT INTO public.admin_activity_logs (admin_id, action, target_type, target_id, details)
      VALUES (v_admin_id, 'store_rejected', 'store', p_store_id,
              jsonb_build_object('original_slug', v_store.slug, 'original_name', v_store.name, 'reason', p_reason));
    END IF;

    RETURN json_build_object('success', true, 'status', 'rejected', 'freed_slug', v_store.slug);
  END IF;

  -- Active/suspended → soft delete
  UPDATE public.stores
     SET status = 'deleted',
         deleted_at = now(),
         slug = v_new_slug
   WHERE id = p_store_id;

  UPDATE public.store_products SET active = false WHERE store_id = p_store_id;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.admin_activity_logs (admin_id, action, target_type, target_id, details)
    VALUES (v_admin_id, 'store_deleted', 'store', p_store_id,
            jsonb_build_object('original_slug', v_store.slug, 'original_name', v_store.name, 'reason', p_reason));
  END IF;

  RETURN json_build_object('success', true, 'status', 'deleted', 'freed_slug', v_store.slug);
END $$;

-- 5) create_store: also block creation while a non-terminal store exists (defensive)
CREATE OR REPLACE FUNCTION public.create_store(p_name text, p_slug text, p_description text DEFAULT '')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_existing uuid;
  v_id uuid;
BEGIN
  v_customer_id := public.get_my_customer_id();
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_existing
  FROM public.stores
  WHERE owner_id = v_customer_id AND status NOT IN ('deleted','rejected')
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