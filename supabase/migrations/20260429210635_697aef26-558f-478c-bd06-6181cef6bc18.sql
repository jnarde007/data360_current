-- ============================================================
-- AFA Registrations table
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.afa_registrations_short_id_seq START 1001;

CREATE TABLE IF NOT EXISTS public.afa_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id text NOT NULL DEFAULT ('AFA-' || nextval('afa_registrations_short_id_seq'::regclass)::text),
  customer_id uuid,
  buyer_type text NOT NULL DEFAULT 'registered', -- 'registered' | 'guest'
  -- AFA application data
  full_name text NOT NULL,
  registration_phone text NOT NULL, -- the MTN line being registered
  location text NOT NULL,
  -- Buyer contact (for guests)
  buyer_phone text NOT NULL DEFAULT '',
  buyer_email text NOT NULL DEFAULT '',
  -- Status
  status text NOT NULL DEFAULT 'submitted', -- submitted|processing|registered|rejected
  admin_note text NOT NULL DEFAULT '',
  processed_by uuid,
  processed_at timestamptz,
  -- Payment
  total_amount numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'wallet', -- 'wallet' | 'paystack_direct'
  payment_reference text NOT NULL DEFAULT '',
  payment_verified_at timestamptz,
  -- Affiliate
  affiliate_code text NOT NULL DEFAULT '',
  -- Tracking
  tracking_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS afa_short_id_uniq ON public.afa_registrations(short_id);
CREATE UNIQUE INDEX IF NOT EXISTS afa_payment_ref_uniq ON public.afa_registrations(payment_reference) WHERE payment_reference <> '';
CREATE UNIQUE INDEX IF NOT EXISTS afa_tracking_token_uniq ON public.afa_registrations(tracking_token) WHERE tracking_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS afa_customer_idx ON public.afa_registrations(customer_id);
CREATE INDEX IF NOT EXISTS afa_status_idx ON public.afa_registrations(status);
CREATE INDEX IF NOT EXISTS afa_created_idx ON public.afa_registrations(created_at DESC);

ALTER TABLE public.afa_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read own afa or admin"
  ON public.afa_registrations FOR SELECT TO authenticated
  USING ((customer_id = public.get_my_customer_id()) OR public.is_admin());

CREATE POLICY "Customers insert own afa"
  ON public.afa_registrations FOR INSERT TO authenticated
  WITH CHECK ((customer_id = public.get_my_customer_id()) OR public.is_admin());

CREATE POLICY "Admins update afa"
  ON public.afa_registrations FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete afa"
  ON public.afa_registrations FOR DELETE TO authenticated
  USING (public.is_admin());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.afa_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_afa_updated_at ON public.afa_registrations;
CREATE TRIGGER trg_afa_updated_at BEFORE UPDATE ON public.afa_registrations
  FOR EACH ROW EXECUTE FUNCTION public.afa_set_updated_at();

-- ============================================================
-- Seed AFA Registration price item (default GHS 15)
-- ============================================================
INSERT INTO public.price_items (network, product, size, price, cost_price)
SELECT 'MTN', 'AFA Registration', 'Standard', 15, 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.price_items
  WHERE product = 'AFA Registration' AND network = 'MTN' AND size = 'Standard'
);

-- ============================================================
-- RPC: place_afa_wallet (registered users — wallet payment)
-- ============================================================
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
  WHERE product = 'AFA Registration' AND network = 'MTN' AND size = 'Standard' LIMIT 1;
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

-- ============================================================
-- RPC: place_afa_paystack (registered users — paystack direct)
-- ============================================================
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

  -- Idempotency
  IF p_payment_reference <> '' THEN
    SELECT id, short_id INTO v_existing FROM public.afa_registrations
    WHERE payment_reference = p_payment_reference LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'already_processed', true,
        'id', v_existing.id, 'short_id', v_existing.short_id);
    END IF;
  END IF;

  SELECT price INTO v_price FROM public.price_items
  WHERE product = 'AFA Registration' AND network = 'MTN' AND size = 'Standard' LIMIT 1;
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

-- ============================================================
-- RPC: place_afa_guest_paystack (guest — paystack direct)
-- ============================================================
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
  WHERE product = 'AFA Registration' AND network = 'MTN' AND size = 'Standard' LIMIT 1;
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

