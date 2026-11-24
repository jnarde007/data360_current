
CREATE OR REPLACE FUNCTION public.proceed_order_now(p_customer_id uuid, p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT id, status, customer_id, grace_period_ends_at
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

  UPDATE public.orders
     SET grace_period_ends_at = now()
   WHERE id = p_order_id;

  RETURN json_build_object('success', true);
END;
$$;
