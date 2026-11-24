CREATE OR REPLACE FUNCTION public.admin_global_store_metrics(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_out json;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT json_build_object(
    'total_stores', (SELECT COUNT(*) FROM public.stores WHERE status <> 'deleted'),
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
END
$function$;