
-- 1) Extend store_orders to support AFA
ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS afa_registration_id uuid REFERENCES public.afa_registrations(id);

CREATE INDEX IF NOT EXISTS idx_store_orders_afa ON public.store_orders(afa_registration_id);

ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_kind_check;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_kind_check CHECK (
  (kind = 'data'    AND price_item_id       IS NOT NULL) OR
  (kind = 'checker' AND checker_product_id  IS NOT NULL) OR
  (kind = 'afa'     AND afa_registration_id IS NOT NULL)
);

-- 2) Allow validate_store_order trigger to accept kind='afa' implicitly (status set is unchanged)
--    Existing trigger only checks status values and immutability — no change required.

-- 3) New RPC: place_store_afa_paystack
CREATE OR REPLACE FUNCTION public.place_store_afa_paystack(
  p_store_slug text,
  p_payment_reference text,
  p_full_name text,
  p_registration_phone text,
  p_location text,
  p_buyer_phone text,
  p_buyer_email text DEFAULT '',
  p_affiliate_code text DEFAULT ''
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_base_price numeric;
  v_selling numeric;
  v_profit numeric;
  v_norm_phone text;
  v_norm_buyer text;
  v_token text;
  v_afa_id uuid;
  v_short_id text;
  v_store_order_id uuid;
  v_existing RECORD;
BEGIN
  SELECT id, owner_id, status, afa_enabled, afa_price
    INTO v_store
  FROM public.stores WHERE slug = lower(trim(p_store_slug));
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_store.status <> 'active' THEN RAISE EXCEPTION 'Store is not active'; END IF;
  IF NOT COALESCE(v_store.afa_enabled, false) THEN RAISE EXCEPTION 'AFA registration not enabled for this store'; END IF;

  v_selling := COALESCE(v_store.afa_price, 0);
  IF v_selling <= 0 THEN RAISE EXCEPTION 'Store AFA price not configured'; END IF;

  SELECT price INTO v_base_price FROM public.price_items
    WHERE product = 'AFA Registration' AND network = 'MTN'
    ORDER BY updated_at DESC LIMIT 1;
  IF v_base_price IS NULL THEN v_base_price := v_selling; END IF;

  v_profit := GREATEST(v_selling - v_base_price, 0);

  -- Idempotency
  SELECT id, short_id, tracking_token
    INTO v_existing
  FROM public.afa_registrations
  WHERE payment_reference = p_payment_reference LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'already_processed', true,
      'id', v_existing.id, 'short_id', v_existing.short_id, 'tracking_token', v_existing.tracking_token);
  END IF;

  v_norm_phone := regexp_replace(p_registration_phone, '[^0-9]', '', 'g');
  v_norm_buyer := regexp_replace(p_buyer_phone, '[^0-9]', '', 'g');
  v_token := left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 48);

  INSERT INTO public.afa_registrations
    (customer_id, buyer_type, full_name, registration_phone, location, status,
     buyer_phone, buyer_email, total_amount, payment_method, payment_reference,
     payment_verified_at, affiliate_code, tracking_token)
  VALUES
    (NULL, 'guest', trim(p_full_name), v_norm_phone, trim(p_location), 'submitted',
     v_norm_buyer, COALESCE(p_buyer_email,''), v_selling, 'paystack_direct', p_payment_reference,
     now(), COALESCE(p_affiliate_code,''), v_token)
  RETURNING id, short_id INTO v_afa_id, v_short_id;

  INSERT INTO public.store_orders(store_id, store_owner_id, kind, afa_registration_id,
                                  buyer_phone, amount_paid, profit, status)
  VALUES (v_store.id, v_store.owner_id, 'afa', v_afa_id,
          v_norm_buyer, v_selling, v_profit, 'pending')
  RETURNING id INTO v_store_order_id;

  -- AFA can be rejected/refunded, so credit pending_balance only
  INSERT INTO public.store_wallets(owner_id, pending_balance)
  VALUES (v_store.owner_id, v_profit)
  ON CONFLICT (owner_id) DO UPDATE
    SET pending_balance = public.store_wallets.pending_balance + EXCLUDED.pending_balance,
        updated_at = now();

  RETURN json_build_object(
    'success', true,
    'id', v_afa_id,
    'short_id', v_short_id,
    'tracking_token', v_token,
    'store_order_id', v_store_order_id,
    'amount', v_selling
  );
END $$;

GRANT EXECUTE ON FUNCTION public.place_store_afa_paystack(text,text,text,text,text,text,text,text) TO authenticated, anon, service_role;
