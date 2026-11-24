CREATE OR REPLACE FUNCTION public.validate_customer_signup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.email IS NULL OR trim(NEW.email) = '' THEN
    RAISE EXCEPTION 'Email is required for signup';
  END IF;
  IF NEW.email !~ '^[^@ ]+@[^@ ]+\.[^@ ]{2,}$' THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  IF NEW.phone IS NULL OR trim(NEW.phone) = '' THEN
    RAISE EXCEPTION 'Phone number is required for signup';
  END IF;
  IF NEW.phone !~ '^(0[235][0-9]{8}|(\+?233)[235][0-9]{8})$' THEN
    RAISE EXCEPTION 'A valid Ghana phone number is required';
  END IF;
  RETURN NEW;
END;
$function$;