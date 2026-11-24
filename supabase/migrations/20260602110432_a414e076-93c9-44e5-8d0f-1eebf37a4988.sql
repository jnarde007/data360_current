-- Drop existing permissive policies on support-attachments
DROP POLICY IF EXISTS "Public read support attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users read support attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own support attachments" ON storage.objects;

-- Read: admins, the customer who owns the file, or the customer participating in the ticket
CREATE POLICY "Support attachments read (owner/admin)"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'support-attachments' AND (
    public.is_admin()
    OR (storage.foldername(name))[1] = public.get_my_customer_id()::text
    OR (
      (storage.foldername(name))[1] = 'admin'
      AND EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id::text = (storage.foldername(name))[2]
          AND t.customer_id = public.get_my_customer_id()
      )
    )
  )
);

-- Insert: customers may only upload into their own customer-id folder; admins only into the admin/ folder
CREATE POLICY "Support attachments upload (scoped)"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'support-attachments' AND (
    (public.is_admin() AND (storage.foldername(name))[1] = 'admin')
    OR (storage.foldername(name))[1] = public.get_my_customer_id()::text
  )
);