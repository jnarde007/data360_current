CREATE OR REPLACE FUNCTION public.get_my_referral_count()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::integer
  FROM public.customers
  WHERE referred_by = (
    SELECT affiliate_code FROM public.customers WHERE auth_user_id = auth.uid() LIMIT 1
  )
  AND status NOT IN ('deleted', 'archived')
  AND deleted_at IS NULL
$$;