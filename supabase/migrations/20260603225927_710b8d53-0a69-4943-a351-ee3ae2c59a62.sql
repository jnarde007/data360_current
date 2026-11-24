CREATE OR REPLACE FUNCTION public.guard_customer_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow SECURITY DEFINER functions (run as table owner / postgres) and edge functions (service_role) to bypass
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Allow admins
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Block changes to any sensitive column from a direct authenticated update
  IF NEW.wallet_balance       IS DISTINCT FROM OLD.wallet_balance       OR
     NEW.available_commission IS DISTINCT FROM OLD.available_commission OR
     NEW.total_commission     IS DISTINCT FROM OLD.total_commission     OR
     NEW.affiliate_code       IS DISTINCT FROM OLD.affiliate_code       OR
     NEW.transaction_pin_hash IS DISTINCT FROM OLD.transaction_pin_hash OR
     NEW.referred_by          IS DISTINCT FROM OLD.referred_by          OR
     NEW.status               IS DISTINCT FROM OLD.status               OR
     NEW.deleted_at           IS DISTINCT FROM OLD.deleted_at           OR
     NEW.email_verified       IS DISTINCT FROM OLD.email_verified       OR
     NEW.auth_user_id         IS DISTINCT FROM OLD.auth_user_id         OR
     NEW.email                IS DISTINCT FROM OLD.email
  THEN
    RAISE EXCEPTION 'Direct update to protected customer fields is not allowed. Use the dedicated server function instead.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;