
-- Create the reusable updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create refunds table
CREATE TABLE public.refunds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id),
  payment_attempt_id UUID REFERENCES public.payment_attempts(id),
  customer_id UUID REFERENCES public.customers(id),
  buyer_type TEXT NOT NULL DEFAULT 'registered',
  refund_method TEXT NOT NULL DEFAULT 'wallet',
  refund_amount NUMERIC NOT NULL DEFAULT 0,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  data_value NUMERIC NOT NULL DEFAULT 0,
  paystack_transaction_id TEXT DEFAULT '',
  paystack_reference TEXT DEFAULT '',
  paystack_refund_id TEXT DEFAULT '',
  paystack_response JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'refund_pending',
  refund_reason TEXT DEFAULT '',
  initiated_by TEXT DEFAULT 'system',
  is_full_override BOOLEAN NOT NULL DEFAULT false,
  total_refunded NUMERIC NOT NULL DEFAULT 0,
  error_message TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_refunds_order_id ON public.refunds(order_id);
CREATE INDEX idx_refunds_status ON public.refunds(status);
CREATE UNIQUE INDEX idx_refunds_idempotency ON public.refunds(order_id, refund_amount) WHERE status != 'refund_failed';

-- Enable RLS
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage refunds"
ON public.refunds FOR ALL TO authenticated
USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Customers read own refunds"
ON public.refunds FOR SELECT TO authenticated
USING (customer_id = get_my_customer_id());

CREATE POLICY "Service role manages refunds"
ON public.refunds FOR ALL TO public
USING (auth.role() = 'service_role'::text)
WITH CHECK (auth.role() = 'service_role'::text);

-- Trigger
CREATE TRIGGER update_refunds_updated_at
BEFORE UPDATE ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
