
-- Fix SECURITY DEFINER view warning: set view owner to authenticated role context
-- Re-create the view with SECURITY INVOKER (default, explicit)
DROP VIEW IF EXISTS public.available_networks;

CREATE VIEW public.available_networks 
  WITH (security_invoker = true) AS
  SELECT network, available_for_purchase
  FROM public.network_api_configs
  WHERE available_for_purchase = true;

GRANT SELECT ON public.available_networks TO authenticated;

-- Fix remaining "always true" WITH CHECK on login_attempts insert
DROP POLICY IF EXISTS "Anyone can insert login attempts" ON public.login_attempts;
CREATE POLICY "Anyone can insert login attempts"
  ON public.login_attempts FOR INSERT TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL AND email <> ''
  );
