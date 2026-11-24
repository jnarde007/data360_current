-- 1. Schema additions
ALTER TABLE public.store_visits
  ADD COLUMN IF NOT EXISTS session_duration_seconds integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_returning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS landed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.store_product_clicks
  ADD COLUMN IF NOT EXISTS traffic_source text DEFAULT 'direct';

CREATE INDEX IF NOT EXISTS idx_store_visits_store_session ON public.store_visits(store_id, session_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_product_clicks_store_session ON public.store_product_clicks(store_id, session_hash, created_at DESC);

-- 2. track_store_visit_v2
CREATE OR REPLACE FUNCTION public.track_store_visit_v2(
  p_store_id uuid,
  p_path text,
  p_referrer text,
  p_session_hash text,
  p_traffic_source text DEFAULT 'direct',
  p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_returning boolean := false;
  v_id uuid;
BEGIN
  IF COALESCE(p_session_hash,'') <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.store_visits
      WHERE store_id = p_store_id
        AND session_hash = p_session_hash
        AND created_at < now() - interval '30 minutes'
        AND created_at > now() - interval '30 days'
    ) INTO v_returning;
  END IF;

  INSERT INTO public.store_visits(store_id, path, referrer, session_hash, traffic_source, user_agent, is_returning, landed_at)
  VALUES (
    p_store_id, COALESCE(p_path,''), COALESCE(p_referrer,''),
    COALESCE(p_session_hash,''), COALESCE(NULLIF(p_traffic_source,''),'direct'),
    LEFT(COALESCE(p_user_agent,''), 500), v_returning, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.track_store_visit_v2(uuid,text,text,text,text,text) TO anon, authenticated;

-- 3. update_visit_duration
CREATE OR REPLACE FUNCTION public.update_visit_duration(
  p_visit_id uuid,
  p_seconds integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_visit_id IS NULL OR p_seconds IS NULL OR p_seconds < 0 OR p_seconds > 86400 THEN
    RETURN;
  END IF;
  UPDATE public.store_visits
     SET session_duration_seconds = GREATEST(COALESCE(session_duration_seconds,0), p_seconds)
   WHERE id = p_visit_id;
END $$;

GRANT EXECUTE ON FUNCTION public.update_visit_duration(uuid,integer) TO anon, authenticated;

-- 4. track_product_click_v2
CREATE OR REPLACE FUNCTION public.track_product_click_v2(
  p_store_id uuid,
  p_store_product_id uuid,
  p_session_hash text,
  p_traffic_source text DEFAULT 'direct'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.store_product_clicks(store_id, store_product_id, session_hash, traffic_source)
  VALUES (p_store_id, p_store_product_id, COALESCE(p_session_hash,''), COALESCE(NULLIF(p_traffic_source,''),'direct'));
END $$;

GRANT EXECUTE ON FUNCTION public.track_product_click_v2(uuid,uuid,text,text) TO anon, authenticated;

-- 5. Extended get_store_analytics
CREATE OR REPLACE FUNCTION public.get_store_analytics(p_store_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_owner uuid;
  v_summary json; v_top json; v_series json; v_recent json;
  v_traffic json; v_funnel json; v_sources json; v_traffic_trend json; v_most_viewed json;
  v_visitors_today bigint; v_visitors_week bigint; v_visitors_month bigint;
  v_unique_total bigint; v_returning bigint; v_avg_session numeric;
  v_period_visits bigint; v_period_completed bigint; v_conversion numeric;
BEGIN
  v_customer_id := public.get_my_customer_id();
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = p_store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_owner <> COALESCE(v_customer_id,'00000000-0000-0000-0000-000000000000'::uuid) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Visitor windows (independent of period filter)
  SELECT COUNT(*) INTO v_visitors_today
    FROM public.store_visits WHERE store_id = p_store_id AND created_at >= date_trunc('day', now());
  SELECT COUNT(*) INTO v_visitors_week
    FROM public.store_visits WHERE store_id = p_store_id AND created_at >= now() - interval '7 days';
  SELECT COUNT(*) INTO v_visitors_month
    FROM public.store_visits WHERE store_id = p_store_id AND created_at >= now() - interval '30 days';
  SELECT COUNT(DISTINCT session_hash) INTO v_unique_total
    FROM public.store_visits WHERE store_id = p_store_id;
  SELECT COUNT(*) INTO v_returning
    FROM public.store_visits WHERE store_id = p_store_id AND is_returning = true AND created_at >= p_from AND created_at <= p_to;
  SELECT COALESCE(AVG(NULLIF(session_duration_seconds,0)),0) INTO v_avg_session
    FROM public.store_visits WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to;

  SELECT COUNT(*) INTO v_period_visits FROM public.store_visits
    WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to;
  SELECT COUNT(*) INTO v_period_completed FROM public.store_orders
    WHERE store_id = p_store_id AND status='delivered' AND created_at >= p_from AND created_at <= p_to;
  v_conversion := CASE WHEN v_period_visits > 0 THEN ROUND((v_period_completed::numeric / v_period_visits::numeric) * 100, 2) ELSE 0 END;

  SELECT json_build_object(
    'total_orders', COUNT(*),
    'successful_orders', COUNT(*) FILTER (WHERE so.status = 'delivered'),
    'total_revenue', COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status = 'delivered'), 0),
    'total_profit', COALESCE(SUM(so.profit) FILTER (WHERE so.status = 'delivered'), 0),
    'unique_customers', COUNT(DISTINCT so.buyer_phone) FILTER (WHERE so.status = 'delivered'),
    'avg_order_value', ROUND(COALESCE(AVG(so.amount_paid) FILTER (WHERE so.status = 'delivered'), 0)::numeric, 2),
    'visitors_today', v_visitors_today,
    'visitors_week', v_visitors_week,
    'visitors_month', v_visitors_month,
    'unique_visitors_total', v_unique_total,
    'returning_visitors', v_returning,
    'avg_session_seconds', ROUND(v_avg_session, 1),
    'conversion_rate', v_conversion
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

  -- Most viewed products (by clicks in period)
  SELECT COALESCE(json_agg(j ORDER BY (j->>'clicks')::int DESC), '[]'::json) INTO v_most_viewed FROM (
    SELECT json_build_object(
      'product_id', sp.id,
      'network', COALESCE(pi.network, cp.name, ''),
      'size', COALESCE(pi.size, cp.exam_type, ''),
      'clicks', cnt,
      'orders', COALESCE((
        SELECT COUNT(*) FROM public.store_orders so2
        WHERE so2.store_id = p_store_id AND so2.status='delivered'
          AND so2.created_at >= p_from AND so2.created_at <= p_to
          AND ((sp.kind='data' AND so2.price_item_id = sp.price_item_id)
               OR (sp.kind='checker' AND so2.checker_product_id = sp.checker_product_id))
      ),0),
      'conversion_pct', CASE WHEN cnt > 0 THEN ROUND((COALESCE((
        SELECT COUNT(*) FROM public.store_orders so2
        WHERE so2.store_id = p_store_id AND so2.status='delivered'
          AND so2.created_at >= p_from AND so2.created_at <= p_to
          AND ((sp.kind='data' AND so2.price_item_id = sp.price_item_id)
               OR (sp.kind='checker' AND so2.checker_product_id = sp.checker_product_id))
      ),0)::numeric / cnt::numeric) * 100, 1) ELSE 0 END
    ) AS j
    FROM (
      SELECT store_product_id, COUNT(*) AS cnt
      FROM public.store_product_clicks
      WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    ) c
    JOIN public.store_products sp ON sp.id = c.store_product_id
    LEFT JOIN public.price_items pi ON pi.id = sp.price_item_id
    LEFT JOIN public.checker_products cp ON cp.id = sp.checker_product_id
  ) mv;

  SELECT COALESCE(json_agg(json_build_object('day', day, 'orders', orders, 'revenue', revenue, 'profit', profit) ORDER BY day), '[]'::json) INTO v_series FROM (
    SELECT date_trunc('day', so.created_at) AS day,
           COUNT(*) FILTER (WHERE so.status='delivered') AS orders,
           COALESCE(SUM(so.amount_paid) FILTER (WHERE so.status='delivered'),0) AS revenue,
           COALESCE(SUM(so.profit) FILTER (WHERE so.status='delivered'),0) AS profit
    FROM public.store_orders so
    WHERE so.store_id = p_store_id AND so.created_at >= p_from AND so.created_at <= p_to
    GROUP BY 1
  ) s;

  -- Traffic trend per day
  SELECT COALESCE(json_agg(json_build_object('day', day, 'visits', visits, 'unique_visitors', uniq, 'clicks', clicks) ORDER BY day), '[]'::json) INTO v_traffic_trend FROM (
    SELECT d::date AS day,
      (SELECT COUNT(*) FROM public.store_visits sv WHERE sv.store_id = p_store_id AND date_trunc('day', sv.created_at) = d) AS visits,
      (SELECT COUNT(DISTINCT session_hash) FROM public.store_visits sv WHERE sv.store_id = p_store_id AND date_trunc('day', sv.created_at) = d) AS uniq,
      (SELECT COUNT(*) FROM public.store_product_clicks pc WHERE pc.store_id = p_store_id AND date_trunc('day', pc.created_at) = d) AS clicks
    FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') d
  ) tt;

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

  SELECT json_build_object(
    'visits', (SELECT COUNT(*) FROM public.store_visits WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'unique_visitors', (SELECT COUNT(DISTINCT session_hash) FROM public.store_visits WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'product_clicks', (SELECT COUNT(*) FROM public.store_product_clicks WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'checkout_initiations', (SELECT COUNT(*) FROM public.store_checkout_initiations WHERE store_id = p_store_id AND created_at >= p_from AND created_at <= p_to),
    'completed_orders', (SELECT COUNT(*) FROM public.store_orders WHERE store_id = p_store_id AND status='delivered' AND created_at >= p_from AND created_at <= p_to)
  ) INTO v_funnel;

  SELECT json_build_object(
    'visits', v_funnel->'visits',
    'product_clicks', v_funnel->'product_clicks'
  ) INTO v_traffic;

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
    'traffic', v_traffic, 'funnel', v_funnel, 'sources', v_sources,
    'traffic_trend', v_traffic_trend, 'most_viewed', v_most_viewed
  );
END $$;