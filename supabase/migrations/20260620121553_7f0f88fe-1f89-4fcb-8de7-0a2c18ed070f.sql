-- Make intent explicit: affiliate_withdrawals are created exclusively via the
-- security-definer RPC `request_affiliate_withdrawal` or service_role contexts.
-- Add an explicit service_role INSERT policy for auditability.
CREATE POLICY "Service role inserts withdrawals"
  ON public.affiliate_withdrawals
  FOR INSERT
  TO service_role
  WITH CHECK (true);