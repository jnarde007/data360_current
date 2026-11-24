
-- Helper: detect existing non-final active order for same recipient+network
CREATE OR REPLACE FUNCTION public._has_active_order_for_recipient(
  p_network text,
  p_recipient_phone text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE recipient_phone = regexp_replace(p_recipient_phone, '[^0-9]', '', 'g')
      AND network = p_network
      AND status NOT IN ('delivered','failed','rejected','refunded','cancelled')
  );
$$;

-- 1) place_order (wallet flow): block duplicate; transaction rollback => no debit
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text,
  p_quantity integer, p_total_amount numeric, p_cost_price numeric DEFAULT 0,
  p_delivery_mode text DEFAULT 'manual'::text, p_provider_name text DEFAULT ''::text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_order_id uuid;
  new_short_id text;
  current_balance numeric;
  normalized_phone text;
  grace_end timestamptz;
  actual_cost_price numeric;
  v_available boolean;
  v_detected text;
BEGIN
  SELECT available_for_purchase INTO v_available
  FROM public.network_api_configs WHERE network = p_network LIMIT 1;
  IF NOT COALESCE(v_available, false) THEN
    RAISE EXCEPTION 'NETWORK_UNAVAILABLE: % is currently unavailable for purchase. Delivery is halted due to network issues.', p_network;
  END IF;

  normalized_phone := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');

  v_detected := public.detect_ghana_network(normalized_phone);
  IF v_detected IS NULL THEN
    RAISE EXCEPTION 'NETWORK_MISMATCH: % is not a valid Ghana mobile number.', p_recipient_phone;
  END IF;
  IF v_detected <> p_network THEN
    RAISE EXCEPTION 'NETWORK_MISMATCH: % belongs to % but you selected %. Mixed-network batches are not allowed.', p_recipient_phone, v_detected, p_network;
  END IF;

  -- Duplicate-recipient guard
  IF public._has_active_order_for_recipient(p_network, normalized_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PENDING: % already has an active order in the system. Please wait for delivery before ordering again.', normalized_phone;
  END IF;

  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data'
  LIMIT 1;
  IF actual_cost_price IS NULL THEN actual_cost_price := COALESCE(p_cost_price, 0); END IF;

  SELECT wallet_balance INTO current_balance FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF current_balance IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF current_balance < p_total_amount THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;

  UPDATE customers SET wallet_balance = wallet_balance - p_total_amount WHERE id = p_customer_id;

  grace_end := now() + interval '3 minutes';

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, delivery_mode, provider_name, status, grace_period_ends_at, detected_network)
  VALUES (p_customer_id, p_network, p_bundle_size, normalized_phone, p_quantity, p_total_amount, actual_cost_price, p_delivery_mode, p_provider_name, 'pending_confirmation', grace_end, v_detected)
  RETURNING id, short_id INTO new_order_id, new_short_id;

  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', p_total_amount, 'Data purchase - ' || p_bundle_size || ' ' || p_network, new_short_id);

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', grace_end);
END;
$function$;

