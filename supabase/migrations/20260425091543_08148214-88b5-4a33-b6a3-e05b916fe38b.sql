CREATE TABLE public.blind_sweep_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  hours_back integer NOT NULL DEFAULT 24,
  dry_run boolean NOT NULL DEFAULT false,
  scanned integer NOT NULL DEFAULT 0,
  already_local integer NOT NULL DEFAULT 0,
  recovered_topup integer NOT NULL DEFAULT 0,
  flagged_needs_review integer NOT NULL DEFAULT 0,
  skipped_unsafe integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  succeeded boolean NOT NULL DEFAULT true,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'cron',
  duration_ms integer
);

CREATE INDEX idx_blind_sweep_runs_ran_at ON public.blind_sweep_runs (ran_at DESC);

ALTER TABLE public.blind_sweep_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read blind sweep runs"
  ON public.blind_sweep_runs FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service role manages blind sweep runs"
  ON public.blind_sweep_runs FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');