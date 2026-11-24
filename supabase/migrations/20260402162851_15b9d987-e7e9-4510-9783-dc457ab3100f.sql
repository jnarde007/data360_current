
-- Add quantity column to checker_purchases
ALTER TABLE public.checker_purchases ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- Add purchase_id to checker_inventory for clean bulk linking
ALTER TABLE public.checker_inventory ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.checker_purchases(id);

-- Replace purchase_checker function to support bulk quantity
CREATE OR REPLACE FUNCTION public.purchase_checker(
  p_customer_id uuid,
  p_product_id uuid,
  p_sms_phone text DEFAULT '',
  p_quantity integer DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_balance NUMERIC;
  v_total_cost NUMERIC;
  v_purchase_id UUID;
  v_short_id TEXT;
  v_assigned_count INTEGER := 0;
  v_checker RECORD;
  v_codes JSON[];
BEGIN
  -- Validate quantity
  IF p_quantity < 1 OR p_quantity > 50 THEN
    RETURN json_build_object('success', false, 'error', 'Quantity must be between 1 and 50');
  END IF;

  -- Lock and get product
  SELECT * INTO v_product FROM checker_products WHERE id = p_product_id AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  v_total_cost := v_product.price * p_quantity;

  -- Check balance
  SELECT wallet_balance INTO v_balance FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Customer not found');
  END IF;
  IF v_balance < v_total_cost THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient wallet balance. You need ' || v_total_cost || ' but have ' || v_balance);
  END IF;

  -- Check available stock count before locking
  SELECT count(*) INTO v_assigned_count FROM checker_inventory
    WHERE product_id = p_product_id AND status = 'available';
  IF v_assigned_count < p_quantity THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient stock. Only ' || v_assigned_count || ' available, but ' || p_quantity || ' requested');
  END IF;

  -- Deduct wallet
  UPDATE customers SET wallet_balance = wallet_balance - v_total_cost WHERE id = p_customer_id;

  -- Create purchase record first (with quantity)
  INSERT INTO checker_purchases (customer_id, product_id, amount, sms_phone, status, quantity)
    VALUES (p_customer_id, p_product_id, v_total_cost, p_sms_phone, 'completed', p_quantity)
    RETURNING id, short_id INTO v_purchase_id, v_short_id;

  -- Lock and assign checkers one by one
  v_codes := ARRAY[]::json[];
  FOR v_checker IN
    SELECT * FROM checker_inventory
      WHERE product_id = p_product_id AND status = 'available'
      ORDER BY imported_at ASC
      LIMIT p_quantity
      FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE checker_inventory
      SET status = 'sold', sold_at = now(), assigned_to = p_customer_id, purchase_id = v_purchase_id
      WHERE id = v_checker.id;
    v_codes := v_codes || json_build_object('serial_number', v_checker.serial_number, 'pin', v_checker.pin)::json;
    v_assigned_count := v_assigned_count + 1;
  END LOOP;

  -- Safety: if we couldn't lock enough (concurrent contention), rollback
  IF array_length(v_codes, 1) IS NULL OR array_length(v_codes, 1) < p_quantity THEN
    RAISE EXCEPTION 'Could not assign enough checker codes due to concurrent purchases. Please try again.';
  END IF;

  -- Update purchase with first checker_inventory_id for backward compat
  UPDATE checker_purchases SET checker_inventory_id = (
    SELECT id FROM checker_inventory WHERE purchase_id = v_purchase_id ORDER BY imported_at ASC LIMIT 1
  ) WHERE id = v_purchase_id;

  -- Create wallet transaction
  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
    VALUES (p_customer_id, 'debit', v_total_cost,
            'Results Checker: ' || v_product.name || ' x' || p_quantity,
            v_short_id);

  RETURN json_build_object(
    'success', true,
    'purchase_id', v_purchase_id,
    'short_id', v_short_id,
    'product_name', v_product.name,
    'amount', v_total_cost,
    'quantity', p_quantity,
    'codes', array_to_json(v_codes)
  );
END;
$function$;
