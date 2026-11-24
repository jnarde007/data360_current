-- ── Orders: guest refund MoMo fallback number ──
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_momo_number text NOT NULL DEFAULT '';

-- ── Refunds: richer record ──
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS provider_reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS refund_destination text NOT NULL DEFAULT 'wallet',
  ADD COLUMN IF NOT EXISTS customer_has_wallet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS momo_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS momo_approved_by uuid,
  ADD COLUMN IF NOT EXISTS momo_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS original_payment_method text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS original_payment_reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS refunds_idempotency_key_uniq
  ON public.refunds (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- One live refund per order (failed/cancelled records may be superseded)
CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_live_per_order
  ON public.refunds (order_id)
  WHERE order_id IS NOT NULL AND status NOT IN ('failed','refund_failed','cancelled');

CREATE INDEX IF NOT EXISTS refunds_status_idx ON public.refunds (status);
CREATE INDEX IF NOT EXISTS refunds_created_at_idx ON public.refunds (created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.refunds TO authenticated;
GRANT ALL ON public.refunds TO service_role;

-- ── Core: provider refund handler (idempotent, atomic) ──
CREATE OR REPLACE FUNCTION public.handle_provider_refund(
  p_order_id uuid,
  p_provider_reference text DEFAULT '',
  p_provider_name text DEFAULT 'Portal-02',
  p_amount numeric DEFAULT NULL,
  p_reason text DEFAULT 'Provider confirmed refund'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_existing public.refunds%ROWTYPE;
  v_amount numeric;
  v_has_wallet boolean := false;
  v_dest text;
  v_refund_id uuid;
  v_ref text;
  v_balance numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- Idempotency: any live refund for this order wins
  SELECT * INTO v_existing FROM public.refunds
   WHERE order_id = p_order_id
     AND status NOT IN ('failed','refund_failed','cancelled')
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true,
      'refund_id', v_existing.id, 'status', v_existing.status,
      'destination', v_existing.refund_destination);
  END IF;

  -- Legacy wallet refund guard
  IF EXISTS (SELECT 1 FROM public.wallet_transactions
              WHERE reference = 'REF-' || v_order.short_id AND type = 'credit') THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', 'completed',
      'destination', 'wallet', 'note', 'legacy wallet refund already issued');
  END IF;

  v_amount := COALESCE(p_amount, v_order.total_amount);
  IF v_amount > v_order.total_amount THEN
    v_amount := v_order.total_amount;
  END IF;

  -- Does this buyer have a usable platform wallet? (account-based, NOT buyer_type)
  IF v_order.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers
      WHERE id = v_order.customer_id AND deleted_at IS NULL FOR UPDATE;
    v_has_wallet := FOUND;
  END IF;

  -- Store Link / guest orders may still belong to a registered account
  IF NOT v_has_wallet AND COALESCE(v_order.linked_customer_id, NULL) IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers
      WHERE id = v_order.linked_customer_id AND deleted_at IS NULL FOR UPDATE;
    v_has_wallet := FOUND;
  END IF;

  IF NOT v_has_wallet AND COALESCE(v_order.buyer_email, '') <> '' THEN
    SELECT * INTO v_customer FROM public.customers
      WHERE lower(email) = lower(v_order.buyer_email) AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1 FOR UPDATE;
    v_has_wallet := FOUND;
  END IF;

  v_dest := CASE WHEN v_has_wallet THEN 'wallet' ELSE 'paystack' END;
  v_ref := 'REF-' || v_order.short_id;

  INSERT INTO public.refunds (
    order_id, customer_id, buyer_type, refund_method, refund_destination,
    customer_has_wallet, refund_amount, amount_paid, data_value,
    provider_reference, provider_name,
    original_payment_method, original_payment_reference,
    paystack_reference, momo_number,
    status, refund_reason, initiated_by, idempotency_key,
    timeline
  ) VALUES (
    p_order_id, CASE WHEN v_has_wallet THEN v_customer.id ELSE v_order.customer_id END,
    CASE WHEN v_has_wallet THEN 'registered' ELSE 'guest' END,
    v_dest, v_dest, v_has_wallet, v_amount, v_amount, v_order.total_amount,
    COALESCE(p_provider_reference, ''), COALESCE(p_provider_name, ''),
    COALESCE(v_order.payment_method, ''), COALESCE(v_order.payment_reference, ''),
    COALESCE(v_order.payment_reference, ''), COALESCE(v_order.refund_momo_number, ''),
    'pending', p_reason, 'provider_auto',
    'provider_refund:' || p_order_id::text,
    jsonb_build_array(jsonb_build_object('at', now(), 'event', 'detected',
      'detail', p_provider_name || ' confirmed refund'))
  )
  RETURNING id INTO v_refund_id;

  -- Mark order as refunded/rejected
  UPDATE public.orders SET status = 'rejected' WHERE id = p_order_id
    AND status NOT IN ('rejected','refunded');

  IF v_has_wallet THEN
    UPDATE public.customers
       SET wallet_balance = wallet_balance + v_amount
     WHERE id = v_customer.id
     RETURNING wallet_balance INTO v_balance;

    INSERT INTO public.wallet_transactions (customer_id, type, amount, description, reference)
    VALUES (v_customer.id, 'credit', v_amount,
      'Refund - Order ' || v_order.short_id || ' (' || COALESCE(p_provider_name,'provider') || ' automatic refund)',
      v_ref);

    UPDATE public.refunds
       SET status = 'completed', total_refunded = v_amount,
           processed_at = now(), completed_at = now(),
           timeline = timeline || jsonb_build_array(jsonb_build_object(
             'at', now(), 'event', 'completed', 'detail', 'Wallet credited ' || v_amount::text))
     WHERE id = v_refund_id;

    RETURN jsonb_build_object('success', true, 'refund_id', v_refund_id,
      'destination', 'wallet', 'status', 'completed', 'amount', v_amount,
      'customer_id', v_customer.id, 'new_balance', v_balance);
  END IF;

  RETURN jsonb_build_object('success', true, 'refund_id', v_refund_id,
    'destination', 'paystack', 'status', 'pending', 'amount', v_amount,
    'paystack_reference', COALESCE(v_order.payment_reference, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.handle_provider_refund(uuid, text, text, numeric, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_provider_refund(uuid, text, text, numeric, text) TO service_role;

-- ── Admin: approve MoMo fallback (never when Paystack already succeeded) ──
CREATE OR REPLACE FUNCTION public.admin_approve_momo_refund(
  p_refund_id uuid,
  p_momo_number text,
  p_admin_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFUND_NOT_FOUND');
  END IF;

  IF v_refund.status IN ('completed','refunded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REFUNDED');
  END IF;

  IF COALESCE(v_refund.paystack_refund_id, '') <> ''
     AND v_refund.status NOT IN ('failed','refund_failed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'PAYSTACK_REFUND_IN_FLIGHT');
  END IF;

  UPDATE public.refunds
     SET refund_destination = 'momo', refund_method = 'momo',
         momo_number = p_momo_number,
         momo_approved_by = auth.uid(), momo_approved_at = now(),
         status = 'processing', processed_at = now(),
         admin_note = COALESCE(NULLIF(p_admin_note, ''), admin_note),
         timeline = timeline || jsonb_build_array(jsonb_build_object(
           'at', now(), 'event', 'momo_approved', 'detail', 'MoMo fallback approved to ' || p_momo_number))
   WHERE id = p_refund_id;

  RETURN jsonb_build_object('success', true, 'refund_id', p_refund_id, 'destination', 'momo');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_momo_refund(uuid, text, text) TO authenticated;

-- ── Admin: set final refund status manually ──
CREATE OR REPLACE FUNCTION public.admin_set_refund_status(
  p_refund_id uuid,
  p_status text,
  p_admin_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_refund public.refunds%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF p_status NOT IN ('pending','processing','completed','failed','reversed','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'REFUND_NOT_FOUND');
  END IF;

  UPDATE public.refunds
     SET status = p_status,
         admin_note = COALESCE(NULLIF(p_admin_note, ''), admin_note),
         total_refunded = CASE WHEN p_status = 'completed' THEN refund_amount ELSE total_refunded END,
         completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
         timeline = timeline || jsonb_build_array(jsonb_build_object(
           'at', now(), 'event', 'admin_status', 'detail', p_status))
   WHERE id = p_refund_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_refund_status(uuid, text, text) TO authenticated;