CREATE OR REPLACE FUNCTION public.validate_customer_signup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.email IS NULL OR trim(NEW.email) = '' THEN
    RAISE EXCEPTION 'Email is required for signup';
  END IF;
  IF NEW.email !~ '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  IF NEW.phone IS NULL OR trim(NEW.phone) = '' THEN
    RAISE EXCEPTION 'Phone number is required for signup';
  END IF;
  IF NEW.phone !~ '^(0[235]\d{8}|(\+?233)[235]\d{8})$' THEN
    RAISE EXCEPTION 'A valid Ghana phone number is required';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_customer_signup
BEFORE INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.validate_customer_signup();