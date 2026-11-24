
-- Update handle_new_user to create customers with 'pending' status
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  first_name TEXT;
  rand_part TEXT;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i INT;
BEGIN
  first_name := UPPER(SUBSTRING(COALESCE(NEW.raw_user_meta_data->>'full_name', 'USER'), 1, 5));
  rand_part := '';
  FOR i IN 1..8 LOOP
    rand_part := rand_part || SUBSTRING(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;

  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  );
  INSERT INTO public.customers (id, full_name, email, phone, auth_user_id, affiliate_code, status)
  VALUES (
    gen_random_uuid(),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    NEW.id,
    first_name || '-' || rand_part,
    'pending'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;
