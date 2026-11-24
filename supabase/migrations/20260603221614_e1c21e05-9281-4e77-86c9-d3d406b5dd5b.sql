
-- ============================================================
-- 1) Extend store_products and store_orders to support checkers
-- ============================================================

ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'data',
  ADD COLUMN IF NOT EXISTS checker_product_id uuid REFERENCES public.checker_products(id) ON DELETE CASCADE;

ALTER TABLE public.store_products
  ALTER COLUMN price_item_id DROP NOT NULL;

-- Exactly one product link, matching kind
ALTER TABLE public.store_products
  DROP CONSTRAINT IF EXISTS store_products_kind_check,
  ADD CONSTRAINT store_products_kind_check CHECK (
    (kind = 'data' AND price_item_id IS NOT NULL AND checker_product_id IS NULL) OR
    (kind = 'checker' AND checker_product_id IS NOT NULL AND price_item_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_store_products_checker
  ON public.store_products(store_id, checker_product_id)
  WHERE checker_product_id IS NOT NULL;

ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'data',
  ADD COLUMN IF NOT EXISTS checker_product_id uuid REFERENCES public.checker_products(id),
  ADD COLUMN IF NOT EXISTS checker_purchase_id uuid REFERENCES public.checker_purchases(id);

ALTER TABLE public.store_orders
  ALTER COLUMN price_item_id DROP NOT NULL;

ALTER TABLE public.store_orders
  DROP CONSTRAINT IF EXISTS store_orders_kind_check,
  ADD CONSTRAINT store_orders_kind_check CHECK (
    (kind = 'data' AND price_item_id IS NOT NULL) OR
    (kind = 'checker' AND checker_product_id IS NOT NULL)
  );

-- ============================================================
-- 2) RLS hardening: revoke direct writes from authenticated
-- ============================================================
REVOKE INSERT, UPDATE, DELETE ON public.store_orders   FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.store_wallets  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.store_withdrawals FROM authenticated;

-- ============================================================
-- 3) Validation trigger on store_orders
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_store_order()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_terminal text[] := ARRAY['delivered','refunded','failed'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.amount_paid IS NULL OR NEW.amount_paid <= 0 THEN
      RAISE EXCEPTION 'store_orders.amount_paid must be positive';
    END IF;
    IF NEW.profit IS NULL OR NEW.profit < 0 THEN
      RAISE EXCEPTION 'store_orders.profit must be >= 0 (got %)', NEW.profit;
    END IF;
    IF NEW.profit > NEW.amount_paid THEN
      RAISE EXCEPTION 'store_orders.profit (%) cannot exceed amount_paid (%)', NEW.profit, NEW.amount_paid;
    END IF;
    IF NEW.status NOT IN ('pending','delivered','refunded','failed') THEN
      RAISE EXCEPTION 'Invalid store_orders.status: %', NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status = ANY(v_terminal) AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'store_orders status "%" is terminal and cannot change', OLD.status;
  END IF;
  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    RAISE EXCEPTION 'store_orders.amount_paid is immutable';
  END IF;
  IF NEW.profit IS DISTINCT FROM OLD.profit THEN
    RAISE EXCEPTION 'store_orders.profit is immutable';
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.store_owner_id IS DISTINCT FROM OLD.store_owner_id THEN
    RAISE EXCEPTION 'store_orders ownership is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_store_order ON public.store_orders;
CREATE TRIGGER trg_validate_store_order
  BEFORE INSERT OR UPDATE ON public.store_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_store_order();

-- ============================================================
-- 4) Updated upsert_store_product (supports both kinds)
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_store_product(
  p_store_id uuid,
  p_kind text,
  p_product_id uuid,
  p_selling_price numeric,
  p_active boolean DEFAULT true
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
  v_base numeric;
  v_id uuid;
BEGIN
  v_customer_id := public.get_my_customer_id();
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id AND owner_id = v_customer_id) THEN
    RAISE EXCEPTION 'Store not found or not owned by you';
  END IF;

  IF p_kind = 'data' THEN
    SELECT price INTO v_base FROM public.price_items WHERE id = p_product_id;
    IF v_base IS NULL THEN RAISE EXCEPTION 'Data bundle not found'; END IF;
    IF p_selling_price < v_base THEN
      RAISE EXCEPTION 'Selling price (GHS %) must be at least the platform base price (GHS %)', p_selling_price, v_base;
    END IF;
    INSERT INTO public.store_products(store_id, kind, price_item_id, selling_price, active)
    VALUES (p_store_id, 'data', p_product_id, p_selling_price, p_active)
    ON CONFLICT (store_id, price_item_id) DO UPDATE
      SET selling_price = EXCLUDED.selling_price, active = EXCLUDED.active, updated_at = now()
    RETURNING id INTO v_id;
  ELSIF p_kind = 'checker' THEN
    SELECT price INTO v_base FROM public.checker_products WHERE id = p_product_id AND status='active';
    IF v_base IS NULL THEN RAISE EXCEPTION 'Checker product not found or inactive'; END IF;
    IF p_selling_price < v_base THEN
      RAISE EXCEPTION 'Selling price (GHS %) must be at least the platform base price (GHS %)', p_selling_price, v_base;
    END IF;
    INSERT INTO public.store_products(store_id, kind, checker_product_id, selling_price, active)
    VALUES (p_store_id, 'checker', p_product_id, p_selling_price, p_active)
    ON CONFLICT (store_id, checker_product_id) DO UPDATE
      SET selling_price = EXCLUDED.selling_price, active = EXCLUDED.active, updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    RAISE EXCEPTION 'Invalid kind: %', p_kind;
  END IF;

  RETURN json_build_object('store_product_id', v_id);
