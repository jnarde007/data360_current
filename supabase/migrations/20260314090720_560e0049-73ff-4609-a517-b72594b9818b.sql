
-- Add username column to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS username text DEFAULT '';

-- Create unique index for non-empty usernames on active accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_username_unique 
ON public.customers (lower(username)) 
WHERE username IS NOT NULL AND username != '' AND status NOT IN ('deleted', 'archived') AND deleted_at IS NULL;

-- Security definer function to look up email by username (callable by anon/authenticated)
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT email FROM public.customers
  WHERE lower(username) = lower(p_username)
    AND status NOT IN ('deleted', 'archived')
    AND deleted_at IS NULL
  LIMIT 1
$$;

-- Update handle_new_user to store username from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  first_name TEXT;
  rand_part TEXT;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i INT;
  v_require_approval boolean;
  v_require_email_verify boolean;
  v_status text;
  v_email_verified boolean;
  v_referral_code text;
  v_is_admin boolean;
  v_username text;
BEGIN
  v_is_admin := COALESCE((NEW.raw_user_meta_data->>'is_admin')::boolean, false);
  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  first_name := UPPER(SUBSTRING(COALESCE(NEW.raw_user_meta_data->>'full_name', 'USER'), 1, 5));
  rand_part := '';
  FOR i IN 1..8 LOOP
    rand_part := rand_part || SUBSTRING(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;

  SELECT COALESCE(value, 'false') = 'true' INTO v_require_approval
    FROM public.platform_settings WHERE key = 'require_admin_approval';
  IF v_require_approval IS NULL THEN v_require_approval := false; END IF;

  SELECT COALESCE(value, 'false') = 'true' INTO v_require_email_verify
    FROM public.platform_settings WHERE key = 'require_email_verification';
  IF v_require_email_verify IS NULL THEN v_require_email_verify := false; END IF;

  v_status := CASE WHEN v_require_approval THEN 'pending' ELSE 'active' END;
  v_email_verified := NOT v_require_email_verify;
  v_referral_code := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'referral_code', '')), '');
  v_username := COALESCE(NEW.raw_user_meta_data->>'username', '');

  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  );
  INSERT INTO public.customers (id, full_name, email, phone, auth_user_id, affiliate_code, status, email_verified, referred_by, username)
  VALUES (
    gen_random_uuid(),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    NEW.id,
    first_name || '-' || rand_part,
    v_status,
    v_email_verified,
    v_referral_code,
    v_username
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$function$;
