
-- Add server-side insert policy for otp_codes (edge functions use service role, but add for completeness)
-- And admin SELECT for debugging
CREATE POLICY "Admins read otp_codes"
  ON public.otp_codes FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service insert otp_codes"
  ON public.otp_codes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
