
-- Add grace_period_ends_at column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz;

-- Update place_order (7-param version) to use pending_confirmation and set grace period
CREATE OR REPLACE FUNCTION public.place_order(p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text, p_quantity integer, p_total_amount numeric, p_cost_price numeric)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_balance numeric;
  new_order_id uuid;
  new_short_id text;
  normalized_phone text;
  active_count integer;
BEGIN
  normalized_phone := regexp_replace(p_recipient_phone, '\s+', '', 'g');
  IF normalized_phone LIKE '+233%' THEN
    normalized_phone := '0' || substring(normalized_phone from 5);
  ELSIF normalized_phone LIKE '233%' AND length(normalized_phone) = 12 THEN
    normalized_phone := '0' || substring(normalized_phone from 4);
  END IF;

  SELECT count(*) INTO active_count
  FROM orders
  WHERE regexp_replace(recipient_phone, '\s+', '', 'g') = normalized_phone
    AND status NOT IN ('delivered', 'failed', 'cancelled', 'refunded', 'resolved', 'customer_cancelled');

  IF active_count > 0 THEN
    RETURN json_build_object('error', 'There is already an active order for this number. Please wait until it is delivered or completed before placing another order.');
  END IF;

  SELECT wallet_balance INTO current_balance
  FROM customers WHERE id = p_customer_id FOR UPDATE;

  IF current_balance IS NULL THEN
    RETURN json_build_object('error', 'Customer not found');
  END IF;

  IF current_balance < p_total_amount THEN
    RETURN json_build_object('error', 'Insufficient balance');
  END IF;

  UPDATE customers SET wallet_balance = wallet_balance - p_total_amount WHERE id = p_customer_id;

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, status, grace_period_ends_at)
  VALUES (p_customer_id, p_network, p_bundle_size, normalized_phone, p_quantity, p_total_amount, p_cost_price, 'pending_confirmation', now() + interval '3 minutes')
  RETURNING id, short_id INTO new_order_id, new_short_id;

  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', p_total_amount, 'Data purchase - ' || p_bundle_size || ' ' || p_network, new_short_id);

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', (now() + interval '3 minutes'));
END;
$$;

-- Update place_order (9-param version) to use pending_confirmation and set grace period
CREATE OR REPLACE FUNCTION public.place_order(p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text, p_quantity integer, p_total_amount numeric, p_cost_price numeric, p_delivery_mode text DEFAULT 'manual', p_provider_name text DEFAULT '')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_balance numeric;
  new_order_id uuid;
  new_short_id text;
  normalized_phone text;
  active_count integer;
BEGIN
  normalized_phone := regexp_replace(p_recipient_phone, '\s+', '', 'g');
  IF normalized_phone LIKE '+233%' THEN
    normalized_phone := '0' || substring(normalized_phone from 5);
  ELSIF normalized_phone LIKE '233%' AND length(normalized_phone) = 12 THEN
    normalized_phone := '0' || substring(normalized_phone from 4);
  END IF;

  SELECT count(*) INTO active_count
  FROM orders
  WHERE regexp_replace(recipient_phone, '\s+', '', 'g') = normalized_phone
    AND status NOT IN ('delivered', 'failed', 'cancelled', 'refunded', 'resolved', 'customer_cancelled');

  IF active_count > 0 THEN
    RETURN json_build_object('error', 'There is already an active order for this number. Please wait until it is delivered or completed before placing another order.');
  END IF;

  SELECT wallet_balance INTO current_balance
  FROM customers WHERE id = p_customer_id FOR UPDATE;

  IF current_balance IS NULL THEN
    RETURN json_build_object('error', 'Customer not found');
  END IF;

  IF current_balance < p_total_amount THEN
    RETURN json_build_object('error', 'Insufficient balance');
  END IF;

  UPDATE customers SET wallet_balance = wallet_balance - p_total_amount WHERE id = p_customer_id;

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, delivery_mode, provider_name, status, grace_period_ends_at)
  VALUES (p_customer_id, p_network, p_bundle_size, normalized_phone, p_quantity, p_total_amount, p_cost_price, p_delivery_mode, p_provider_name, 'pending_confirmation', now() + interval '3 minutes')
  RETURNING id, short_id INTO new_order_id, new_short_id;

  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', p_total_amount, 'Data purchase - ' || p_bundle_size || ' ' || p_network, new_short_id);

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', (now() + interval '3 minutes'));
END;
$$;
