-- Create support-attachments storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-attachments', 'support-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload support attachments
CREATE POLICY "Users upload own support attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'support-attachments');

-- Allow authenticated users to read support attachments
CREATE POLICY "Authenticated users read support attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'support-attachments');

-- Allow public read for support attachments (for public URL access)
CREATE POLICY "Public read support attachments"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'support-attachments');