
-- 1. SECURITY DEFINER function for syncing email_verified from auth state
CREATE OR REPLACE FUNCTION public.sync_email_verified()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmed_at timestamptz;
BEGIN
  -- Check if the auth user has confirmed their email
  SELECT email_confirmed_at INTO v_confirmed_at
  FROM auth.users WHERE id = auth.uid();

  IF v_confirmed_at IS NOT NULL THEN
    UPDATE public.customers
    SET email_verified = true
    WHERE auth_user_id = auth.uid() AND email_verified = false;
  END IF;
END;
$$;

-- 2. Update handle_new_user to accept referral_code from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
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

  -- Extract referral_code from metadata (may be null)
  v_referral_code := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'referral_code', '')), '');

  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  );
  INSERT INTO public.customers (id, full_name, email, phone, auth_user_id, affiliate_code, status, email_verified, referred_by)
  VALUES (
    gen_random_uuid(),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    NEW.id,
    first_name || '-' || rand_part,
    v_status,
    v_email_verified,
    v_referral_code
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;
