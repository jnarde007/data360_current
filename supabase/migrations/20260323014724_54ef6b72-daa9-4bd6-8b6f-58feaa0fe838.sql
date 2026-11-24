
CREATE OR REPLACE FUNCTION public.admin_get_referral_leaderboard()
RETURNS TABLE(
  id uuid,
  full_name text,
  username text,
  email text,
  affiliate_code text,
  status text,
  signup_date timestamptz,
  total_referrals bigint,
  active_referrals bigint,
  total_commission numeric,
  referral_revenue numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rate numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(NULLIF(value, ''), '2')::numeric INTO v_rate
  FROM public.platform_settings WHERE key = 'affiliate_rate';
  IF v_rate IS NULL THEN v_rate := 2; END IF;

  RETURN QUERY
  SELECT
    referrer.id,
    referrer.full_name,
    COALESCE(referrer.username, '') AS username,
    referrer.email,
    referrer.affiliate_code,
    referrer.status,
    referrer.created_at AS signup_date,
    COUNT(ref.id) AS total_referrals,
    COUNT(ref.id) FILTER (WHERE ref.status = 'active') AS active_referrals,
    ROUND(COALESCE(referrer.total_commission, 0), 2) AS total_commission,
    ROUND(COALESCE((
      SELECT SUM(o.total_amount)
      FROM public.orders o
      WHERE o.customer_id IN (
        SELECT r2.id FROM public.customers r2
        WHERE r2.referred_by = referrer.affiliate_code
          AND r2.status NOT IN ('deleted', 'archived')
          AND r2.deleted_at IS NULL
      )
      AND o.status = 'delivered'
    ), 0), 2) AS referral_revenue
  FROM public.customers referrer
  JOIN public.customers ref
    ON ref.referred_by = referrer.affiliate_code
    AND ref.status NOT IN ('deleted', 'archived')
    AND ref.deleted_at IS NULL
  WHERE referrer.status NOT IN ('deleted', 'archived')
    AND referrer.deleted_at IS NULL
  GROUP BY referrer.id, referrer.full_name, referrer.username, referrer.email,
           referrer.affiliate_code, referrer.status, referrer.created_at, referrer.total_commission
  HAVING COUNT(ref.id) > 0
  ORDER BY COUNT(ref.id) DESC;
END;
$function$;
