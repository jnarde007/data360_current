DROP POLICY IF EXISTS "Public read access for email assets" ON storage.objects;
DROP POLICY IF EXISTS "Store branding read" ON storage.objects;
CREATE POLICY "Owners read own store branding" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = ANY (ARRAY['store-logos','store-banners']) AND (auth.uid())::text = (storage.foldername(name))[1]);