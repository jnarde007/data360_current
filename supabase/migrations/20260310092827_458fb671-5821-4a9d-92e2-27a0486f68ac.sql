
-- Add admin_id column to wallet_transactions to track which admin did manual top-ups
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS admin_id uuid DEFAULT NULL;

-- Add unique constraint on customers email and phone to prevent duplicate accounts
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_unique ON public.customers (email);
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON public.customers (phone) WHERE phone != '' AND phone IS NOT NULL;

-- Create network_api_configs table for per-network API settings
CREATE TABLE IF NOT EXISTS public.network_api_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL UNIQUE,
  api_base_url text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  api_secret text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  extra_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.network_api_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read network_api_configs" ON public.network_api_configs
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert network_api_configs" ON public.network_api_configs
FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update network_api_configs" ON public.network_api_configs
FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated delete network_api_configs" ON public.network_api_configs
FOR DELETE TO authenticated USING (true);

-- Insert default network configs
INSERT INTO public.network_api_configs (network) VALUES ('MTN'), ('AirtelTigo'), ('Telecel')
ON CONFLICT (network) DO NOTHING;
