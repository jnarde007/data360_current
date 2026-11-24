
ALTER TABLE public.cross_network_bypass_audit
  ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE public.cross_network_bypass_audit
  SET email = customer_email
  WHERE email IS NULL AND customer_email IS NOT NULL;

ALTER TABLE public.cross_network_bypass_audit
  ALTER COLUMN customer_email DROP NOT NULL;

ALTER TABLE public.cross_network_bypass_audit
  ALTER COLUMN flow DROP NOT NULL;
