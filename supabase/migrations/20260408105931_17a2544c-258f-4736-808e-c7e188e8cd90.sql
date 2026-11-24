
-- Payment attempts table for tracking checkout sessions
CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  paystack_reference text NOT NULL,
  attempt_type text NOT NULL DEFAULT 'data_direct',
  status text NOT NULL DEFAULT 'pending',
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GHS',
  metadata jsonb NOT NULL DEFAULT '{}',
  paystack_transaction_id text,
  paystack_response jsonb,
  order_id uuid,
  purchase_id uuid,
  finalized_at timestamptz,
  finalized_by text,
  error_message text,
  event_log jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint on paystack_reference for idempotency
ALTER TABLE public.payment_attempts ADD CONSTRAINT uq_payment_attempts_ref UNIQUE (paystack_reference);

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- Customers can insert own payment attempts
CREATE POLICY "Customers insert own payment_attempts"
  ON public.payment_attempts FOR INSERT TO authenticated
  WITH CHECK (customer_id = get_my_customer_id());

-- Customers can read own payment attempts
CREATE POLICY "Customers read own payment_attempts"
  ON public.payment_attempts FOR SELECT TO authenticated
  USING (customer_id = get_my_customer_id() OR is_admin());

-- Admins can update payment_attempts
CREATE POLICY "Admins update payment_attempts"
  ON public.payment_attempts FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Admins can delete payment_attempts
CREATE POLICY "Admins delete payment_attempts"
  ON public.payment_attempts FOR DELETE TO authenticated
  USING (is_admin());

-- Service role for webhook/edge functions
CREATE POLICY "Service role manages payment_attempts"
  ON public.payment_attempts FOR ALL TO public
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Indexes
CREATE INDEX idx_payment_attempts_customer ON public.payment_attempts(customer_id);
CREATE INDEX idx_payment_attempts_status ON public.payment_attempts(status) WHERE status = 'pending';
CREATE INDEX idx_payment_attempts_ref ON public.payment_attempts(paystack_reference);
CREATE INDEX idx_payment_attempts_created ON public.payment_attempts(created_at);
