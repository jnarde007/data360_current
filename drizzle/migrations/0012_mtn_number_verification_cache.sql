CREATE TABLE public.mtn_number_verifications (
  phone text PRIMARY KEY,
  status text NOT NULL,
  message text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);
GRANT ALL ON public.mtn_number_verifications TO service_role;
ALTER TABLE public.mtn_number_verifications ENABLE ROW LEVEL SECURITY;