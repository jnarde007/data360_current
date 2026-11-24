
-- 1) Prevent customers from editing sensitive columns directly
CREATE OR REPLACE FUNCTION public.guard_customer_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow admins and SECURITY DEFINER RPCs (which run as table owner / postgres) to bypass
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
$$;

DROP TRIGGER IF EXISTS trg_guard_customer_sensitive_updates ON public.customers;
CREATE TRIGGER trg_guard_customer_sensitive_updates
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_sensitive_updates();


-- 2) Hide cost_price of checker_products from non-admins
DROP POLICY IF EXISTS "Authenticated read active checker_products" ON public.checker_products;

-- Safe public view (no cost_price)
CREATE OR REPLACE VIEW public.checker_products_public
WITH (security_invoker = true)
AS
SELECT id, name, exam_type, price, status, created_at, updated_at
FROM public.checker_products
WHERE status = 'active';

-- Allow only admins direct table reads (admin policy already exists via "Admins manage checker_products")
-- Grants for the safe view
GRANT SELECT ON public.checker_products_public TO anon, authenticated;

-- Tighten direct table grants: revoke broad read from anon/authenticated; admins go through RLS via authenticated role
REVOKE SELECT ON public.checker_products FROM anon;
-- Keep authenticated GRANT so admin policy can apply, but RLS now blocks non-admins
-- (no permissive SELECT policy remains for non-admins)


-- 3) Restrict UPDATE/DELETE on storage.objects for support-attachments bucket
DROP POLICY IF EXISTS "Support attachments update (owner/admin)" ON storage.objects;
DROP POLICY IF EXISTS "Support attachments delete (owner/admin)" ON storage.objects;

CREATE POLICY "Support attachments update (owner/admin)"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'support-attachments'
  AND (
    public.is_admin()
    OR (storage.foldername(name))[1] = (public.get_my_customer_id())::text
  )
)
WITH CHECK (
  bucket_id = 'support-attachments'
  AND (
    public.is_admin()
    OR (storage.foldername(name))[1] = (public.get_my_customer_id())::text
  )
);

CREATE POLICY "Support attachments delete (owner/admin)"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'support-attachments'
  AND (
    public.is_admin()
    OR (storage.foldername(name))[1] = (public.get_my_customer_id())::text
  )
);
