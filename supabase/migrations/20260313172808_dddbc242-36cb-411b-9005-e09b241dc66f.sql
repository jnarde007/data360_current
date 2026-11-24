
-- Drop existing permissive update/delete policies
DROP POLICY IF EXISTS "Admins update admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins delete admin_users" ON public.admin_users;

-- Only Super Admins can update admin_users, and cannot change Super Admin accounts
CREATE POLICY "Super Admins update admin_users"
ON public.admin_users FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.role = 'Super Admin'
      AND au.status = 'active'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.role = 'Super Admin'
      AND au.status = 'active'
  )
);

-- Only Super Admins can delete admin_users, and cannot delete Super Admin accounts
CREATE POLICY "Super Admins delete admin_users"
ON public.admin_users FOR DELETE
TO authenticated
USING (
  role <> 'Super Admin'
  AND EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.role = 'Super Admin'
      AND au.status = 'active'
  )
);

-- Add trigger to prevent updating Super Admin role/status
CREATE OR REPLACE FUNCTION public.protect_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.role = 'Super Admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Cannot change the role of a Super Admin';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot suspend or change the status of a Super Admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_super_admin_trigger ON public.admin_users;
CREATE TRIGGER protect_super_admin_trigger
BEFORE UPDATE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION public.protect_super_admin();
