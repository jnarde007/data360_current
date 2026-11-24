CREATE OR REPLACE FUNCTION public.developer_api_usage_summary(p_customer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (
    SELECT dap.created_at, COALESCE(dap.amount_charged, o.total_amount) AS amt, o.status
    FROM developer_api_purchases dap JOIN orders o ON o.id = dap.order_id
    WHERE dap.customer_id = p_customer_id
  ), b AS (
    SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AS cm
  )
  SELECT jsonb_build_object(
    'total_purchases', count(*),
    'delivered', count(*) FILTER (WHERE status = 'delivered'),
    'failed_or_rejected', count(*) FILTER (WHERE status IN ('failed','rejected','customer_cancelled')),
    'pending_or_processing', count(*) FILTER (WHERE status IN ('pending_confirmation','pending','submitting','processing')),
    'total_amount_charged', COALESCE(round(sum(amt), 2), 0),
    'current_month', jsonb_build_object('month', to_char(b.cm, 'YYYY-MM'),
      'purchases', count(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC') >= b.cm),
      'amount_charged', COALESCE(round(sum(amt) FILTER (WHERE (created_at AT TIME ZONE 'UTC') >= b.cm), 2), 0)),
    'previous_month', jsonb_build_object('month', to_char(b.cm - interval '1 month', 'YYYY-MM'),
      'purchases', count(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC') >= b.cm - interval '1 month' AND (created_at AT TIME ZONE 'UTC') < b.cm),
      'amount_charged', COALESCE(round(sum(amt) FILTER (WHERE (created_at AT TIME ZONE 'UTC') >= b.cm - interval '1 month' AND (created_at AT TIME ZONE 'UTC') < b.cm), 2), 0))
  ) FROM p RIGHT JOIN b ON true GROUP BY b.cm;
$$;

CREATE OR REPLACE FUNCTION public.developer_api_usage_history(p_customer_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (SELECT d::date AS day FROM generate_series(p_from, p_to, interval '1 day') d),
  p AS (
    SELECT (dap.created_at AT TIME ZONE 'UTC')::date AS day, COALESCE(dap.amount_charged, o.total_amount) AS amt, o.status
    FROM developer_api_purchases dap JOIN orders o ON o.id = dap.order_id
    WHERE dap.customer_id = p_customer_id
      AND dap.created_at >= (p_from::timestamp AT TIME ZONE 'UTC')
      AND dap.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(days.day, 'YYYY-MM-DD'),
    'purchases', (SELECT count(*) FROM p WHERE p.day = days.day),
    'amount_charged', (SELECT COALESCE(round(sum(amt), 2), 0) FROM p WHERE p.day = days.day),
    'delivered', (SELECT count(*) FROM p WHERE p.day = days.day AND status = 'delivered'),
    'failed_or_rejected', (SELECT count(*) FROM p WHERE p.day = days.day AND status IN ('failed','rejected','customer_cancelled'))
  ) ORDER BY days.day), '[]'::jsonb) FROM days;
$$;

REVOKE ALL ON FUNCTION public.developer_api_usage_summary(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.developer_api_usage_history(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.developer_api_usage_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.developer_api_usage_history(uuid, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_developer_api_usage(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid uuid;
BEGIN
  SELECT id INTO v_cid FROM customers WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  IF v_cid IS NULL OR NOT public._super_agent_active(v_cid) THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;
  RETURN jsonb_build_object('available', true,
    'summary', public.developer_api_usage_summary(v_cid),
    'history', public.developer_api_usage_history(v_cid, p_from, p_to));
END $$;
REVOKE ALL ON FUNCTION public.get_my_developer_api_usage(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_developer_api_usage(date, date) TO authenticated;