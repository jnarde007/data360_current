CREATE OR REPLACE FUNCTION public.proceed_order_now(p_customer_id uuid, p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT id, status, customer_id, grace_period_ends_at, network, detected_network
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     AND customer_id = p_customer_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Order not found');
  END IF;

  IF v_order.status <> 'pending_confirmation' THEN
    RETURN json_build_object('error', 'Order is no longer in the cancellation window');
  END IF;

  IF v_order.detected_network IS NOT NULL AND v_order.detected_network <> v_order.network THEN
    RETURN json_build_object('error', 'Cross-network orders must complete the full 3-minute waiting period. This gives you time to cancel if the details are wrong.');
  END IF;

  UPDATE public.orders
     SET grace_period_ends_at = now()
   WHERE id = p_order_id;

  RETURN json_build_object('success', true);
END;
$$;