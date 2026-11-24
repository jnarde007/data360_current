
-- Fix security_logs INSERT always-true
DROP POLICY IF EXISTS "Anyone can insert security logs" ON public.security_logs;
CREATE POLICY "Anyone can insert security logs"
  ON public.security_logs FOR INSERT TO anon, authenticated
  WITH CHECK (
    action IS NOT NULL AND action <> ''
  );
