CREATE OR REPLACE FUNCTION public.protect_customer_financial_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow changes from SECURITY DEFINER functions (postgres) or service_role (edge functions)
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

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
$function$