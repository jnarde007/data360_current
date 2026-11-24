
-- 1. Remove OTP INSERT policy (all OTP generation should be via service role in edge functions)
DROP POLICY IF EXISTS "Service insert otp_codes" ON public.otp_codes;

-- 2. Add column-level grants for customers table to defense-in-depth alongside the trigger
-- Revoke general UPDATE, then grant only safe columns
REVOKE UPDATE ON public.customers FROM authenticated;
GRANT UPDATE (full_name, phone, transaction_pin_hash) ON public.customers TO authenticated;

-- Re-grant full UPDATE to service_role (used by edge functions and admin operations)
GRANT UPDATE ON public.customers TO service_role;
