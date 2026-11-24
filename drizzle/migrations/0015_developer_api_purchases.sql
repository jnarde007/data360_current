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
BEGIN
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

  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data'
  LIMIT 1;
  IF actual_cost_price IS NULL THEN actual_cost_price := COALESCE(p_cost_price, 0); END IF;

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
  IF current_setting('data360.api_immediate', true) = 'on' THEN
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

CREATE TABLE public.developer_api_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  idempotency_key_hash text NOT NULL,
  request_fingerprint text NOT NULL,
  client_reference text,
  order_id uuid REFERENCES public.orders(id),
  short_id text,
  amount_charged numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key_hash)
);
GRANT ALL ON public.developer_api_purchases TO service_role;
GRANT SELECT ON public.developer_api_purchases TO authenticated;
ALTER TABLE public.developer_api_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view api purchases" ON public.developer_api_purchases
FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.place_developer_api_order(
  p_customer_id uuid, p_package_id uuid, p_recipient_phone text,
  p_idempotency_key_hash text, p_client_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text; v_fp text; v_claim public.developer_api_purchases%ROWTYPE;
  v_pi public.price_items%ROWTYPE; v_res json; v_order public.orders%ROWTYPE;
  v_ref text := NULLIF(btrim(COALESCE(p_client_reference,'')),'');
BEGIN
  IF p_idempotency_key_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST: idempotency'; END IF;
  IF NOT public._super_agent_active(p_customer_id) THEN RAISE EXCEPTION 'SA_REQUIRED'; END IF;

  v_phone := regexp_replace(COALESCE(p_recipient_phone,''), '[^0-9]', '', 'g');
  IF v_phone ~ '^233[0-9]{9}$' THEN v_phone := '0' || substr(v_phone, 4); END IF;
  IF v_phone !~ '^0[0-9]{9}$' THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;

  v_fp := encode(sha256(convert_to(p_package_id::text || '|' || v_phone || '|' || COALESCE(v_ref,''), 'UTF8')), 'hex');

  INSERT INTO public.developer_api_purchases (customer_id, idempotency_key_hash, request_fingerprint, client_reference)
  VALUES (p_customer_id, p_idempotency_key_hash, v_fp, v_ref)
  ON CONFLICT (customer_id, idempotency_key_hash) DO NOTHING
  RETURNING * INTO v_claim;

  IF v_claim.id IS NULL THEN
    SELECT * INTO v_claim FROM public.developer_api_purchases
     WHERE customer_id = p_customer_id AND idempotency_key_hash = p_idempotency_key_hash;
    IF v_claim.request_fingerprint <> v_fp THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = v_claim.order_id;
    RETURN jsonb_build_object('replay', true, 'order_id', v_claim.order_id, 'short_id', v_claim.short_id,
      'status', v_order.status, 'amount_charged', v_claim.amount_charged, 'client_reference', v_claim.client_reference);
  END IF;

  SELECT * INTO v_pi FROM public.price_items WHERE id = p_package_id AND product = 'Data';
  IF v_pi.id IS NULL THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;

  PERFORM set_config('data360.api_immediate', 'on', true);
  v_res := public.place_order(p_customer_id, v_pi.network, v_pi.size, v_phone, 1, v_pi.price, 0, 'manual', '');
  PERFORM set_config('data360.api_immediate', 'off', true);

  SELECT * INTO v_order FROM public.orders WHERE id = (v_res->>'order_id')::uuid;
  UPDATE public.developer_api_purchases
     SET order_id = v_order.id, short_id = v_order.short_id, amount_charged = v_order.total_amount
   WHERE id = v_claim.id;

  RETURN jsonb_build_object('replay', false, 'order_id', v_order.id, 'short_id', v_order.short_id,
    'status', v_order.status, 'amount_charged', v_order.total_amount, 'client_reference', v_ref);
END $$;
REVOKE ALL ON FUNCTION public.place_developer_api_order(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_developer_api_order(uuid, uuid, text, text, text) TO service_role;