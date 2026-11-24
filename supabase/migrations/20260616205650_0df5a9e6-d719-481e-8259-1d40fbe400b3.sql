-- 1. Add detected_network column for audit purposes
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS detected_network text;
CREATE INDEX IF NOT EXISTS idx_orders_detected_network ON public.orders(detected_network);

-- 2. Helper: detect Ghana network from any phone string
CREATE OR REPLACE FUNCTION public.detect_ghana_network(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  digits text;
  prefix text;
BEGIN
  IF p_phone IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  -- Normalize +233/233 → 0xxxxxxxxx
  IF length(digits) >= 12 AND left(digits, 3) = '233' THEN
    digits := '0' || substring(digits from 4);
  END IF;
  IF length(digits) < 3 THEN RETURN NULL; END IF;
  prefix := left(digits, 3);
  RETURN CASE prefix
    WHEN '024' THEN 'MTN' WHEN '025' THEN 'MTN' WHEN '053' THEN 'MTN'
    WHEN '054' THEN 'MTN' WHEN '055' THEN 'MTN' WHEN '059' THEN 'MTN'
    WHEN '026' THEN 'AirtelTigo' WHEN '027' THEN 'AirtelTigo'
    WHEN '056' THEN 'AirtelTigo' WHEN '057' THEN 'AirtelTigo'
    WHEN '020' THEN 'Telecel' WHEN '050' THEN 'Telecel'
    ELSE NULL
  END;
END;
$$;

-- 3. Update place_order to enforce strict network match + store detected_network
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text,
  p_quantity integer, p_total_amount numeric, p_cost_price numeric DEFAULT 0,
  p_delivery_mode text DEFAULT 'manual'::text, p_provider_name text DEFAULT ''::text
)
RETURNS json
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
  -- Network availability gate
  SELECT available_for_purchase INTO v_available
  FROM public.network_api_configs WHERE network = p_network LIMIT 1;
  IF NOT COALESCE(v_available, false) THEN
    RAISE EXCEPTION 'NETWORK_UNAVAILABLE: % is currently unavailable for purchase. Delivery is halted due to network issues.', p_network;
  END IF;

  normalized_phone := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');

  -- Strict network validation
  v_detected := public.detect_ghana_network(normalized_phone);
  IF v_detected IS NULL THEN
    RAISE EXCEPTION 'NETWORK_MISMATCH: % is not a valid Ghana mobile number.', p_recipient_phone;
  END IF;
  IF v_detected <> p_network THEN
    RAISE EXCEPTION 'NETWORK_MISMATCH: % belongs to % but you selected %. Mixed-network batches are not allowed.', p_recipient_phone, v_detected, p_network;
  END IF;

  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data'
  LIMIT 1;

  IF actual_cost_price IS NULL THEN
    actual_cost_price := COALESCE(p_cost_price, 0);
  END IF;

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