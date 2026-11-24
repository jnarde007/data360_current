
-- Add new Wittyflow-specific settings (ignore if already exist)
INSERT INTO public.platform_settings (key, value)
VALUES
  ('sms_app_id', ''),
  ('sms_app_secret', ''),
  ('sms_callback_url', '')
ON CONFLICT (key) DO NOTHING;
