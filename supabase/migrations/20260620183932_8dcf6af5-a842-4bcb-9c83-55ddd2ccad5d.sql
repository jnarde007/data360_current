
-- History table
CREATE TABLE public.provider_balance_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  balance NUMERIC,
  currency TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.provider_balance_history TO authenticated;
GRANT ALL ON public.provider_balance_history TO service_role;
ALTER TABLE public.provider_balance_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view balance history" ON public.provider_balance_history
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX idx_provider_balance_history_provider_time ON public.provider_balance_history (provider, retrieved_at DESC);

-- Current snapshot
CREATE TABLE public.provider_balance_current (
  provider TEXT NOT NULL PRIMARY KEY,
  balance NUMERIC,
  currency TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  last_success_balance NUMERIC,
  last_success_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supported BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.provider_balance_current TO authenticated;
GRANT ALL ON public.provider_balance_current TO service_role;
ALTER TABLE public.provider_balance_current ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view balance current" ON public.provider_balance_current
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Seed entries
INSERT INTO public.provider_balance_current (provider, status, supported, currency)
VALUES
  ('Portal-02', 'pending', true, 'GHS'),
  ('iGet', 'unsupported', false, 'GHS')
ON CONFLICT (provider) DO NOTHING;

-- Settings
INSERT INTO public.platform_settings (key, value)
VALUES
  ('provider_balance_threshold_portal_02', '100'),
  ('provider_balance_threshold_iget', '100'),
  ('provider_balance_refresh_minutes', '5')
ON CONFLICT (key) DO NOTHING;

-- Cron: every 5 minutes
SELECT cron.unschedule('fetch-provider-balances') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-provider-balances');
SELECT cron.schedule(
  'fetch-provider-balances',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bpntlyplmitxiaounthf.supabase.co/functions/v1/fetch-provider-balances',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbnRseXBsbWl0eGlhb3VudGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTg3MTQsImV4cCI6MjA4ODU3NDcxNH0.en6ActRrL5y9uV-GLw64gemQGpgywPVYpjt1Wfc3kgM"}'::jsonb,
    body := '{"source":"cron"}'::jsonb
  );
  $$
);
