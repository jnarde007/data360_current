
CREATE TABLE IF NOT EXISTS public.cross_network_bypass_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  customer_email text NOT NULL,
  selected_network text NOT NULL,
  detected_network text,
  recipient_phone text NOT NULL,
  order_id uuid,
  order_short_id text,
  flow text NOT NULL,
  reason text NOT NULL DEFAULT 'AUTHORIZED_CROSS_NETWORK_EXCEPTION',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cross_network_bypass_audit TO authenticated;
GRANT ALL ON public.cross_network_bypass_audit TO service_role;

ALTER TABLE public.cross_network_bypass_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view cross-network bypass audit"
  ON public.cross_network_bypass_audit;
CREATE POLICY "Admins can view cross-network bypass audit"
  ON public.cross_network_bypass_audit
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_cn_bypass_audit_customer
  ON public.cross_network_bypass_audit(customer_id);
CREATE INDEX IF NOT EXISTS idx_cn_bypass_audit_created
  ON public.cross_network_bypass_audit(created_at DESC);

CREATE OR REPLACE FUNCTION public.is_cross_network_bypass_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id
      AND lower(email) = 'mskirt7@gmail.com'
  );
$$;

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
  v_bypass boolean;
  v_customer_email text;
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

  SELECT lower(email) INTO v_customer_email
  FROM public.customers WHERE id = p_customer_id;
  v_bypass := (v_customer_email = 'mskirt7@gmail.com');

  IF v_detected <> p_network AND NOT v_bypass THEN
    RAISE EXCEPTION 'NETWORK_MISMATCH: % belongs to % but you selected %. Mixed-network batches are not allowed.', p_recipient_phone, v_detected, p_network;
  END IF;

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

  IF v_bypass AND v_detected <> p_network THEN
    INSERT INTO public.cross_network_bypass_audit
      (customer_id, customer_email, selected_network, detected_network,
       recipient_phone, order_id, order_short_id, flow, reason)
    VALUES
      (p_customer_id, v_customer_email, p_network, v_detected,
       normalized_phone, new_order_id, new_short_id, 'wallet',
       'AUTHORIZED_CROSS_NETWORK_EXCEPTION');
  END IF;

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', grace_end);
END;
$function$;
