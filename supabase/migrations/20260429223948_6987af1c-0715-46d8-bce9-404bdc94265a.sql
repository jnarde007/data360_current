-- Normalize AFA price row size to a stable label (no-op if already 'Per Registration')
UPDATE public.price_items
   SET size = 'Per Registration'
 WHERE product = 'AFA Registration' AND network = 'MTN' AND size <> 'Per Registration';

-- Recreate the three AFA RPCs to look up price by product+network only (size-agnostic).
CREATE OR REPLACE FUNCTION public.place_afa_wallet(
  p_customer_id uuid,
  p_full_name text,
  p_registration_phone text,
  p_location text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price numeric;
  v_balance numeric;
  v_id uuid;
  v_short_id text;
  v_norm_phone text;
BEGIN
  v_norm_phone := regexp_replace(p_registration_phone, '[^0-9]', '', 'g');
  IF length(v_norm_phone) < 9 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid phone number');
  END IF;
  IF length(trim(p_full_name)) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Full name is required');
  END IF;
  IF length(trim(p_location)) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Location is required');
  END IF;

  SELECT price INTO v_price FROM public.price_items
  WHERE product = 'AFA Registration' AND network = 'MTN'
  ORDER BY updated_at DESC LIMIT 1;
  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'AFA price not configured');
  END IF;

  SELECT wallet_balance INTO v_balance FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Customer not found');
  END IF;
  IF v_balance < v_price THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient wallet balance');
  END IF;

  UPDATE public.customers SET wallet_balance = wallet_balance - v_price WHERE id = p_customer_id;

  INSERT INTO public.afa_registrations
    (customer_id, buyer_type, full_name, registration_phone, location, status,
     total_amount, payment_method, payment_verified_at)
  VALUES
    (p_customer_id, 'registered', trim(p_full_name), v_norm_phone, trim(p_location), 'submitted',
     v_price, 'wallet', now())
  RETURNING id, short_id INTO v_id, v_short_id;

  INSERT INTO public.wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', v_price,
          'AFA Registration (' || v_short_id || ')', v_short_id);

  RETURN json_build_object('success', true, 'id', v_id, 'short_id', v_short_id, 'amount', v_price);
END;
$$;

CREATE OR REPLACE FUNCTION public.place_afa_paystack(
  p_customer_id uuid,
  p_full_name text,
  p_registration_phone text,
  p_location text,
  p_payment_reference text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price numeric;
  v_id uuid;
  v_short_id text;
  v_norm_phone text;
  v_existing RECORD;
BEGIN
  v_norm_phone := regexp_replace(p_registration_phone, '[^0-9]', '', 'g');

  IF p_payment_reference <> '' THEN
    SELECT id, short_id INTO v_existing FROM public.afa_registrations
    WHERE payment_reference = p_payment_reference LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'already_processed', true,
        'id', v_existing.id, 'short_id', v_existing.short_id);
    END IF;
  END IF;

  SELECT price INTO v_price FROM public.price_items
  WHERE product = 'AFA Registration' AND network = 'MTN'
  ORDER BY updated_at DESC LIMIT 1;
  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'AFA price not configured');
  END IF;

  INSERT INTO public.afa_registrations
    (customer_id, buyer_type, full_name, registration_phone, location, status,
     total_amount, payment_method, payment_reference, payment_verified_at)
  VALUES
    (p_customer_id, 'registered', trim(p_full_name), v_norm_phone, trim(p_location), 'submitted',
     v_price, 'paystack_direct', p_payment_reference, now())
  RETURNING id, short_id INTO v_id, v_short_id;

  RETURN json_build_object('success', true, 'id', v_id, 'short_id', v_short_id, 'amount', v_price);
END;
$$;

CREATE OR REPLACE FUNCTION public.place_afa_guest_paystack(
  p_full_name text,
  p_registration_phone text,
  p_location text,
  p_buyer_phone text,
  p_buyer_email text,
  p_affiliate_code text,
  p_payment_reference text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price numeric;
  v_id uuid;
  v_short_id text;
  v_norm_phone text;
  v_norm_buyer text;
  v_token text;
  v_existing RECORD;
BEGIN
  v_norm_phone := regexp_replace(p_registration_phone, '[^0-9]', '', 'g');
  v_norm_buyer := regexp_replace(p_buyer_phone, '[^0-9]', '', 'g');

  IF p_payment_reference <> '' THEN
    SELECT id, short_id, tracking_token INTO v_existing FROM public.afa_registrations
    WHERE payment_reference = p_payment_reference LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'already_processed', true,
        'id', v_existing.id, 'short_id', v_existing.short_id, 'tracking_token', v_existing.tracking_token);
    END IF;
  END IF;

  SELECT price INTO v_price FROM public.price_items
  WHERE product = 'AFA Registration' AND network = 'MTN'
  ORDER BY updated_at DESC LIMIT 1;
  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'AFA price not configured');
  END IF;

  v_token := left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 48);

  INSERT INTO public.afa_registrations
    (customer_id, buyer_type, full_name, registration_phone, location, status,
     buyer_phone, buyer_email, total_amount, payment_method, payment_reference,
     payment_verified_at, affiliate_code, tracking_token)
  VALUES
    (NULL, 'guest', trim(p_full_name), v_norm_phone, trim(p_location), 'submitted',
     v_norm_buyer, p_buyer_email, v_price, 'paystack_direct', p_payment_reference,
     now(), COALESCE(p_affiliate_code, ''), v_token)
  RETURNING id, short_id INTO v_id, v_short_id;

  RETURN json_build_object('success', true, 'id', v_id, 'short_id', v_short_id,
    'tracking_token', v_token, 'amount', v_price);
END;
$$;