
-- 1. Fix customers UPDATE: restrict to safe fields only via a column-check policy
-- Drop the current broad update policy
DROP POLICY IF EXISTS "Authenticated update own or admin" ON public.customers;

-- Admin can update anything
CREATE POLICY "Admins update customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Customers can update only their own record, but financial fields cannot change
-- We enforce this with a trigger that prevents customers from changing sensitive fields
CREATE OR REPLACE FUNCTION public.protect_customer_financial_fields()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  -- If the updater is an admin, allow all changes
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- For non-admin users, prevent changes to financial/sensitive fields
  IF NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
    RAISE EXCEPTION 'You cannot modify your wallet balance';
  END IF;
  IF NEW.available_commission IS DISTINCT FROM OLD.available_commission THEN
    RAISE EXCEPTION 'You cannot modify your commission';
  END IF;
  IF NEW.total_commission IS DISTINCT FROM OLD.total_commission THEN
    RAISE EXCEPTION 'You cannot modify your commission';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'You cannot modify your account status';
  END IF;
  IF NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
    RAISE EXCEPTION 'You cannot modify your email verification status';
  END IF;
  IF NEW.affiliate_code IS DISTINCT FROM OLD.affiliate_code THEN
    RAISE EXCEPTION 'You cannot modify your affiliate code';
  END IF;
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'You cannot modify your referral';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_customer_financial_fields
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_customer_financial_fields();

-- Customers can update their own record (trigger enforces field restrictions)
CREATE POLICY "Customers update own safe fields"
  ON public.customers FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- 2. Fix OTP codes: remove SELECT policy so users cannot read their own OTP codes
DROP POLICY IF EXISTS "Users read own OTPs" ON public.otp_codes;
