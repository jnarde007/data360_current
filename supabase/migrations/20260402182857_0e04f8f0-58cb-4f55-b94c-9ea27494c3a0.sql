
DROP FUNCTION IF EXISTS public.cancel_my_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.cancel_my_order(p_order_id uuid, p_customer_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_customer_id uuid;
  v_new_balance numeric;
  v_refund_ref text;
BEGIN
  v_customer_id := public.get_my_customer_id();
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer account not found';
  END IF;
  IF p_customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Unauthorized cancellation attempt';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status = 'customer_cancelled' THEN
    RETURN json_build_object('success', true, 'message', 'Order already cancelled');
  END IF;

  IF v_order.status <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'This order can no longer be cancelled. It has already been submitted for processing.';
  END IF;

  IF v_order.grace_period_ends_at IS NULL OR now() > v_order.grace_period_ends_at THEN
    RAISE EXCEPTION 'The cancellation window has expired. Your order is being processed.';
  END IF;

  UPDATE public.orders SET status = 'customer_cancelled' WHERE id = v_order.id;

  IF v_order.payment_method = 'paystack_direct' THEN
    -- Paystack direct: no wallet involved, no wallet transactions needed
    RETURN json_build_object('success', true, 'message', 'Order cancelled. No wallet was charged for this Paystack payment.');
  ELSE
    v_refund_ref := 'REF-' || v_order.short_id;

    -- Idempotency for wallet refund
    IF EXISTS (
      SELECT 1 FROM public.wallet_transactions wt
      WHERE wt.reference = v_refund_ref AND wt.type = 'credit'
    ) THEN
      RETURN json_build_object('success', true, 'message', 'Order already cancelled and refunded');
    END IF;

    UPDATE public.customers
    SET wallet_balance = wallet_balance + v_order.total_amount
    WHERE id = p_customer_id
    RETURNING wallet_balance INTO v_new_balance;

    INSERT INTO public.wallet_transactions (customer_id, type, amount, description, reference)
    VALUES (p_customer_id, 'credit', v_order.total_amount,
            'Refund - Order cancelled by customer (' || v_order.short_id || ')', v_refund_ref);

    RETURN json_build_object('success', true, 'message', 'Order cancelled and wallet refunded', 'new_balance', v_new_balance);
  END IF;
END;
$$;
