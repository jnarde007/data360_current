
CREATE TABLE public.platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Insert default settings
INSERT INTO public.platform_settings (key, value) VALUES
  ('brand_name', 'DATA360'),
  ('affiliate_rate', '5'),
  ('support_whatsapp_url', 'https://wa.me/233241234567'),
  ('auto_delivery', 'true'),
  ('paystack_public_key', ''),
  ('paystack_secret_key', '');
