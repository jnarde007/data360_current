
-- =========================================================
-- STORES
-- =========================================================
CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  description text DEFAULT '',
  logo_url text DEFAULT '',
  banner_url text DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stores_owner ON public.stores(owner_id);
CREATE INDEX idx_stores_slug ON public.stores(slug);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT SELECT ON public.stores TO anon;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stores_public_active_read" ON public.stores
  FOR SELECT TO anon, authenticated USING (status = 'active');
CREATE POLICY "stores_owner_all" ON public.stores
  FOR ALL TO authenticated
  USING (owner_id = public.get_my_customer_id())
  WITH CHECK (owner_id = public.get_my_customer_id());
CREATE POLICY "stores_admin_all" ON public.stores
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =========================================================
-- STORE PRODUCTS (catalog: data bundles from price_items)
-- =========================================================
CREATE TABLE public.store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  price_item_id uuid NOT NULL REFERENCES public.price_items(id) ON DELETE CASCADE,
  selling_price numeric(12,2) NOT NULL CHECK (selling_price > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, price_item_id)
);
CREATE INDEX idx_store_products_store ON public.store_products(store_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_products TO authenticated;
GRANT SELECT ON public.store_products TO anon;
GRANT ALL ON public.store_products TO service_role;
ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_products_public_active_read" ON public.store_products
  FOR SELECT TO anon, authenticated USING (
    active AND EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.status='active')
  );
CREATE POLICY "store_products_owner_all" ON public.store_products
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = public.get_my_customer_id())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = public.get_my_customer_id())
  );
CREATE POLICY "store_products_admin_all" ON public.store_products
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =========================================================
-- STORE ORDERS (links a customer order to a store)
-- =========================================================
CREATE TABLE public.store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  store_owner_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  price_item_id uuid NOT NULL REFERENCES public.price_items(id),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  buyer_phone text NOT NULL DEFAULT '',
  amount_paid numeric(12,2) NOT NULL,
  profit numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending | delivered | refunded | failed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_store_orders_store ON public.store_orders(store_id);
CREATE INDEX idx_store_orders_owner ON public.store_orders(store_owner_id);
CREATE INDEX idx_store_orders_order ON public.store_orders(order_id);

GRANT SELECT ON public.store_orders TO authenticated;
GRANT ALL ON public.store_orders TO service_role;
ALTER TABLE public.store_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_orders_owner_read" ON public.store_orders
  FOR SELECT TO authenticated USING (store_owner_id = public.get_my_customer_id());
CREATE POLICY "store_orders_admin_all" ON public.store_orders
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =========================================================
-- STORE WALLETS
-- =========================================================
CREATE TABLE public.store_wallets (
  owner_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  available_balance numeric(12,2) NOT NULL DEFAULT 0,
  pending_balance numeric(12,2) NOT NULL DEFAULT 0,
  withdrawn_balance numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_wallets TO authenticated;
GRANT ALL ON public.store_wallets TO service_role;
ALTER TABLE public.store_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_wallets_owner_read" ON public.store_wallets
  FOR SELECT TO authenticated USING (owner_id = public.get_my_customer_id());
CREATE POLICY "store_wallets_admin_all" ON public.store_wallets
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Guard: only service_role/admin can modify balances directly. RPCs use SECURITY DEFINER which runs as table owner (bypasses RLS but trigger below also blocks non-definer paths).
CREATE OR REPLACE FUNCTION public.guard_store_wallet_updates()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Allow when running as a SECURITY DEFINER function (session_user != current authenticated user role).
  -- Block plain client UPDATEs by authenticated role unless admin.
  IF current_setting('role', true) = 'authenticated' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Direct wallet updates are not allowed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_store_wallet_updates
  BEFORE UPDATE ON public.store_wallets
  FOR EACH ROW EXECUTE FUNCTION public.guard_store_wallet_updates();

-- =========================================================
-- STORE WITHDRAWALS
-- =========================================================
CREATE TABLE public.store_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','failed','rejected')),
  paystack_reference text DEFAULT '',
  momo_number text NOT NULL,
  momo_name text NOT NULL,
  admin_notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_store_withdrawals_owner ON public.store_withdrawals(owner_id);
CREATE INDEX idx_store_withdrawals_status ON public.store_withdrawals(status);

GRANT SELECT ON public.store_withdrawals TO authenticated;
GRANT ALL ON public.store_withdrawals TO service_role;
ALTER TABLE public.store_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_withdrawals_owner_read" ON public.store_withdrawals
  FOR SELECT TO authenticated USING (owner_id = public.get_my_customer_id());
CREATE POLICY "store_withdrawals_admin_all" ON public.store_withdrawals
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =========================================================
-- TRAFFIC TRACKING
-- =========================================================
CREATE TABLE public.store_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  path text NOT NULL DEFAULT '',
  referrer text DEFAULT '',
  session_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_store_visits_store_time ON public.store_visits(store_id, created_at DESC);

GRANT INSERT ON public.store_visits TO anon, authenticated;
GRANT SELECT ON public.store_visits TO authenticated;
GRANT ALL ON public.store_visits TO service_role;
ALTER TABLE public.store_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_visits_public_insert" ON public.store_visits
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "store_visits_owner_read" ON public.store_visits
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = public.get_my_customer_id())
  );
