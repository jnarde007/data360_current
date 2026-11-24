
-- Allow anyone to read non-secret settings
CREATE POLICY "Allow public read of non-secret settings"
ON public.platform_settings
FOR SELECT
TO anon, authenticated
USING (key NOT IN ('paystack_secret_key'));

-- Allow authenticated users to read all settings (for admin)
CREATE POLICY "Allow authenticated read all settings"
ON public.platform_settings
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to update settings
CREATE POLICY "Allow authenticated update settings"
ON public.platform_settings
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to insert settings
CREATE POLICY "Allow authenticated insert settings"
ON public.platform_settings
FOR INSERT
TO authenticated
WITH CHECK (true);