-- 2) place_order_paystack (registered Paystack)
CREATE OR REPLACE FUNCTION public.place_order_paystack(
  p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text,
  p_quantity integer, p_total_amount numeric, p_payment_reference text,
  p_cost_price numeric DEFAULT 0, p_delivery_mode text DEFAULT 'manual'::text,
  p_provider_name text DEFAULT ''::text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_order_id uuid;
  new_short_id text;
  normalized_phone text;
  grace_end timestamptz;
  actual_cost_price numeric;
  v_available boolean;
BEGIN
  normalized_phone := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');

  IF p_payment_reference <> '' THEN
    DECLARE v_existing RECORD;
    BEGIN
      SELECT id, short_id, grace_period_ends_at INTO v_existing
      FROM orders WHERE payment_reference = p_payment_reference LIMIT 1;
      IF FOUND THEN
        RETURN json_build_object('order_id', v_existing.id, 'short_id', v_existing.short_id, 'grace_period_ends_at', v_existing.grace_period_ends_at, 'already_processed', true);
      END IF;
    END;
  END IF;

  SELECT available_for_purchase INTO v_available FROM public.network_api_configs WHERE network = p_network LIMIT 1;
  IF NOT COALESCE(v_available, false) THEN
    RAISE EXCEPTION 'NETWORK_UNAVAILABLE: % is currently unavailable for purchase. Delivery is halted due to network issues.', p_network;
  END IF;

  -- Duplicate-recipient guard (skips own idempotent reference, checked above)
  IF public._has_active_order_for_recipient(p_network, normalized_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PENDING: % already has an active order in the system. Order blocked; payment will be refunded to wallet.', normalized_phone;
  END IF;

  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data' LIMIT 1;
  IF actual_cost_price IS NULL THEN actual_cost_price := COALESCE(p_cost_price, 0); END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  grace_end := now() + interval '3 minutes';

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, delivery_mode, provider_name, status, grace_period_ends_at, payment_method, payment_reference, payment_verified_at)
  VALUES (p_customer_id, p_network, p_bundle_size, normalized_phone, p_quantity, p_total_amount, actual_cost_price, p_delivery_mode, p_provider_name, 'pending_confirmation', grace_end, 'paystack_direct', p_payment_reference, now())
  RETURNING id, short_id INTO new_order_id, new_short_id;

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', grace_end);
END;
$function$;

-- 3) place_order_guest_paystack (guest + store)
CREATE OR REPLACE FUNCTION public.place_order_guest_paystack(
  p_network text, p_bundle_size text, p_recipient_phone text, p_quantity integer,
  p_total_amount numeric, p_payment_reference text, p_buyer_phone text,
  p_buyer_email text DEFAULT ''::text, p_affiliate_code text DEFAULT ''::text,
  p_cost_price numeric DEFAULT 0, p_delivery_mode text DEFAULT 'manual'::text,
  p_provider_name text DEFAULT ''::text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_order_id uuid;
  new_short_id text;
  normalized_recipient text;
  normalized_buyer text;
  grace_end timestamptz;
  actual_cost_price numeric;
  v_tracking_token text;
  v_available boolean;
BEGIN
  normalized_recipient := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');
  normalized_buyer := regexp_replace(p_buyer_phone, '[^0-9]', '', 'g');

  IF p_payment_reference <> '' THEN
    DECLARE v_existing RECORD;
    BEGIN
      SELECT id, short_id, grace_period_ends_at, tracking_token INTO v_existing
      FROM orders WHERE payment_reference = p_payment_reference LIMIT 1;
      IF FOUND THEN
        RETURN json_build_object(
          'order_id', v_existing.id, 'short_id', v_existing.short_id,
          'grace_period_ends_at', v_existing.grace_period_ends_at,
          'tracking_token', v_existing.tracking_token, 'already_processed', true
        );
      END IF;
    END;
  END IF;

  SELECT available_for_purchase INTO v_available FROM public.network_api_configs WHERE network = p_network LIMIT 1;
  IF NOT COALESCE(v_available, false) THEN
    RAISE EXCEPTION 'NETWORK_UNAVAILABLE: % is currently unavailable for purchase. Delivery is halted due to network issues.', p_network;
  END IF;

  -- Duplicate-recipient guard
  IF public._has_active_order_for_recipient(p_network, normalized_recipient) THEN
    RAISE EXCEPTION 'DUPLICATE_PENDING: % already has an active order in the system. Order blocked; payment will be refunded.', normalized_recipient;
  END IF;

  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data' LIMIT 1;
  IF actual_cost_price IS NULL THEN actual_cost_price := COALESCE(p_cost_price, 0); END IF;

  grace_end := now() + interval '3 minutes';

  v_tracking_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_tracking_token := left(v_tracking_token, 48);

  INSERT INTO orders (
    customer_id, network, bundle_size, recipient_phone, quantity,
    total_amount, cost_price, delivery_mode, provider_name,
    status, grace_period_ends_at,
    payment_method, payment_reference, payment_verified_at,
    buyer_type, buyer_phone, buyer_email, tracking_token, affiliate_code
  )
  VALUES (
    NULL, p_network, p_bundle_size, normalized_recipient, p_quantity,
    p_total_amount, actual_cost_price, p_delivery_mode, p_provider_name,
    'pending_confirmation', grace_end,
    'paystack_direct', p_payment_reference, now(),
    'guest', normalized_buyer, p_buyer_email, v_tracking_token, p_affiliate_code
  )
  RETURNING id, short_id INTO new_order_id, new_short_id;

  RETURN json_build_object(
    'order_id', new_order_id, 'short_id', new_short_id,
    'grace_period_ends_at', grace_end, 'tracking_token', v_tracking_token
  );
END;
$function$;
