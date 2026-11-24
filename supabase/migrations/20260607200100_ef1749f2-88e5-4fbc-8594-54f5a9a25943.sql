
-- 1) Hide cost_price column on public.orders from customer-facing roles.
-- Admin pages access cost_price via the public.orders_admin view, which is
-- owned by postgres and gated by is_admin(), so admins remain unaffected.
REVOKE SELECT (cost_price) ON public.orders FROM authenticated;
REVOKE SELECT (cost_price) ON public.orders FROM anon;

-- 2) security_logs: only authenticated users can self-attribute log entries.
DROP POLICY IF EXISTS "Anyone can insert security logs" ON public.security_logs;
CREATE POLICY "Authenticated users can insert own security logs"
ON public.security_logs
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND action IS NOT NULL
  AND action <> ''
);

-- 3) otp_codes: RLS is enabled with no policy (service_role only by design).
-- Add explicit deny policies so the intent is documented and linter is satisfied.
CREATE POLICY "Deny all client access to otp_codes"
ON public.otp_codes
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
