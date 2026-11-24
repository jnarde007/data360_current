
-- Customer-safe: returns privacy-safe referral list for the logged-in customer
CREATE OR REPLACE FUNCTION public.get_my_referrals()
RETURNS TABLE (
  id uuid,
  masked_name text,
  username text,
  signup_date timestamptz,
  status text,
  commission_earned numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_affiliate_code text;
  v_rate numeric;
BEGIN
  SELECT affiliate_code INTO v_affiliate_code
  FROM public.customers WHERE auth_user_id = auth.uid() LIMIT 1;
  
  IF v_affiliate_code IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(value, ''), '2')::numeric INTO v_rate
  FROM public.platform_settings WHERE key = 'affiliate_rate';
  IF v_rate IS NULL THEN v_rate := 2; END IF;

  RETURN QUERY
  SELECT
    c.id,
    -- Show first name + masked last initial for privacy
    CASE
      WHEN position(' ' in c.full_name) > 0 THEN
        split_part(c.full_name, ' ', 1) || ' ' || left(split_part(c.full_name, ' ', 2), 1) || '.'
      ELSE c.full_name
    END AS masked_name,
    COALESCE(c.username, '') AS username,
    c.created_at AS signup_date,
    c.status,
    ROUND(COALESCE((
      SELECT SUM(o.total_amount) * v_rate / 100
      FROM public.orders o
      WHERE o.customer_id = c.id AND o.status = 'delivered'
    ), 0), 2) AS commission_earned
  FROM public.customers c
  WHERE c.referred_by = v_affiliate_code
    AND c.status NOT IN ('deleted', 'archived')
    AND c.deleted_at IS NULL
  ORDER BY c.created_at DESC;
END;
$$;

-- Admin: returns full referral list for a given customer
CREATE OR REPLACE FUNCTION public.admin_get_customer_referrals(p_customer_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  username text,
  email text,
  signup_date timestamptz,
  status text,
  commission_earned numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_affiliate_code text;
  v_rate numeric;
BEGIN
  -- Verify caller is admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT affiliate_code INTO v_affiliate_code
  FROM public.customers WHERE id = p_customer_id LIMIT 1;

  IF v_affiliate_code IS NULL OR v_affiliate_code = '' THEN
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(value, ''), '2')::numeric INTO v_rate
  FROM public.platform_settings WHERE key = 'affiliate_rate';
  IF v_rate IS NULL THEN v_rate := 2; END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.full_name,
    COALESCE(c.username, '') AS username,
    c.email,
    c.created_at AS signup_date,
    c.status,
    ROUND(COALESCE((
      SELECT SUM(o.total_amount) * v_rate / 100
      FROM public.orders o
      WHERE o.customer_id = c.id AND o.status = 'delivered'
    ), 0), 2) AS commission_earned
  FROM public.customers c
  WHERE c.referred_by = v_affiliate_code
    AND c.status NOT IN ('deleted', 'archived')
    AND c.deleted_at IS NULL
  ORDER BY c.created_at DESC;
END;
$$;
