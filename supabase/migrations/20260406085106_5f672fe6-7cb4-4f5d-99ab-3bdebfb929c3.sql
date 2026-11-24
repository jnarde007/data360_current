
-- Reconciliation audit trail table
CREATE TABLE public.reconciliation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  issue_type text NOT NULL DEFAULT 'wallet_variance',
  current_balance numeric NOT NULL DEFAULT 0,
  computed_balance numeric NOT NULL DEFAULT 0,
  variance numeric NOT NULL DEFAULT 0,
  likely_cause text,
  confidence text NOT NULL DEFAULT 'needs_review',
  suggested_fix text,
  diagnostic_details jsonb DEFAULT '{}'::jsonb,
  linked_transactions jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  admin_note text,
  resolved_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX idx_reconciliation_issues_customer ON public.reconciliation_issues(customer_id);
CREATE INDEX idx_reconciliation_issues_status ON public.reconciliation_issues(status);

-- Enable RLS
ALTER TABLE public.reconciliation_issues ENABLE ROW LEVEL SECURITY;

-- Admin-only access
CREATE POLICY "Admins can manage reconciliation issues"
ON public.reconciliation_issues
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_reconciliation_timestamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reconciliation_updated
  BEFORE UPDATE ON public.reconciliation_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_reconciliation_timestamp();
