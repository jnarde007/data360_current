
-- Automatic affiliate commission on order delivery
-- Credits the referrer's commission when a referred customer's order is delivered
CREATE OR REPLACE FUNCTION public.credit_affiliate_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer_id uuid;
  v_referred_by text;
  v_referrer_id uuid;
  v_rate numeric;
  v_commission numeric;
BEGIN
  -- Only trigger on status change TO 'delivered'
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  -- Get customer and their referrer
  v_customer_id := NEW.customer_id;
  IF v_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT referred_by INTO v_referred_by
  FROM public.customers
  WHERE id = v_customer_id;

  IF v_referred_by IS NULL OR v_referred_by = '' THEN
    RETURN NEW;
  END IF;

  -- Find the referrer by affiliate_code
  SELECT id INTO v_referrer_id
  FROM public.customers
  WHERE affiliate_code = v_referred_by
    AND status NOT IN ('deleted', 'archived')
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get affiliate rate from platform_settings (default 2%)
  SELECT COALESCE(NULLIF(value, ''), '2')::numeric INTO v_rate
  FROM public.platform_settings
  WHERE key = 'affiliate_rate';

  IF v_rate IS NULL THEN
    v_rate := 2;
  END IF;

  -- Calculate commission as percentage of order total_amount
  v_commission := ROUND((NEW.total_amount * v_rate / 100), 2);

  IF v_commission <= 0 THEN
    RETURN NEW;
  END IF;

  -- Credit the referrer
  UPDATE public.customers
  SET total_commission = total_commission + v_commission,
      available_commission = available_commission + v_commission
  WHERE id = v_referrer_id;

  RETURN NEW;
END;
$$;

-- Create trigger on orders table
DROP TRIGGER IF EXISTS trg_credit_affiliate_commission ON public.orders;
CREATE TRIGGER trg_credit_affiliate_commission
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_affiliate_commission();