CREATE POLICY "store_visits_admin_all" ON public.store_visits
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.store_product_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  store_product_id uuid NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  session_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_store_product_clicks_time ON public.store_product_clicks(store_id, created_at DESC);

GRANT INSERT ON public.store_product_clicks TO anon, authenticated;
GRANT SELECT ON public.store_product_clicks TO authenticated;
GRANT ALL ON public.store_product_clicks TO service_role;
ALTER TABLE public.store_product_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_product_clicks_public_insert" ON public.store_product_clicks
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "store_product_clicks_owner_read" ON public.store_product_clicks
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = public.get_my_customer_id())
  );
CREATE POLICY "store_product_clicks_admin_all" ON public.store_product_clicks
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =========================================================
-- updated_at triggers
-- =========================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_stores_updated BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_store_products_updated BEFORE UPDATE ON public.store_products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_store_orders_updated BEFORE UPDATE ON public.store_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_store_withdrawals_updated BEFORE UPDATE ON public.store_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- RPCs
-- =========================================================

-- Create a store for the current user
CREATE OR REPLACE FUNCTION public.create_store(p_name text, p_slug text, p_description text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
  v_id uuid;
BEGIN
  v_customer_id := public.get_my_customer_id();
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.stores(owner_id, name, slug, description)
  VALUES (v_customer_id, trim(p_name), lower(trim(p_slug)), COALESCE(p_description,''))
  RETURNING id INTO v_id;

  INSERT INTO public.store_wallets(owner_id) VALUES (v_customer_id)
  ON CONFLICT (owner_id) DO NOTHING;

  RETURN json_build_object('store_id', v_id);
END $$;

-- Upsert a product into a store with selling price (enforces min markup)
CREATE OR REPLACE FUNCTION public.upsert_store_product(
  p_store_id uuid, p_price_item_id uuid, p_selling_price numeric, p_active boolean DEFAULT true
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT price INTO v_base FROM public.price_items WHERE id = p_price_item_id;
  IF v_base IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF p_selling_price < v_base THEN
    RAISE EXCEPTION 'Selling price (GHS %) must be at least the platform base price (GHS %)', p_selling_price, v_base;
  END IF;

  INSERT INTO public.store_products(store_id, price_item_id, selling_price, active)
  VALUES (p_store_id, p_price_item_id, p_selling_price, p_active)
  ON CONFLICT (store_id, price_item_id) DO UPDATE
    SET selling_price = EXCLUDED.selling_price, active = EXCLUDED.active, updated_at = now()
  RETURNING id INTO v_id;

  RETURN json_build_object('store_product_id', v_id);
END $$;

-- Place a store order via Paystack. Wraps place_order_guest_paystack and records store_orders.
CREATE OR REPLACE FUNCTION public.place_store_order_paystack(
  p_store_slug text,
  p_price_item_id uuid,
  p_recipient_phone text,
  p_quantity integer,
  p_payment_reference text,
  p_buyer_phone text,
  p_buyer_email text DEFAULT ''
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_sp RECORD;
  v_item RECORD;
  v_total numeric;
  v_profit numeric;
  v_order_result json;
  v_order_id uuid;
  v_existing_store_order RECORD;
BEGIN
  SELECT id, owner_id, name, status INTO v_store
  FROM public.stores WHERE slug = lower(trim(p_store_slug));
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_store.status <> 'active' THEN RAISE EXCEPTION 'Store is not active'; END IF;

  SELECT sp.selling_price, sp.active INTO v_sp
  FROM public.store_products sp
  WHERE sp.store_id = v_store.id AND sp.price_item_id = p_price_item_id;
  IF v_sp.selling_price IS NULL THEN RAISE EXCEPTION 'Product not available in this store'; END IF;
  IF NOT v_sp.active THEN RAISE EXCEPTION 'Product is inactive'; END IF;

  SELECT network, size, price INTO v_item FROM public.price_items WHERE id = p_price_item_id;
  IF v_item.network IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  v_total := v_sp.selling_price * GREATEST(p_quantity,1);
  v_profit := (v_sp.selling_price - v_item.price) * GREATEST(p_quantity,1);

  -- Idempotency: if a store_order with this payment ref already exists, return it
  SELECT so.id, so.order_id INTO v_existing_store_order
  FROM public.store_orders so
  JOIN public.orders o ON o.id = so.order_id
  WHERE o.payment_reference = p_payment_reference;
  IF v_existing_store_order.id IS NOT NULL THEN
    RETURN json_build_object('store_order_id', v_existing_store_order.id, 'order_id', v_existing_store_order.order_id, 'already_processed', true);
  END IF;

  -- Create the underlying order via existing guest flow (buyer pays via Paystack)
  v_order_result := public.place_order_guest_paystack(
    v_item.network, v_item.size, p_recipient_phone, GREATEST(p_quantity,1),
    v_total, p_payment_reference, p_buyer_phone, COALESCE(p_buyer_email,''),
    '', v_item.price, 'manual', ''
  );
  v_order_id := (v_order_result->>'order_id')::uuid;

  INSERT INTO public.store_orders(store_id, store_owner_id, price_item_id, order_id, buyer_phone, amount_paid, profit, status)
  VALUES (v_store.id, v_store.owner_id, p_price_item_id, v_order_id,
          regexp_replace(p_buyer_phone,'[^0-9]','','g'), v_total, v_profit, 'pending')
  RETURNING id INTO v_existing_store_order.id;

  -- Credit pending balance (insert wallet if not exists)
  INSERT INTO public.store_wallets(owner_id, pending_balance)
  VALUES (v_store.owner_id, v_profit)
  ON CONFLICT (owner_id) DO UPDATE SET pending_balance = public.store_wallets.pending_balance + EXCLUDED.pending_balance, updated_at = now();

  RETURN json_build_object(
    'store_order_id', v_existing_store_order.id,
    'order_id', v_order_id,
    'tracking_token', v_order_result->>'tracking_token',
    'short_id', v_order_result->>'short_id'
  );
END $$;

-- Trigger: when the underlying order is delivered, move profit pending -> available. If cancelled/rejected/refunded, reverse pending.
CREATE OR REPLACE FUNCTION public.sync_store_order_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_so RECORD;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT * INTO v_so FROM public.store_orders WHERE order_id = NEW.id;
  IF v_so.id IS NULL THEN RETURN NEW; END IF;

  IF NEW.status = 'delivered' AND v_so.status = 'pending' THEN
    UPDATE public.store_wallets
      SET pending_balance = GREATEST(pending_balance - v_so.profit, 0),
          available_balance = available_balance + v_so.profit,
          updated_at = now()
      WHERE owner_id = v_so.store_owner_id;
    UPDATE public.store_orders SET status = 'delivered' WHERE id = v_so.id;
  ELSIF NEW.status IN ('rejected','refunded','customer_cancelled','cancelled_before_processing','failed') AND v_so.status = 'pending' THEN
    UPDATE public.store_wallets
      SET pending_balance = GREATEST(pending_balance - v_so.profit, 0), updated_at = now()
      WHERE owner_id = v_so.store_owner_id;
    UPDATE public.store_orders SET status = CASE WHEN NEW.status='failed' THEN 'failed' ELSE 'refunded' END WHERE id = v_so.id;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_sync_store_order_wallet
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_store_order_wallet();

-- Withdrawal request
CREATE OR REPLACE FUNCTION public.request_store_withdrawal(p_amount numeric, p_momo_number text, p_momo_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
  v_available numeric;
  v_id uuid;
BEGIN
  v_customer_id := public.get_my_customer_id();
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount < 20 THEN RAISE EXCEPTION 'Minimum withdrawal is GHS 20'; END IF;
  IF trim(COALESCE(p_momo_number,'')) = '' THEN RAISE EXCEPTION 'MoMo number required'; END IF;
  IF trim(COALESCE(p_momo_name,'')) = '' THEN RAISE EXCEPTION 'MoMo name required'; END IF;

  SELECT available_balance INTO v_available FROM public.store_wallets WHERE owner_id = v_customer_id FOR UPDATE;
  IF COALESCE(v_available,0) < p_amount THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;

  UPDATE public.store_wallets SET available_balance = available_balance - p_amount, updated_at = now()
    WHERE owner_id = v_customer_id;

  INSERT INTO public.store_withdrawals(owner_id, amount, momo_number, momo_name, status)
  VALUES (v_customer_id, p_amount, trim(p_momo_number), trim(p_momo_name), 'pending')
  RETURNING id INTO v_id;

  RETURN json_build_object('withdrawal_id', v_id);
END $$;

-- Admin: mark withdrawal paid
CREATE OR REPLACE FUNCTION public.admin_complete_store_withdrawal(p_id uuid, p_paystack_reference text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_w RECORD;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_w FROM public.store_withdrawals WHERE id = p_id FOR UPDATE;
  IF v_w.id IS NULL THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_w.status NOT IN ('pending','processing') THEN RAISE EXCEPTION 'Already finalized'; END IF;

  UPDATE public.store_withdrawals SET status='paid', paystack_reference=COALESCE(p_paystack_reference,''), updated_at=now() WHERE id=p_id;
  UPDATE public.store_wallets SET withdrawn_balance = withdrawn_balance + v_w.amount, updated_at = now() WHERE owner_id = v_w.owner_id;
  RETURN json_build_object('success', true);
END $$;

-- Admin: reject withdrawal (refund available balance)
CREATE OR REPLACE FUNCTION public.admin_reject_store_withdrawal(p_id uuid, p_reason text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_w RECORD;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_w FROM public.store_withdrawals WHERE id = p_id FOR UPDATE;
  IF v_w.id IS NULL THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_w.status NOT IN ('pending','processing') THEN RAISE EXCEPTION 'Already finalized'; END IF;

  UPDATE public.store_withdrawals SET status='rejected', admin_notes=COALESCE(p_reason,''), updated_at=now() WHERE id=p_id;
  UPDATE public.store_wallets SET available_balance = available_balance + v_w.amount, updated_at = now() WHERE owner_id = v_w.owner_id;
  RETURN json_build_object('success', true);
END $$;

-- Admin: set store status
CREATE OR REPLACE FUNCTION public.admin_set_store_status(p_store_id uuid, p_status text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.stores SET status = p_status, updated_at = now() WHERE id = p_store_id;
  RETURN json_build_object('success', true);
END $$;

-- Public: get store by slug + active products (no cost prices)
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_products json;
BEGIN
  SELECT id, name, slug, description, logo_url, banner_url, status, created_at
    INTO v_store FROM public.stores WHERE slug = lower(trim(p_slug)) AND status = 'active';
  IF v_store.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(json_agg(json_build_object(
    'store_product_id', sp.id,
    'price_item_id', pi.id,
    'network', pi.network,
    'size', pi.size,
    'product', pi.product,
    'selling_price', sp.selling_price
  ) ORDER BY pi.network, pi.size), '[]'::json) INTO v_products
  FROM public.store_products sp
  JOIN public.price_items pi ON pi.id = sp.price_item_id
  WHERE sp.store_id = v_store.id AND sp.active = true;

  RETURN json_build_object(
    'id', v_store.id,
    'name', v_store.name,
    'slug', v_store.slug,
    'description', v_store.description,
    'logo_url', v_store.logo_url,
    'banner_url', v_store.banner_url,
    'created_at', v_store.created_at,
    'products', v_products
  );
END $$;

-- Analytics RPC (owner or admin)
CREATE OR REPLACE FUNCTION public.get_store_analytics(p_store_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
  v_owner uuid;
  v_summary json;
  v_top json;
  v_series json;
  v_recent json;
  v_traffic json;
BEGIN
  v_customer_id := public.get_my_customer_id();
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = p_store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_owner <> COALESCE(v_customer_id,'00000000-0000-0000-0000-000000000000'::uuid) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Summary (revenue/profit only count successful orders)
  SELECT json_build_object(
    'total_orders', COUNT(*),
    'successful_orders', COUNT(*) FILTER (WHERE so.status = 'delivered'),
    'total_revenue', COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status = 'delivered'), 0),
    'total_profit', COALESCE(SUM(so.profit) FILTER (WHERE so.status = 'delivered'), 0),
    'unique_customers', COUNT(DISTINCT so.buyer_phone) FILTER (WHERE so.status = 'delivered'),
    'avg_order_value', COALESCE(AVG(so.amount_paid) FILTER (WHERE so.status = 'delivered'), 0),
    'failed_orders', COUNT(*) FILTER (WHERE so.status IN ('failed','refunded'))
  ) INTO v_summary
  FROM public.store_orders so
  WHERE so.store_id = p_store_id AND so.created_at >= p_from AND so.created_at < p_to;

  -- Top products
  SELECT COALESCE(json_agg(t ORDER BY t.revenue DESC), '[]'::json) INTO v_top FROM (
    SELECT pi.network, pi.size, COUNT(*) AS orders,
           SUM(so.amount_paid) AS revenue, SUM(so.profit) AS profit
    FROM public.store_orders so
    JOIN public.price_items pi ON pi.id = so.price_item_id
    WHERE so.store_id = p_store_id AND so.status = 'delivered'
      AND so.created_at >= p_from AND so.created_at < p_to
    GROUP BY pi.network, pi.size
    ORDER BY revenue DESC LIMIT 10
  ) t;

  -- Daily time series
  SELECT COALESCE(json_agg(d ORDER BY d.day), '[]'::json) INTO v_series FROM (
    SELECT date_trunc('day', so.created_at) AS day,
           COUNT(*) FILTER (WHERE so.status='delivered') AS orders,
           COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status='delivered'),0) AS revenue,
           COALESCE(SUM(so.profit) FILTER (WHERE so.status='delivered'),0) AS profit
    FROM public.store_orders so
    WHERE so.store_id = p_store_id AND so.created_at >= p_from AND so.created_at < p_to
    GROUP BY 1
  ) d;

  -- Recent orders
  SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) INTO v_recent FROM (
    SELECT so.id, so.created_at, so.status, so.amount_paid, so.profit, so.buyer_phone,
           pi.network, pi.size, o.short_id
    FROM public.store_orders so
    JOIN public.price_items pi ON pi.id = so.price_item_id
    LEFT JOIN public.orders o ON o.id = so.order_id
    WHERE so.store_id = p_store_id AND so.created_at >= p_from AND so.created_at < p_to
    ORDER BY so.created_at DESC LIMIT 20
  ) r;

  -- Traffic
  SELECT json_build_object(
    'visits', (SELECT COUNT(*) FROM public.store_visits WHERE store_id = p_store_id AND created_at >= p_from AND created_at < p_to),
    'unique_visitors', (SELECT COUNT(DISTINCT session_hash) FROM public.store_visits WHERE store_id = p_store_id AND created_at >= p_from AND created_at < p_to),
    'product_clicks', (SELECT COUNT(*) FROM public.store_product_clicks WHERE store_id = p_store_id AND created_at >= p_from AND created_at < p_to)
  ) INTO v_traffic;

  RETURN json_build_object(
    'summary', v_summary, 'top_products', v_top, 'series', v_series, 'recent_orders', v_recent, 'traffic', v_traffic
  );
END $$;
