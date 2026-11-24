CREATE OR REPLACE FUNCTION public.developer_api_usage_summary(p_customer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (
    SELECT dap.created_at, COALESCE(dap.amount_charged, o.total_amount) AS amt, o.status
    FROM developer_api_purchases dap JOIN orders o ON o.id = dap.order_id
    WHERE dap.customer_id = p_customer_id
  ), b AS (SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AS cm),
  x AS (SELECT p.*, (p.created_at AT TIME ZONE 'UTC') AS t, b.cm FROM p CROSS JOIN b)
  SELECT jsonb_build_object(
    'total_purchases', (SELECT count(*) FROM x),
    'delivered', (SELECT count(*) FROM x WHERE status = 'delivered'),
    'failed_or_rejected', (SELECT count(*) FROM x WHERE status IN ('failed','rejected','customer_cancelled')),
    'pending_or_processing', (SELECT count(*) FROM x WHERE status IN ('pending_confirmation','pending','submitting','processing')),
    'total_amount_charged', (SELECT COALESCE(round(sum(amt), 2), 0) FROM x),
    'current_month', jsonb_build_object('month', to_char(b.cm, 'YYYY-MM'),
      'purchases', (SELECT count(*) FROM x WHERE t >= x.cm),
      'amount_charged', (SELECT COALESCE(round(sum(amt), 2), 0) FROM x WHERE t >= x.cm)),
    'previous_month', jsonb_build_object('month', to_char(b.cm - interval '1 month', 'YYYY-MM'),
      'purchases', (SELECT count(*) FROM x WHERE t >= x.cm - interval '1 month' AND t < x.cm),
      'amount_charged', (SELECT COALESCE(round(sum(amt), 2), 0) FROM x WHERE t >= x.cm - interval '1 month' AND t < x.cm))
  ) FROM b;
$$;
REVOKE ALL ON FUNCTION public.developer_api_usage_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.developer_api_usage_summary(uuid) TO service_role;