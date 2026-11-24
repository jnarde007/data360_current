
DROP POLICY IF EXISTS "Store branding public read" ON storage.objects;
DROP POLICY IF EXISTS "Owners upload store branding" ON storage.objects;
DROP POLICY IF EXISTS "Owners update own store branding" ON storage.objects;
DROP POLICY IF EXISTS "Owners delete own store branding" ON storage.objects;

CREATE POLICY "Store branding read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('store-logos','store-banners'));

CREATE POLICY "Owners upload store branding" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('store-logos','store-banners')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners update own store branding" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('store-logos','store-banners')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners delete own store branding" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('store-logos','store-banners')
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
