
CREATE OR REPLACE FUNCTION public.place_order_paystack(
  p_customer_id uuid,
  p_network text,
  p_bundle_size text,
  p_recipient_phone text,
  p_quantity integer,
  p_total_amount numeric,
  p_payment_reference text,
  p_cost_price numeric DEFAULT 0,
  p_delivery_mode text DEFAULT 'manual',
  p_provider_name text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_order_id uuid;
  new_short_id text;
  normalized_phone text;
  grace_end timestamptz;
  actual_cost_price numeric;
BEGIN
  normalized_phone := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');

  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data'
  LIMIT 1;
  
  IF actual_cost_price IS NULL THEN
    actual_cost_price := COALESCE(p_cost_price, 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  IF p_payment_reference <> '' THEN
    DECLARE
      v_existing RECORD;
    BEGIN
      SELECT id, short_id, grace_period_ends_at INTO v_existing
      FROM orders WHERE payment_reference = p_payment_reference LIMIT 1;
      IF FOUND THEN
        RETURN json_build_object('order_id', v_existing.id, 'short_id', v_existing.short_id, 'grace_period_ends_at', v_existing.grace_period_ends_at, 'already_processed', true);
      END IF;
    END;
  END IF;

  grace_end := now() + interval '3 minutes';

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, delivery_mode, provider_name, status, grace_period_ends_at, payment_method, payment_reference, payment_verified_at)
  VALUES (p_customer_id, p_network, p_bundle_size, normalized_phone, p_quantity, p_total_amount, actual_cost_price, p_delivery_mode, p_provider_name, 'pending_confirmation', grace_end, 'paystack_direct', p_payment_reference, now())
  RETURNING id, short_id INTO new_order_id, new_short_id;

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', grace_end);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_checker_paystack(
  p_customer_id uuid,
  p_product_id uuid,
  p_payment_reference text,
  p_quantity integer DEFAULT 1,
  p_sms_phone text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_total_cost NUMERIC;
  v_purchase_id UUID;
  v_short_id TEXT;
  v_assigned_count INTEGER := 0;
  v_checker RECORD;
  v_codes JSON[];
BEGIN
  IF p_quantity < 1 OR p_quantity > 50 THEN
    RETURN json_build_object('success', false, 'error', 'Quantity must be between 1 and 50');
  END IF;

  IF p_payment_reference <> '' THEN
    DECLARE
      v_existing RECORD;
    BEGIN
      SELECT id, short_id INTO v_existing
      FROM checker_purchases WHERE payment_reference = p_payment_reference LIMIT 1;
      IF FOUND THEN
        SELECT array_agg(json_build_object('serial_number', ci.serial_number, 'pin', ci.pin)::json)
        INTO v_codes
        FROM checker_inventory ci WHERE ci.purchase_id = v_existing.id;
        
        RETURN json_build_object(
          'success', true, 'already_processed', true,
          'purchase_id', v_existing.id, 'short_id', v_existing.short_id,
          'codes', COALESCE(array_to_json(v_codes), '[]'::json)
        );
      END IF;
    END;
  END IF;

  SELECT * INTO v_product FROM checker_products WHERE id = p_product_id AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  v_total_cost := v_product.price * p_quantity;

  SELECT count(*) INTO v_assigned_count FROM checker_inventory
    WHERE product_id = p_product_id AND status = 'available';
  IF v_assigned_count < p_quantity THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient stock. Only ' || v_assigned_count || ' available, but ' || p_quantity || ' requested');
  END IF;

  INSERT INTO checker_purchases (customer_id, product_id, amount, sms_phone, status, quantity, payment_method, payment_reference, payment_verified_at)
    VALUES (p_customer_id, p_product_id, v_total_cost, p_sms_phone, 'completed', p_quantity, 'paystack_direct', p_payment_reference, now())
    RETURNING id, short_id INTO v_purchase_id, v_short_id;

  v_codes := ARRAY[]::json[];
  FOR v_checker IN
    SELECT * FROM checker_inventory
      WHERE product_id = p_product_id AND status = 'available'
      ORDER BY imported_at ASC LIMIT p_quantity
      FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE checker_inventory
      SET status = 'sold', sold_at = now(), assigned_to = p_customer_id, purchase_id = v_purchase_id
      WHERE id = v_checker.id;
    v_codes := v_codes || json_build_object('serial_number', v_checker.serial_number, 'pin', v_checker.pin)::json;
  END LOOP;

  IF array_length(v_codes, 1) IS NULL OR array_length(v_codes, 1) < p_quantity THEN
    RAISE EXCEPTION 'Could not assign enough checker codes due to concurrent purchases. Please try again.';
  END IF;

  UPDATE checker_purchases SET checker_inventory_id = (
    SELECT id FROM checker_inventory WHERE purchase_id = v_purchase_id ORDER BY imported_at ASC LIMIT 1
  ) WHERE id = v_purchase_id;

  RETURN json_build_object(
    'success', true, 'purchase_id', v_purchase_id, 'short_id', v_short_id,
    'product_name', v_product.name, 'amount', v_total_cost, 'quantity', p_quantity,
    'codes', array_to_json(v_codes)
  );
END;
$$;