-- ============================================================
-- RPC: purchase_checker_guest_paystack (guest result checker)
-- ============================================================
CREATE OR REPLACE FUNCTION public.purchase_checker_guest_paystack(
  p_product_id uuid,
  p_payment_reference text,
  p_quantity integer,
  p_buyer_phone text,
  p_buyer_email text,
  p_affiliate_code text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product RECORD;
  v_total_cost numeric;
  v_purchase_id uuid;
  v_short_id text;
  v_token text;
  v_checker RECORD;
  v_codes json[];
  v_norm_buyer text;
  v_existing RECORD;
  v_assigned int;
BEGIN
  IF p_quantity < 1 OR p_quantity > 50 THEN
    RETURN json_build_object('success', false, 'error', 'Quantity must be between 1 and 50');
  END IF;

  v_norm_buyer := regexp_replace(p_buyer_phone, '[^0-9]', '', 'g');

  IF p_payment_reference <> '' THEN
    SELECT id, short_id INTO v_existing
    FROM checker_purchases WHERE payment_reference = p_payment_reference LIMIT 1;
    IF FOUND THEN
      SELECT array_agg(json_build_object('serial_number', ci.serial_number, 'pin', ci.pin)::json)
      INTO v_codes FROM checker_inventory ci WHERE ci.purchase_id = v_existing.id;

      RETURN json_build_object('success', true, 'already_processed', true,
        'purchase_id', v_existing.id, 'short_id', v_existing.short_id,
        'codes', COALESCE(array_to_json(v_codes), '[]'::json));
    END IF;
  END IF;

  SELECT * INTO v_product FROM checker_products WHERE id = p_product_id AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  v_total_cost := v_product.price * p_quantity;

  SELECT count(*) INTO v_assigned FROM checker_inventory
    WHERE product_id = p_product_id AND status = 'available';
  IF v_assigned < p_quantity THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient stock. Only ' || v_assigned || ' available');
  END IF;

  v_token := left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 48);

  -- Guest purchase: customer_id null is not allowed by current schema (NOT NULL).
  -- We'll use a sentinel pattern: store in checker_purchases with sms_phone as buyer phone
  -- and rely on payment_reference + tracking_token (added below) for lookup.
  -- Add tracking_token column if missing.
  -- (handled by ALTER TABLE below; safe re-run)

  INSERT INTO checker_purchases
    (customer_id, product_id, amount, sms_phone, status, quantity, payment_method,
     payment_reference, payment_verified_at)
  VALUES
    (NULL, p_product_id, v_total_cost, v_norm_buyer, 'completed', p_quantity, 'paystack_direct',
     p_payment_reference, now())
  RETURNING id, short_id INTO v_purchase_id, v_short_id;

  -- Set guest tracking metadata
  UPDATE checker_purchases SET
    buyer_type = 'guest',
    buyer_phone = v_norm_buyer,
    buyer_email = p_buyer_email,
    affiliate_code = COALESCE(p_affiliate_code, ''),
    tracking_token = v_token
  WHERE id = v_purchase_id;

  v_codes := ARRAY[]::json[];
  FOR v_checker IN
    SELECT * FROM checker_inventory
      WHERE product_id = p_product_id AND status = 'available'
      ORDER BY imported_at ASC LIMIT p_quantity
      FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE checker_inventory
      SET status = 'sold', sold_at = now(), purchase_id = v_purchase_id
      WHERE id = v_checker.id;
    v_codes := v_codes || json_build_object('serial_number', v_checker.serial_number, 'pin', v_checker.pin)::json;
  END LOOP;

  IF array_length(v_codes, 1) IS NULL OR array_length(v_codes, 1) < p_quantity THEN
    RAISE EXCEPTION 'Could not assign enough checker codes due to concurrent purchases';
  END IF;

  UPDATE checker_purchases SET checker_inventory_id = (
    SELECT id FROM checker_inventory WHERE purchase_id = v_purchase_id ORDER BY imported_at ASC LIMIT 1
  ) WHERE id = v_purchase_id;

  RETURN json_build_object('success', true, 'purchase_id', v_purchase_id,
    'short_id', v_short_id, 'product_name', v_product.name, 'amount', v_total_cost,
    'quantity', p_quantity, 'tracking_token', v_token,
    'codes', array_to_json(v_codes));
END;
$$;

-- ============================================================
-- Extend checker_purchases for guest support
-- ============================================================
ALTER TABLE public.checker_purchases
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.checker_purchases
  ADD COLUMN IF NOT EXISTS buyer_type text NOT NULL DEFAULT 'registered',
  ADD COLUMN IF NOT EXISTS buyer_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS affiliate_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tracking_token text;

CREATE UNIQUE INDEX IF NOT EXISTS checker_tracking_token_uniq
  ON public.checker_purchases(tracking_token) WHERE tracking_token IS NOT NULL;

-- Allow admins to read checker_purchases regardless of customer_id (already covered)
-- but RLS for guest insert isn't via authenticated role; the RPC is SECURITY DEFINER so it bypasses RLS.