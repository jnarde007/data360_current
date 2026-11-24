-- Hide internal cost_price from clients via column-level REVOKE.
-- service_role (edge functions) is unaffected.
REVOKE SELECT (cost_price) ON public.orders FROM PUBLIC;
REVOKE SELECT (cost_price) ON public.orders FROM anon;
REVOKE SELECT (cost_price) ON public.orders FROM authenticated;

-- Admin-only view that exposes full order rows (including cost_price)
-- for reporting and inspection. Runs with definer privileges so the
-- column REVOKE on the underlying table does not block admin reads;
-- access is gated by is_admin() in the view body.
CREATE OR REPLACE VIEW public.orders_admin
WITH (security_invoker = false) AS
SELECT o.*
FROM public.orders o
WHERE public.is_admin();

GRANT SELECT ON public.orders_admin TO authenticated;