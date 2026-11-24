
-- ============================================================
-- admin_retry_payout: clones a failed payout into a fresh pending_approval
-- payout, re-locking funds from the user's available balance.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_retry_payout(
  p_original_payout_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_orig public.payouts%ROWTYPE;
  v_new_id uuid;
  v_available numeric;
  v_existing public.payouts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT * INTO v_orig FROM public.payouts WHERE id = p_original_payout_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Original payout not found'); END IF;
  IF v_orig.status <> 'failed' THEN
    RETURN jsonb_build_object('error', format('Only failed payouts can be retried (current: %s)', v_orig.status));
  END IF;

  -- Idempotency
  SELECT * INTO v_existing FROM public.payouts WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'payout_id', v_existing.id, 'already_processed', true);
  END IF;

  -- Re-lock funds
  IF v_orig.payout_type = 'affiliate' THEN
    PERFORM 1 FROM public.customers WHERE id = v_orig.owner_id FOR UPDATE;
    SELECT available_commission INTO v_available FROM public.customers WHERE id = v_orig.owner_id;
    IF v_available < v_orig.amount THEN
      RETURN jsonb_build_object('error','Insufficient available commission to retry');
    END IF;
    UPDATE public.customers
       SET available_commission = available_commission - v_orig.amount,
           locked_commission = locked_commission + v_orig.amount
     WHERE id = v_orig.owner_id;
  ELSE
    INSERT INTO public.store_wallets(owner_id) VALUES (v_orig.owner_id) ON CONFLICT (owner_id) DO NOTHING;
    PERFORM 1 FROM public.store_wallets WHERE owner_id = v_orig.owner_id FOR UPDATE;
    SELECT available_balance INTO v_available FROM public.store_wallets WHERE owner_id = v_orig.owner_id;
    IF v_available < v_orig.amount THEN
      RETURN jsonb_build_object('error','Insufficient available store balance to retry');
    END IF;
    UPDATE public.store_wallets
       SET available_balance = available_balance - v_orig.amount,
           locked_balance = locked_balance + v_orig.amount,
           updated_at = now()
     WHERE owner_id = v_orig.owner_id;
  END IF;

  INSERT INTO public.payouts(
    payout_type, owner_id, amount, fee, net_amount,
    status, rail,
    recipient_type, momo_number, momo_name, network,
    idempotency_key, requested_by, admin_note
  ) VALUES (
    v_orig.payout_type, v_orig.owner_id, v_orig.amount, v_orig.fee, v_orig.net_amount,
    'pending_approval', 'paystack',
    v_orig.recipient_type, v_orig.momo_number, v_orig.momo_name, v_orig.network,
    p_idempotency_key, v_admin_id,
    format('Retry of %s', v_orig.short_id)
  ) RETURNING id INTO v_new_id;

  PERFORM public.payout_audit(v_new_id, 'retry_created', v_admin_id, 'admin', NULL, 'pending_approval',
    jsonb_build_object('original_payout_id', v_orig.id));

  RETURN jsonb_build_object('success', true, 'payout_id', v_new_id, 'status', 'pending_approval');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retry_payout(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_retry_payout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_payout(uuid, text) TO service_role;

-- ============================================================
-- Schedule reconcile-payouts every 10 minutes
-- ============================================================
DO $$
BEGIN
  -- Drop any pre-existing schedule with the same name
  PERFORM cron.unschedule('reconcile-payouts-job') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'reconcile-payouts-job'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reconcile-payouts-job',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bpntlyplmitxiaounthf.supabase.co/functions/v1/reconcile-payouts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbnRseXBsbWl0eGlhb3VudGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTg3MTQsImV4cCI6MjA4ODU3NDcxNH0.en6ActRrL5y9uV-GLw64gemQGpgywPVYpjt1Wfc3kgM'
    ),
    body := jsonb_build_object('triggered_at', now())
  );
  $$
);
