
-- ============================================================
-- 1. DOMAIN EVENTS (event bus)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  event_key text NOT NULL UNIQUE,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  owner_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

GRANT SELECT ON public.domain_events TO authenticated;
GRANT ALL ON public.domain_events TO service_role;

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read their events" ON public.domain_events;
CREATE POLICY "Owners read their events" ON public.domain_events
  FOR SELECT TO authenticated
  USING (owner_id = public.get_my_customer_id() OR public.is_admin());

CREATE INDEX IF NOT EXISTS idx_domain_events_type_occurred ON public.domain_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON public.domain_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_domain_events_owner ON public.domain_events(owner_id, occurred_at DESC);

-- ============================================================
-- 2. emit_event helper (idempotent on event_key)
-- ============================================================
CREATE OR REPLACE FUNCTION public.emit_event(
  p_event_type text,
  p_event_key text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_owner_id uuid,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.domain_events(event_type, event_key, aggregate_type, aggregate_id, owner_id, payload)
  VALUES (p_event_type, p_event_key, p_aggregate_type, p_aggregate_id, p_owner_id, COALESCE(p_payload,'{}'::jsonb))
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ============================================================
-- 3. CHECKOUT INITIATIONS (funnel step)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.store_checkout_initiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  store_product_id uuid REFERENCES public.store_products(id) ON DELETE SET NULL,
  session_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('data','checker')),
  amount numeric NOT NULL DEFAULT 0,
  traffic_source text DEFAULT 'direct',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_checkout_initiations TO authenticated;
GRANT INSERT ON public.store_checkout_initiations TO anon, authenticated;
GRANT ALL ON public.store_checkout_initiations TO service_role;

ALTER TABLE public.store_checkout_initiations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can record checkout initiation" ON public.store_checkout_initiations;
CREATE POLICY "Anyone can record checkout initiation" ON public.store_checkout_initiations
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Owners read their checkout initiations" ON public.store_checkout_initiations;
CREATE POLICY "Owners read their checkout initiations" ON public.store_checkout_initiations
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = public.get_my_customer_id())
    OR public.is_admin()
  );

CREATE INDEX IF NOT EXISTS idx_checkout_init_store_created ON public.store_checkout_initiations(store_id, created_at DESC);