END $$;

-- Keep backward-compatible signature for old frontend calls (data bundle)
CREATE OR REPLACE FUNCTION public.upsert_store_product(
  p_store_id uuid,
  p_price_item_id uuid,
  p_selling_price numeric,
  p_active boolean DEFAULT true
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.upsert_store_product(p_store_id, 'data', p_price_item_id, p_selling_price, p_active);
END $$;

-- ============================================================
-- 5) New RPC: place_store_checker_paystack
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_store_checker_paystack(
  p_store_slug text,
  p_checker_product_id uuid,
  p_quantity integer,
  p_payment_reference text,
  p_buyer_phone text,
  p_buyer_email text DEFAULT '',
  p_sms_phone text DEFAULT ''
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_sp RECORD;
  v_cp RECORD;
  v_qty integer;
  v_total numeric;
  v_profit numeric;
  v_purchase json;
  v_purchase_id uuid;
  v_store_order_id uuid;
  v_existing RECORD;
BEGIN
  v_qty := GREATEST(COALESCE(p_quantity,1), 1);

  SELECT id, owner_id, status INTO v_store
  FROM public.stores WHERE slug = lower(trim(p_store_slug));
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_store.status <> 'active' THEN RAISE EXCEPTION 'Store is not active'; END IF;

  SELECT sp.id, sp.selling_price, sp.active INTO v_sp
  FROM public.store_products sp
  WHERE sp.store_id = v_store.id AND sp.checker_product_id = p_checker_product_id AND sp.kind='checker';
  IF v_sp.id IS NULL THEN RAISE EXCEPTION 'Product not available in this store'; END IF;
  IF NOT v_sp.active THEN RAISE EXCEPTION 'Product is inactive'; END IF;

  SELECT id, name, price, status INTO v_cp FROM public.checker_products WHERE id = p_checker_product_id;
  IF v_cp.id IS NULL OR v_cp.status <> 'active' THEN RAISE EXCEPTION 'Checker product not available'; END IF;

  v_total := v_sp.selling_price * v_qty;
  v_profit := (v_sp.selling_price - v_cp.price) * v_qty;
  IF v_profit < 0 THEN RAISE EXCEPTION 'Invalid pricing configuration'; END IF;

  -- Idempotency
  SELECT so.id, so.checker_purchase_id INTO v_existing
  FROM public.store_orders so
  WHERE so.kind='checker'
    AND so.checker_purchase_id IN (SELECT id FROM public.checker_purchases WHERE payment_reference = p_payment_reference);
  IF v_existing.id IS NOT NULL THEN
    RETURN json_build_object('store_order_id', v_existing.id, 'checker_purchase_id', v_existing.checker_purchase_id, 'already_processed', true);
  END IF;

  -- Use the store owner as customer for the purchase record (or could be NULL guest; checker fn requires customer)
  v_purchase := public.purchase_checker_paystack(
    v_store.owner_id, p_checker_product_id, p_payment_reference, p_sms_phone, v_qty
  );
  IF (v_purchase->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Checker purchase failed: %', v_purchase->>'error';
  END IF;
  v_purchase_id := (v_purchase->>'purchase_id')::uuid;

  INSERT INTO public.store_orders(store_id, store_owner_id, kind, checker_product_id, checker_purchase_id,
                                  buyer_phone, amount_paid, profit, status)
  VALUES (v_store.id, v_store.owner_id, 'checker', p_checker_product_id, v_purchase_id,
          regexp_replace(COALESCE(p_buyer_phone,''),'[^0-9]','','g'), v_total, v_profit, 'delivered')
  RETURNING id INTO v_store_order_id;

  -- Checkers deliver instantly: credit available_balance directly
  INSERT INTO public.store_wallets(owner_id, available_balance)
  VALUES (v_store.owner_id, v_profit)
  ON CONFLICT (owner_id) DO UPDATE
    SET available_balance = public.store_wallets.available_balance + EXCLUDED.available_balance,
        updated_at = now();

  RETURN json_build_object(
    'store_order_id', v_store_order_id,
    'checker_purchase_id', v_purchase_id,
    'short_id', v_purchase->>'short_id',
    'codes', v_purchase->'codes'
  );
END $$;

-- ============================================================
-- 6) Update get_public_store to include checkers
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_products json;
BEGIN
  SELECT id, name, slug, description, logo_url, banner_url, status, created_at
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
    'products', v_products
  );
END $$;
