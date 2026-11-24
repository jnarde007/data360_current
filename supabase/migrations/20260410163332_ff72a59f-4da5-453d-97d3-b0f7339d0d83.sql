
-- Phase 1: Guest Purchase Schema Additions
-- All changes are additive — no existing columns or constraints are modified.

-- ============================================================
-- 1. Orders table — add guest-aware columns
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS buyer_type text NOT NULL DEFAULT 'registered',
  ADD COLUMN IF NOT EXISTS buyer_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tracking_token text,
  ADD COLUMN IF NOT EXISTS linked_customer_id uuid,
  ADD COLUMN IF NOT EXISTS affiliate_code text NOT NULL DEFAULT '';

-- Unique index on tracking_token (only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_token
  ON public.orders (tracking_token) WHERE tracking_token IS NOT NULL;

-- Index for admin search by buyer phone
CREATE INDEX IF NOT EXISTS idx_orders_buyer_phone
  ON public.orders (buyer_phone) WHERE buyer_phone <> '';

-- Index for filtering by buyer type
CREATE INDEX IF NOT EXISTS idx_orders_buyer_type
  ON public.orders (buyer_type);

-- ============================================================
-- 2. Payment attempts table — add guest-aware columns
-- ============================================================
ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS buyer_type text NOT NULL DEFAULT 'registered',
  ADD COLUMN IF NOT EXISTS buyer_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS affiliate_code text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_payment_attempts_buyer_type
  ON public.payment_attempts (buyer_type);

-- ============================================================
-- 3. Guest order placement function
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_order_guest_paystack(
  p_network text,
  p_bundle_size text,
  p_recipient_phone text,
  p_quantity integer,
  p_total_amount numeric,
  p_payment_reference text,
  p_buyer_phone text,
  p_buyer_email text DEFAULT '',
  p_affiliate_code text DEFAULT '',
  p_cost_price numeric DEFAULT 0,
  p_delivery_mode text DEFAULT 'manual',
  p_provider_name text DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_order_id uuid;
  new_short_id text;
  normalized_recipient text;
  normalized_buyer text;
  grace_end timestamptz;
  actual_cost_price numeric;
  v_tracking_token text;
BEGIN
  -- Normalize phones
  normalized_recipient := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');
  normalized_buyer := regexp_replace(p_buyer_phone, '[^0-9]', '', 'g');

  -- Server-side cost price lookup
  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data'
  LIMIT 1;

  IF actual_cost_price IS NULL THEN
    actual_cost_price := COALESCE(p_cost_price, 0);
  END IF;

  -- Idempotency: check existing order with this payment reference
  IF p_payment_reference <> '' THEN
    DECLARE
      v_existing RECORD;
    BEGIN
      SELECT id, short_id, grace_period_ends_at, tracking_token INTO v_existing
      FROM orders WHERE payment_reference = p_payment_reference LIMIT 1;
      IF FOUND THEN
        RETURN json_build_object(
          'order_id', v_existing.id,
          'short_id', v_existing.short_id,
          'grace_period_ends_at', v_existing.grace_period_ends_at,
          'tracking_token', v_existing.tracking_token,
          'already_processed', true
        );
      END IF;
    END;
  END IF;

  grace_end := now() + interval '3 minutes';

  -- Generate a secure tracking token: 32-char hex from gen_random_uuid
  v_tracking_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- Take first 48 chars for a strong token
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
    'order_id', new_order_id,
    'short_id', new_short_id,
    'grace_period_ends_at', grace_end,
    'tracking_token', v_tracking_token
  );
END;
$$;

-- ============================================================
-- 4. Guest affiliate commission trigger
--    Credits affiliate when a guest order is delivered
-- ============================================================
CREATE OR REPLACE FUNCTION public.credit_guest_affiliate_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_referrer_id uuid;
  v_rate numeric;
  v_commission numeric;
BEGIN
  -- Only fire on status change TO 'delivered'
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Only for guest orders with an affiliate code
  IF NEW.buyer_type <> 'guest' OR NEW.affiliate_code IS NULL OR NEW.affiliate_code = '' THEN
    RETURN NEW;
  END IF;

  -- The existing credit_affiliate_commission trigger handles registered users
  -- via referred_by on the customer. This trigger handles guest orders via
  -- affiliate_code stored directly on the order.

  -- Find the referrer by affiliate_code
  SELECT id INTO v_referrer_id
  FROM public.customers
  WHERE affiliate_code = NEW.affiliate_code
    AND status NOT IN ('deleted', 'archived')
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get affiliate rate
  SELECT COALESCE(NULLIF(value, ''), '2')::numeric INTO v_rate
  FROM public.platform_settings
  WHERE key = 'affiliate_rate';
  IF v_rate IS NULL THEN v_rate := 2; END IF;

  v_commission := ROUND((NEW.total_amount * v_rate / 100), 2);
  IF v_commission <= 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.customers
  SET total_commission = total_commission + v_commission,
      available_commission = available_commission + v_commission
  WHERE id = v_referrer_id;

  RETURN NEW;
END;
$$;

-- Attach the guest commission trigger (fires after the existing one)
DROP TRIGGER IF EXISTS trg_credit_guest_affiliate_commission ON public.orders;
CREATE TRIGGER trg_credit_guest_affiliate_commission
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_guest_affiliate_commission();
