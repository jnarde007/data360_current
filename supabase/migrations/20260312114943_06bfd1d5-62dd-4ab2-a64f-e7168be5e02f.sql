
INSERT INTO public.platform_settings (key, value) VALUES
  ('notification_sender_email', ''),
  ('notification_sender_name', 'DATA360'),
  ('send_email_on_approval', 'false'),
  ('send_email_on_verification', 'false')
ON CONFLICT (key) DO NOTHING;
