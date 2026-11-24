
-- Create wallet_transactions table
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'credit',
  amount numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read wallet_transactions" ON public.wallet_transactions
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert wallet_transactions" ON public.wallet_transactions
FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Anon read wallet_transactions" ON public.wallet_transactions
FOR SELECT TO anon USING (true);

-- Create atomic place_order function
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_id uuid,
  p_network text,
  p_bundle_size text,
  p_recipient_phone text,
  p_quantity int,
  p_total_amount numeric,
  p_cost_price numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_balance numeric;
  new_order_id uuid;
  new_short_id text;
BEGIN
  SELECT wallet_balance INTO current_balance
  FROM customers WHERE id = p_customer_id FOR UPDATE;

  IF current_balance IS NULL THEN
    RETURN json_build_object('error', 'Customer not found');
  END IF;

  IF current_balance < p_total_amount THEN
    RETURN json_build_object('error', 'Insufficient balance');
  END IF;

  UPDATE customers SET wallet_balance = wallet_balance - p_total_amount WHERE id = p_customer_id;

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price)
  VALUES (p_customer_id, p_network, p_bundle_size, p_recipient_phone, p_quantity, p_total_amount, p_cost_price)
  RETURNING id, short_id INTO new_order_id, new_short_id;

  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', p_total_amount, 'Data purchase - ' || p_bundle_size || ' ' || p_network, new_short_id);

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id);
END;
$$;

-- Enable realtime for wallet_transactions
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
