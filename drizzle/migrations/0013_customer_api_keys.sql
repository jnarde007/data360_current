CREATE TABLE public.customer_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX idx_customer_api_keys_customer ON public.customer_api_keys(customer_id);

GRANT SELECT ON public.customer_api_keys TO authenticated;
GRANT ALL ON public.customer_api_keys TO service_role;

ALTER TABLE public.customer_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own api keys" ON public.customer_api_keys
FOR SELECT TO authenticated
USING (customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid()));

CREATE POLICY "Admins view all api keys" ON public.customer_api_keys
FOR SELECT TO authenticated
USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.generate_customer_api_key(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_customer uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_secret text;
  v_full text;
  v_row public.customer_api_keys%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_customer FROM public.customers
   WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND status = 'active' LIMIT 1;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Active customer account required'; END IF;
  IF length(v_name) < 1 OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'Key name must be 1-100 characters';
  END IF;
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  v_full := 'd360_live_' || v_secret;
  INSERT INTO public.customer_api_keys(customer_id, name, key_hash, key_prefix)
  VALUES (v_customer, v_name,
          encode(extensions.digest(v_full, 'sha256'), 'hex'),
          'd360_live_' || substr(v_secret, 1, 8) || '...')
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'name', v_row.name, 'key_prefix', v_row.key_prefix,
                            'created_at', v_row.created_at, 'full_key', v_full);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_customer_api_key(p_key_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.customer_api_keys k
     SET is_active = false, revoked_at = now()
   WHERE k.id = p_key_id AND k.is_active = true
     AND (k.customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
          OR public.is_admin());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RAISE EXCEPTION 'Key not found or already revoked'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_customer_api_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_customer_api_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_customer_api_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_customer_api_key(uuid) TO authenticated;