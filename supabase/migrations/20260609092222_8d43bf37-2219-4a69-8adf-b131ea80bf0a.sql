
-- ===== List for Store Management table =====
CREATE OR REPLACE FUNCTION public.admin_store_management_list()
RETURNS TABLE (
  store_id uuid,
  name text,
  slug text,
  logo_url text,
  status text,
  created_at timestamptz,
  owner_id uuid,
  owner_name text,
  owner_email text,
  owner_phone text,
  owner_username text,
  total_revenue numeric,
  total_profit numeric,
  total_orders bigint,
  successful_orders bigint,
  pending_orders bigint,
  failed_orders bigint,
  wallet_available numeric,
  wallet_pending numeric,
  wallet_withdrawn numeric,
  last_activity_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    s.slug,
    s.logo_url,
    s.status,
    s.created_at,
    c.id,
    c.full_name,
    c.email,
    c.phone,
    c.username,
    COALESCE(so.total_revenue, 0)::numeric,
    COALESCE(so.total_profit, 0)::numeric,
    COALESCE(so.total_orders, 0)::bigint,
    COALESCE(so.successful, 0)::bigint,
    COALESCE(so.pending, 0)::bigint,
    COALESCE(so.failed, 0)::bigint,
    COALESCE(sw.available_balance, 0)::numeric,
    COALESCE(sw.pending_balance, 0)::numeric,
    COALESCE(sw.withdrawn_balance, 0)::numeric,
    GREATEST(s.updated_at, COALESCE(so.last_order_at, s.created_at))
  FROM stores s
  LEFT JOIN customers c ON c.id = s.owner_id
  LEFT JOIN store_wallets sw ON sw.owner_id = s.owner_id
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN status = 'delivered' THEN amount_paid ELSE 0 END) AS total_revenue,
      SUM(CASE WHEN status = 'delivered' THEN profit ELSE 0 END) AS total_profit,
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE status = 'delivered') AS successful,
      COUNT(*) FILTER (WHERE status IN ('pending','processing')) AS pending,
      COUNT(*) FILTER (WHERE status IN ('failed','refunded','rejected')) AS failed,
      MAX(created_at) AS last_order_at
    FROM store_orders WHERE store_id = s.id
  ) so ON true
  WHERE s.status <> 'deleted'
    AND public.is_admin()
  ORDER BY s.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_store_management_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_store_management_list() TO authenticated;

-- ===== Single-store detail for Store Details page =====
CREATE OR REPLACE FUNCTION public.admin_store_detail(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT jsonb_build_object(
    'store', to_jsonb(s.*),
    'owner', to_jsonb(c.*) - 'transaction_pin_hash' - 'auth_user_id',
    'wallet', to_jsonb(sw.*),
    'metrics', jsonb_build_object(
      'total_revenue', COALESCE(m.total_revenue, 0),
      'total_profit',  COALESCE(m.total_profit, 0),
      'total_orders',  COALESCE(m.total_orders, 0),
      'successful_orders', COALESCE(m.successful, 0),
      'pending_orders',  COALESCE(m.pending, 0),
      'failed_orders',   COALESCE(m.failed, 0),
      'refund_amount',   COALESCE(m.refund_amount, 0),
      'avg_order_value', CASE WHEN COALESCE(m.successful,0) > 0
                              THEN ROUND((m.total_revenue / m.successful)::numeric, 2)
                              ELSE 0 END,
      'total_products', COALESCE(pc.product_count, 0),
      'last_activity_at', GREATEST(s.updated_at, COALESCE(m.last_order_at, s.created_at))
    ),
    'withdrawals', jsonb_build_object(
      'pending_amount', COALESCE(w.pending_amount, 0),
      'pending_count',  COALESCE(w.pending_count, 0),
      'paid_amount',    COALESCE(w.paid_amount, 0),
      'paid_count',     COALESCE(w.paid_count, 0)
    )
  )
  INTO v_result
  FROM stores s
  LEFT JOIN customers c ON c.id = s.owner_id
  LEFT JOIN store_wallets sw ON sw.owner_id = s.owner_id
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN status = 'delivered' THEN amount_paid ELSE 0 END) AS total_revenue,
      SUM(CASE WHEN status = 'delivered' THEN profit ELSE 0 END) AS total_profit,
      SUM(CASE WHEN status IN ('refunded','failed') THEN amount_paid ELSE 0 END) AS refund_amount,
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE status = 'delivered') AS successful,
      COUNT(*) FILTER (WHERE status IN ('pending','processing')) AS pending,
      COUNT(*) FILTER (WHERE status IN ('failed','refunded','rejected')) AS failed,
      MAX(created_at) AS last_order_at
    FROM store_orders WHERE store_id = s.id
  ) m ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS product_count FROM store_products WHERE store_id = s.id
  ) pc ON true
  LEFT JOIN LATERAL (
    SELECT
      SUM(amount) FILTER (WHERE status IN ('pending','processing')) AS pending_amount,
      COUNT(*)    FILTER (WHERE status IN ('pending','processing')) AS pending_count,
      SUM(amount) FILTER (WHERE status = 'paid') AS paid_amount,
      COUNT(*)    FILTER (WHERE status = 'paid') AS paid_count
    FROM store_withdrawals WHERE owner_id = s.owner_id
  ) w ON true
  WHERE s.id = p_store_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_store_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_store_detail(uuid) TO authenticated;
