CREATE OR REPLACE FUNCTION public.place_order(p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text, p_quantity integer, p_total_amount numeric, p_cost_price numeric DEFAULT 0, p_delivery_mode text DEFAULT 'manual'::text, p_provider_name text DEFAULT ''::text)
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
  v_bypass boolean := false;
  v_email text;
  v_sa_price numeric;
  v_caller_role text := auth.role();
  v_caller_uid uuid := auth.uid();
  v_catalog_price numeric;
  v_expected_total numeric;
BEGIN
  -- [BLOCK 1] caller authorization
  IF v_caller_role = 'anon' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required' USING ERRCODE = '42501';
  ELSIF v_caller_role = 'authenticated' THEN
    IF v_caller_uid IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.customers
      WHERE id = p_customer_id AND auth_user_id = v_caller_uid AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'UNAUTHORIZED: Customer account does not belong to the authenticated user' USING ERRCODE = '42501';
    END IF;
  ELSIF v_caller_role IS NOT NULL AND v_caller_role <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Invalid caller role' USING ERRCODE = '42501';
  END IF;

  SELECT available_for_purchase INTO v_available
  FROM public.network_api_configs WHERE network = p_network LIMIT 1;
  IF NOT COALESCE(v_available, false) THEN
    RAISE EXCEPTION 'NETWORK_UNAVAILABLE: % is currently unavailable for purchase. Delivery is halted due to network issues.', p_network;
  END IF;

  normalized_phone := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');

  v_bypass := public.is_cross_network_authorized(p_customer_id);

  v_detected := public.detect_ghana_network(normalized_phone);
  IF v_detected IS NULL AND NOT v_bypass THEN
    RAISE EXCEPTION 'NETWORK_MISMATCH: % is not a valid Ghana mobile number.', p_recipient_phone;
  END IF;
  IF v_detected IS NOT NULL AND v_detected <> p_network THEN
    IF NOT v_bypass THEN
      RAISE EXCEPTION 'NETWORK_MISMATCH: % belongs to % but you selected %. Mixed-network batches are not allowed.', p_recipient_phone, v_detected, p_network;
    END IF;
  END IF;

  -- Duplicate-recipient guard
  IF public._has_active_order_for_recipient(p_network, normalized_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PENDING: % already has an active order in the system. Please wait for delivery before ordering again.', normalized_phone;
  END IF;

  -- [BLOCK 2] package must exist
  SELECT pi.cost_price, pi.price INTO actual_cost_price, v_catalog_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data'
  LIMIT 1;
  IF v_catalog_price IS NULL THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND: % % is not available.', p_network, p_bundle_size;
  END IF;
  IF actual_cost_price IS NULL THEN actual_cost_price := COALESCE(p_cost_price, 0); END IF;

  -- [BLOCK 3] browser callers: server price only
  IF v_caller_role = 'authenticated' THEN
    IF public._super_agent_active(p_customer_id) THEN
      SELECT public._super_agent_price(pi.id) INTO v_sa_price
      FROM public.price_items pi
      WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data' LIMIT 1;
    END IF;
    v_expected_total := round(COALESCE(v_sa_price, v_catalog_price) * GREATEST(COALESCE(p_quantity, 1), 1), 2);
    IF p_total_amount IS NULL OR abs(p_total_amount - v_expected_total) > 0.01 THEN
      RAISE EXCEPTION 'PRICE_MISMATCH: expected GH₵% for % %', v_expected_total, p_network, p_bundle_size;
    END IF;
    p_total_amount := v_expected_total;
  END IF;

  -- Super Agent pricing: server-authoritative price for active Super Agents only.
  IF public._super_agent_active(p_customer_id) THEN
    SELECT public._super_agent_price(pi.id) INTO v_sa_price
    FROM public.price_items pi
    WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data' LIMIT 1;
    IF v_sa_price IS NOT NULL THEN
      p_total_amount := v_sa_price * GREATEST(COALESCE(p_quantity, 1), 1);
    END IF;
  END IF;

  SELECT wallet_balance, email INTO current_balance, v_email FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF current_balance IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF current_balance < p_total_amount THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;

  UPDATE customers SET wallet_balance = wallet_balance - p_total_amount WHERE id = p_customer_id;

  -- Developer API immediate path: honoured ONLY when set transaction-locally by the
  -- service-role-only place_developer_api_order wrapper. Website callers cannot set it.
  -- [BLOCK 4] immediate only for verified service_role + wrapper flag
  IF v_caller_role = 'service_role' AND current_setting('data360.api_immediate', true) = 'on' THEN
    grace_end := now();
  ELSE
    grace_end := now() + interval '3 minutes';
  END IF;

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, delivery_mode, provider_name, status, grace_period_ends_at, detected_network)
  VALUES (p_customer_id, p_network, p_bundle_size, normalized_phone, p_quantity, p_total_amount, actual_cost_price, p_delivery_mode, p_provider_name, 'pending_confirmation', grace_end, v_detected)
  RETURNING id, short_id INTO new_order_id, new_short_id;

  IF v_bypass AND v_detected IS DISTINCT FROM p_network THEN
    INSERT INTO public.cross_network_bypass_audit (
      customer_id, customer_email, email, selected_network, detected_network,
      recipient_phone, order_id, order_short_id, flow, reason
    ) VALUES (
      p_customer_id, v_email, v_email, p_network, v_detected,
      normalized_phone, new_order_id, new_short_id, 'customer_wallet',
      'AUTHORIZED_CROSS_NETWORK_EXCEPTION'
    );
  END IF;

  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', p_total_amount, 'Data purchase - ' || p_bundle_size || ' ' || p_network, new_short_id);

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', grace_end);
END;
$function$;
REVOKE ALL ON FUNCTION public.place_order(uuid,text,text,text,integer,numeric,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid,text,text,text,integer,numeric,numeric,text,text) TO authenticated, service_role;