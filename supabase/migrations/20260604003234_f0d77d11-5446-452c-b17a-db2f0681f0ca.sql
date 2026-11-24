
-- 1. Relax status constraint to allow 'deleted'
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_status_check;
ALTER TABLE public.stores ADD CONSTRAINT stores_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'deleted'::text]));

-- 2. Add deleted_at column
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 3. Admin delete store RPC: soft-delete + free slug
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store not found';
  END IF;

  IF v_store.status = 'deleted' THEN
    RETURN json_build_object('success', true, 'already_deleted', true);
  END IF;

  -- Free slug: rename to "del-{8chars}-{oldslug}" trimmed to 40 chars total
  v_suffix := substr(replace(gen_random_uuid()::text,'-',''), 1, 8);
  v_new_slug := left('del-' || v_suffix || '-' || v_store.slug, 40);
  -- Ensure it ends with alnum
  IF right(v_new_slug, 1) = '-' THEN
    v_new_slug := left(v_new_slug, length(v_new_slug)-1) || '0';
  END IF;

  UPDATE public.stores
     SET status = 'deleted',
         deleted_at = now(),
         slug = v_new_slug
   WHERE id = p_store_id;

  -- Deactivate store products so they don't surface anywhere
  UPDATE public.store_products SET active = false WHERE store_id = p_store_id;

  -- Audit log
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.admin_activity_logs (admin_id, action, target_type, target_id, details)
    VALUES (v_admin_id, 'store_deleted', 'store', p_store_id,
            jsonb_build_object('original_slug', v_store.slug, 'original_name', v_store.name, 'reason', p_reason));
  END IF;

  RETURN json_build_object('success', true, 'freed_slug', v_store.slug);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_delete_store(uuid, text) TO authenticated;
