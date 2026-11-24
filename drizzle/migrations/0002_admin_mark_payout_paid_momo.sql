CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid_momo(p_payout_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_payout public.payouts%ROWTYPE;
  v_available numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Payout not found'); END IF;

  IF v_payout.status = 'success' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;
  IF v_payout.status NOT IN ('failed','approved','processing') THEN
    RETURN jsonb_build_object('error', format('Cannot mark as paid via MoMo from status %s', v_payout.status));
  END IF;

  -- Failed payouts already released funds back to available; re-lock them.
  IF v_payout.status = 'failed' THEN
    IF v_payout.payout_type = 'affiliate' THEN
      PERFORM 1 FROM public.customers WHERE id = v_payout.owner_id FOR UPDATE;
      SELECT available_commission INTO v_available FROM public.customers WHERE id = v_payout.owner_id;
      IF v_available < v_payout.amount THEN
        RETURN jsonb_build_object('error','Insufficient available commission to mark as paid');
      END IF;
      UPDATE public.customers
         SET available_commission = available_commission - v_payout.amount,
             locked_commission = locked_commission + v_payout.amount
       WHERE id = v_payout.owner_id;
    ELSE
      INSERT INTO public.store_wallets(owner_id) VALUES (v_payout.owner_id) ON CONFLICT (owner_id) DO NOTHING;
      PERFORM 1 FROM public.store_wallets WHERE owner_id = v_payout.owner_id FOR UPDATE;
      SELECT available_balance INTO v_available FROM public.store_wallets WHERE owner_id = v_payout.owner_id;
      IF v_available < v_payout.amount THEN
        RETURN jsonb_build_object('error','Insufficient available store balance to mark as paid');
      END IF;
      UPDATE public.store_wallets
         SET available_balance = available_balance - v_payout.amount,
             locked_balance = locked_balance + v_payout.amount,
             updated_at = now()
       WHERE owner_id = v_payout.owner_id;
    END IF;
  END IF;

  -- Finalize: remove from locked, add to withdrawn / reduce total
  IF v_payout.payout_type = 'affiliate' THEN
    UPDATE public.customers
       SET locked_commission = locked_commission - v_payout.amount,
           total_commission = GREATEST(total_commission - v_payout.amount, 0)
     WHERE id = v_payout.owner_id;
  ELSE
    UPDATE public.store_wallets
       SET locked_balance = locked_balance - v_payout.amount,
           withdrawn_balance = withdrawn_balance + v_payout.amount,
           updated_at = now()
     WHERE owner_id = v_payout.owner_id;
  END IF;

  UPDATE public.payouts
     SET status = 'success',
         rail = 'momo',
         completed_at = now(),
         failure_reason = NULL,
         admin_note = COALESCE(p_note, admin_note),
         updated_at = now()
   WHERE id = p_payout_id;

  PERFORM public.payout_audit(p_payout_id, 'marked_paid_momo', v_admin_id, 'admin', v_payout.status, 'success',
    jsonb_build_object('note', p_note));

  RETURN jsonb_build_object('success', true, 'status', 'success');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_mark_payout_paid_momo(uuid, text) TO authenticated;