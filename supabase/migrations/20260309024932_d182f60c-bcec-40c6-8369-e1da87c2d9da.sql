
-- Add commission tracking columns to customers
ALTER TABLE public.customers 
  ADD COLUMN IF NOT EXISTS total_commission numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_commission numeric NOT NULL DEFAULT 0;

-- Create affiliate withdrawal requests table
CREATE TABLE IF NOT EXISTS public.affiliate_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  admin_note text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid
);

ALTER TABLE public.affiliate_withdrawals ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated read affiliate_withdrawals" ON public.affiliate_withdrawals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert affiliate_withdrawals" ON public.affiliate_withdrawals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update affiliate_withdrawals" ON public.affiliate_withdrawals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon read affiliate_withdrawals" ON public.affiliate_withdrawals FOR SELECT TO anon USING (true);
