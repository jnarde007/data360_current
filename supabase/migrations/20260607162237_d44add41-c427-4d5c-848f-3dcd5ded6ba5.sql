
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS contact_whatsapp text DEFAULT ''::text,
  ADD COLUMN IF NOT EXISTS contact_group_link text DEFAULT ''::text,
  ADD COLUMN IF NOT EXISTS contact_email text DEFAULT ''::text,
  ADD COLUMN IF NOT EXISTS afa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS afa_price numeric(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_store RECORD;
  v_products json;
BEGIN
  SELECT id, name, slug, description, logo_url, banner_url, status, created_at,
         contact_whatsapp, contact_group_link, contact_email, afa_enabled, afa_price
    INTO v_store FROM public.stores WHERE slug = lower(trim(p_slug)) AND status = 'active';
  IF v_store.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(json_agg(p ORDER BY p->>'sort_key'), '[]'::json) INTO v_products FROM (
    SELECT json_build_object(
      'store_product_id', sp.id,
      'kind', 'data',
      'price_item_id', pi.id,
      'network', pi.network,
      'size', pi.size,
      'product', pi.product,
      'selling_price', sp.selling_price,
      'sort_key', '1-' || pi.network || '-' || lpad(sp.selling_price::text, 10, '0')
    ) AS p
    FROM public.store_products sp
    JOIN public.price_items pi ON pi.id = sp.price_item_id
    WHERE sp.store_id = v_store.id AND sp.active AND sp.kind='data'
    UNION ALL
    SELECT json_build_object(
      'store_product_id', sp.id,
      'kind', 'checker',
      'checker_product_id', cp.id,
      'name', cp.name,
      'exam_type', cp.exam_type,
      'selling_price', sp.selling_price,
      'sort_key', '2-' || cp.name
    )
    FROM public.store_products sp
    JOIN public.checker_products cp ON cp.id = sp.checker_product_id
    WHERE sp.store_id = v_store.id AND sp.active AND sp.kind='checker' AND cp.status='active'
  ) t;

  RETURN json_build_object(
    'id', v_store.id, 'name', v_store.name, 'slug', v_store.slug,
    'description', v_store.description, 'logo_url', v_store.logo_url,
    'banner_url', v_store.banner_url, 'created_at', v_store.created_at,
    'contact_whatsapp', COALESCE(v_store.contact_whatsapp, ''),
    'contact_group_link', COALESCE(v_store.contact_group_link, ''),
    'contact_email', COALESCE(v_store.contact_email, ''),
    'afa_enabled', v_store.afa_enabled,
    'afa_price', v_store.afa_price,
    'products', v_products
  );
END $function$;
