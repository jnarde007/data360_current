CREATE OR REPLACE FUNCTION public.request_store_payout(
  p_amount numeric,
  p_momo_number text,
  p_momo_name text,
  p_network text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_owner uuid := public.get_my_customer_id();
  v_min numeric;
  v_enabled boolean;
  v_available numeric;
  v_payout_id uuid;
  v_short text;
  v_idem text;
  v_number text := regexp_replace(COALESCE(p_momo_number,''), '\D', '', 'g');
  v_name text := trim(COALESCE(p_momo_name,''));
  v_existing public.payouts%ROWTYPE;
BEGIN
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error','Please sign in to request a payout.');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RETURN jsonb_build_object('error','Enter a valid amount.');
  END IF;

  IF p_network IS NULL OR p_network NOT IN ('MTN','VOD','ATL') THEN
    RETURN jsonb_build_object('error','Choose a valid Mobile Money network.');
  END IF;

  IF v_number !~ '^0[235]\d{8}$' THEN
    RETURN jsonb_build_object('error','Enter a valid 10-digit Mobile Money number starting with 0.');
  END IF;

  IF length(v_name) < 2 OR length(v_name) > 100 THEN
    RETURN jsonb_build_object('error','Enter the name on the Mobile Money account.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE owner_id = v_owner AND status = 'active' AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('error','Your store must be active to request a payout.');
  END IF;

  SELECT (value)::boolean INTO v_enabled FROM public.platform_settings WHERE key='payouts_enabled_store';
  IF v_enabled IS FALSE THEN
    RETURN jsonb_build_object('error','Store payouts are temporarily disabled. Please try again later.');
  END IF;

  SELECT (value)::numeric INTO v_min FROM public.platform_settings WHERE key='payout_min_store';
  IF v_min IS NULL THEN v_min := 20; END IF;
  IF p_amount < v_min THEN
    RETURN jsonb_build_object('error', format('Minimum payout is GHS %s.', v_min));
  END IF;

  v_idem := 'store-req-' || v_owner::text || '-' ||
            COALESCE(NULLIF(trim(p_idempotency_key),''), extract(epoch from clock_timestamp())::bigint::text);

  SELECT * INTO v_existing FROM public.payouts WHERE idempotency_key = v_idem;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'payout_id', v_existing.id,
      'short_id', v_existing.short_id, 'amount', v_existing.amount, 'status', v_existing.status, 'created_at', v_existing.created_at);
  END IF;

  -- Serialize all requests for this owner on the wallet row
  INSERT INTO public.store_wallets(owner_id) VALUES (v_owner) ON CONFLICT (owner_id) DO NOTHING;
  SELECT available_balance INTO v_available FROM public.store_wallets WHERE owner_id = v_owner FOR UPDATE;

  -- Re-check idempotency after acquiring the lock (concurrent same-key calls)
  SELECT * INTO v_existing FROM public.payouts WHERE idempotency_key = v_idem;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true, 'payout_id', v_existing.id,
      'short_id', v_existing.short_id, 'amount', v_existing.amount, 'status', v_existing.status, 'created_at', v_existing.created_at);
  END IF;

  IF EXISTS (SELECT 1 FROM public.payouts WHERE owner_id = v_owner AND payout_type = 'store'
             AND status IN ('pending_approval','approved','processing')) THEN
    RETURN jsonb_build_object('error','You already have a payout request in progress. Please wait for it to finish.');
  END IF;

  IF COALESCE(v_available,0) < p_amount THEN
    RETURN jsonb_build_object('error','Insufficient available balance.');
  END IF;

  UPDATE public.store_wallets
     SET available_balance = available_balance - p_amount,
         locked_balance = locked_balance + p_amount,
         updated_at = now()
   WHERE owner_id = v_owner;

  INSERT INTO public.payouts(
    payout_type, owner_id, amount, fee, net_amount, status, rail,
    recipient_type, momo_number, momo_name, network, idempotency_key, requested_by
  ) VALUES (
    'store', v_owner, p_amount, 0, p_amount, 'pending_approval', 'paystack',
    'mobile_money', v_number, v_name, p_network, v_idem, v_owner
  ) RETURNING id, short_id INTO v_payout_id, v_short;

  PERFORM public.payout_audit(v_payout_id, 'requested', v_owner, 'customer', NULL, 'pending_approval',
    jsonb_build_object('amount', p_amount, 'network', p_network, 'source', 'store_owner'));

  RETURN jsonb_build_object('success', true, 'payout_id', v_payout_id, 'short_id', v_short,
    'amount', p_amount, 'status', 'pending_approval', 'created_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.request_store_payout(numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_store_payout(numeric, text, text, text, text) TO authenticated;