-- ============================================================
-- 4. traffic_source column on store_visits (idempotent)
-- ============================================================
ALTER TABLE public.store_visits ADD COLUMN IF NOT EXISTS traffic_source text DEFAULT 'direct';
CREATE INDEX IF NOT EXISTS idx_store_visits_store_created ON public.store_visits(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_visits_source ON public.store_visits(store_id, traffic_source);
CREATE INDEX IF NOT EXISTS idx_store_clicks_store_created ON public.store_product_clicks(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_store_created ON public.store_orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_owner_created ON public.store_orders(store_owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_withdrawals_owner_created ON public.store_withdrawals(owner_id, created_at DESC);

-- ============================================================
-- 5. EVENT EMISSION TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_emit_store_order_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_event(
      'store.sale.created',
      'store_sale_created_' || NEW.id::text,
      'store_order', NEW.id, NEW.store_owner_id,
      jsonb_build_object(
        'store_id', NEW.store_id, 'order_id', NEW.order_id,
        'kind', NEW.kind, 'amount_paid', NEW.amount_paid, 'profit', NEW.profit,
        'buyer_phone', NEW.buyer_phone, 'status', NEW.status
      )
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    PERFORM public.emit_event(
      'store.sale.delivered',
      'store_sale_delivered_' || NEW.id::text,
      'store_order', NEW.id, NEW.store_owner_id,
      jsonb_build_object(
        'store_id', NEW.store_id, 'order_id', NEW.order_id,
        'amount_paid', NEW.amount_paid, 'profit', NEW.profit
      )
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_orders_emit_event ON public.store_orders;
CREATE TRIGGER trg_store_orders_emit_event
  AFTER INSERT OR UPDATE ON public.store_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_emit_store_order_event();

CREATE OR REPLACE FUNCTION public.trg_emit_store_withdrawal_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_event(
      'withdrawal.requested',
      'withdrawal_requested_' || NEW.id::text,
      'store_withdrawal', NEW.id, NEW.owner_id,
      jsonb_build_object('amount', NEW.amount, 'momo_number', NEW.momo_number)
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'paid' OR NEW.status = 'completed' THEN
      PERFORM public.emit_event(
        'withdrawal.paid',
        'withdrawal_paid_' || NEW.id::text,
        'store_withdrawal', NEW.id, NEW.owner_id,
        jsonb_build_object('amount', NEW.amount, 'paystack_reference', NEW.paystack_reference)
      );
    ELSIF NEW.status = 'rejected' OR NEW.status = 'failed' THEN
      PERFORM public.emit_event(
        'withdrawal.rejected',
        'withdrawal_rejected_' || NEW.id::text,
        'store_withdrawal', NEW.id, NEW.owner_id,
        jsonb_build_object('amount', NEW.amount, 'reason', NEW.admin_notes)
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_withdrawals_emit_event ON public.store_withdrawals;
CREATE TRIGGER trg_store_withdrawals_emit_event
  AFTER INSERT OR UPDATE ON public.store_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.trg_emit_store_withdrawal_event();

CREATE OR REPLACE FUNCTION public.trg_emit_wallet_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN RETURN NEW; END IF;
  PERFORM public.emit_event(
    'wallet.' || NEW.type,
    'wallet_' || NEW.type || '_' || NEW.id::text,
    'wallet_transaction', NEW.id, NEW.customer_id,
    jsonb_build_object('amount', NEW.amount, 'reference', NEW.reference, 'description', NEW.description)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wallet_tx_emit_event ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_tx_emit_event
  AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_emit_wallet_event();

-- ============================================================
-- 6. RPCs: tracking + analytics + admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.track_store_visit(
  p_store_id uuid, p_path text, p_referrer text, p_session_hash text, p_traffic_source text DEFAULT 'direct'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.store_visits(store_id, path, referrer, session_hash, traffic_source)
  VALUES (p_store_id, COALESCE(p_path,''), COALESCE(p_referrer,''), COALESCE(p_session_hash,''), COALESCE(p_traffic_source,'direct'));
END $$;

CREATE OR REPLACE FUNCTION public.track_checkout_initiation(
  p_store_id uuid, p_store_product_id uuid, p_session_hash text,
  p_kind text, p_amount numeric, p_traffic_source text DEFAULT 'direct'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.store_checkout_initiations(store_id, store_product_id, session_hash, kind, amount, traffic_source)
  VALUES (p_store_id, p_store_product_id, COALESCE(p_session_hash,''), p_kind, COALESCE(p_amount,0), COALESCE(p_traffic_source,'direct'));
END $$;

-- Replace get_store_analytics with funnel + traffic data
CREATE OR REPLACE FUNCTION public.get_store_analytics(
  p_store_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
  v_owner uuid;
  v_summary json; v_top json; v_series json; v_recent json;
  v_traffic json; v_funnel json; v_sources json;
BEGIN
  v_customer_id := public.get_my_customer_id();
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = p_store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_owner <> COALESCE(v_customer_id,'00000000-0000-0000-0000-000000000000'::uuid) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_orders', COUNT(*),
    'successful_orders', COUNT(*) FILTER (WHERE so.status = 'delivered'),
    'total_revenue', COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status = 'delivered'), 0),
    'total_profit', COALESCE(SUM(so.profit) FILTER (WHERE so.status = 'delivered'), 0),
    'unique_customers', COUNT(DISTINCT so.buyer_phone) FILTER (WHERE so.status = 'delivered'),
    'avg_order_value', ROUND(COALESCE(AVG(so.amount_paid) FILTER (WHERE so.status = 'delivered'), 0)::numeric, 2)
  ) INTO v_summary
  FROM public.store_orders so
  WHERE so.store_id = p_store_id AND so.created_at >= p_from AND so.created_at <= p_to;

  SELECT COALESCE(json_agg(t ORDER BY (t->>'orders')::int DESC), '[]'::json) INTO v_top FROM (
    SELECT
      CASE WHEN so.kind='checker' THEN cp.name ELSE pi.network END AS network,
      CASE WHEN so.kind='checker' THEN cp.exam_type ELSE pi.size END AS size,
      COUNT(*) AS orders,
      SUM(so.amount_paid) AS revenue,
      SUM(so.profit) AS profit
    FROM public.store_orders so
    LEFT JOIN public.price_items pi ON pi.id = so.price_item_id
    LEFT JOIN public.checker_products cp ON cp.id = so.checker_product_id
    WHERE so.store_id = p_store_id AND so.status='delivered' AND so.created_at >= p_from AND so.created_at <= p_to
    GROUP BY 1,2
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) t(network, size, orders, revenue, profit), LATERAL (
    SELECT json_build_object('network',network,'size',size,'orders',orders,'revenue',revenue,'profit',profit) AS t
  ) j;

  SELECT COALESCE(json_agg(json_build_object('day', day, 'orders', orders, 'revenue', revenue, 'profit', profit) ORDER BY day), '[]'::json) INTO v_series FROM (
    SELECT date_trunc('day', so.created_at) AS day,
           COUNT(*) FILTER (WHERE so.status='delivered') AS orders,
           COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status='delivered'),0) AS revenue,
           COALESCE(SUM(so.profit) FILTER (WHERE so.status='delivered'),0) AS profit
    FROM public.store_orders so
    WHERE so.store_id = p_store_id AND so.created_at >= p_from AND so.created_at <= p_to
    GROUP BY 1
  ) s;

  SELECT COALESCE(json_agg(json_build_object(
    'id', so.id, 'created_at', so.created_at, 'short_id', o.short_id,
    'network', COALESCE(pi.network, cp.name, ''), 'size', COALESCE(pi.size, cp.exam_type, ''),
    'buyer_phone', so.buyer_phone, 'amount_paid', so.amount_paid, 'profit', so.profit, 'status', so.status
  ) ORDER BY so.created_at DESC), '[]'::json) INTO v_recent FROM (
    SELECT * FROM public.store_orders WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to
    ORDER BY created_at DESC LIMIT 20
  ) so
  LEFT JOIN public.orders o ON o.id = so.order_id
  LEFT JOIN public.price_items pi ON pi.id = so.price_item_id
  LEFT JOIN public.checker_products cp ON cp.id = so.checker_product_id;

  -- Funnel: visits → product clicks → checkout inits → completed orders
  SELECT json_build_object(
    'visits', (SELECT COUNT(*) FROM public.store_visits WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'unique_visitors', (SELECT COUNT(DISTINCT session_hash) FROM public.store_visits WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'product_clicks', (SELECT COUNT(*) FROM public.store_product_clicks WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'checkout_initiations', (SELECT COUNT(*) FROM public.store_checkout_initiations WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'completed_orders', (SELECT COUNT(*) FROM public.store_orders WHERE store_id = p_store_id AND status='delivered' AND created_at >= p_from AND created_at <= p_to)
  ) INTO v_funnel;

  -- Backward-compat traffic block (visits + clicks)
  SELECT json_build_object(
    'visits', v_funnel->'visits',
    'product_clicks', v_funnel->'product_clicks'
  ) INTO v_traffic;

  -- Traffic source breakdown
  SELECT COALESCE(json_agg(json_build_object('source', traffic_source, 'visits', cnt) ORDER BY cnt DESC), '[]'::json)
    INTO v_sources
  FROM (
    SELECT COALESCE(NULLIF(traffic_source,''),'direct') AS traffic_source, COUNT(*) AS cnt
    FROM public.store_visits
    WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to
    GROUP BY 1
  ) s;

  RETURN json_build_object(
    'summary', v_summary, 'top_products', v_top, 'series', v_series, 'recent_orders', v_recent,
    'traffic', v_traffic, 'funnel', v_funnel, 'sources', v_sources
  );
END $$;

-- Admin: global metrics
CREATE OR REPLACE FUNCTION public.admin_global_store_metrics(p_from timestamptz, p_to timestamptz)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out json;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT json_build_object(
    'total_stores', (SELECT COUNT(*) FROM public.stores),
    'active_stores', (SELECT COUNT(*) FROM public.stores WHERE status='active'),
    'total_visits', (SELECT COUNT(*) FROM public.store_visits WHERE created_at BETWEEN p_from AND p_to),
    'total_clicks', (SELECT COUNT(*) FROM public.store_product_clicks WHERE created_at BETWEEN p_from AND p_to),
    'total_checkouts', (SELECT COUNT(*) FROM public.store_checkout_initiations WHERE created_at BETWEEN p_from AND p_to),
    'total_orders', (SELECT COUNT(*) FROM public.store_orders WHERE status='delivered' AND created_at BETWEEN p_from AND p_to),
    'gross_revenue', (SELECT COALESCE(SUM(amount_paid),0) FROM public.store_orders WHERE status='delivered' AND created_at BETWEEN p_from AND p_to),
    'total_owner_profit', (SELECT COALESCE(SUM(profit),0) FROM public.store_orders WHERE status='delivered' AND created_at BETWEEN p_from AND p_to),
    'pending_withdrawals', (SELECT COALESCE(SUM(amount),0) FROM public.store_withdrawals WHERE status='pending')
  ) INTO v_out;
  RETURN v_out;
END $$;

-- Admin: top stores
CREATE OR REPLACE FUNCTION public.admin_top_stores(p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 10)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out json;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT COALESCE(json_agg(t ORDER BY (t->>'revenue')::numeric DESC), '[]'::json) INTO v_out FROM (
    SELECT json_build_object(
      'store_id', s.id, 'name', s.name, 'slug', s.slug, 'status', s.status,
      'owner_name', c.full_name,
      'orders', COUNT(so.id) FILTER (WHERE so.status='delivered'),
      'revenue', COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status='delivered'),0),
      'profit', COALESCE(SUM(so.profit) FILTER (WHERE so.status='delivered'),0)
    ) AS t
    FROM public.stores s
    LEFT JOIN public.customers c ON c.id = s.owner_id
    LEFT JOIN public.store_orders so ON so.store_id = s.id AND so.created_at BETWEEN p_from AND p_to
    GROUP BY s.id, s.name, s.slug, s.status, c.full_name
    ORDER BY COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status='delivered'),0) DESC
    LIMIT p_limit
  ) x;
  RETURN v_out;
END $$;

-- ============================================================
-- 7. Storage RLS for store_logos / store_banners
-- (buckets are created via the storage tool; this only defines policies)
-- Path convention: <owner_uuid>/<filename>
-- ============================================================
DROP POLICY IF EXISTS "Store branding public read" ON storage.objects;
CREATE POLICY "Store branding public read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('store_logos','store_banners'));

DROP POLICY IF EXISTS "Owners upload store branding" ON storage.objects;
CREATE POLICY "Owners upload store branding" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('store_logos','store_banners')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Owners update own store branding" ON storage.objects;
CREATE POLICY "Owners update own store branding" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('store_logos','store_banners')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Owners delete own store branding" ON storage.objects;
CREATE POLICY "Owners delete own store branding" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('store_logos','store_banners')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
