
-- Add delivery_mode and provider fields to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_name text NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_order_id text NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_reference text NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_response jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS webhook_history jsonb DEFAULT '[]'::jsonb;

-- Update place_order function to accept delivery_mode and provider_name
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text,
  p_quantity integer, p_total_amount numeric, p_cost_price numeric,
  p_delivery_mode text DEFAULT 'manual', p_provider_name text DEFAULT ''
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

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, delivery_mode, provider_name, status)
  VALUES (p_customer_id, p_network, p_bundle_size, p_recipient_phone, p_quantity, p_total_amount, p_cost_price, p_delivery_mode, p_provider_name,
    CASE WHEN p_delivery_mode = 'api' THEN 'processing' ELSE 'pending' END)
  RETURNING id, short_id INTO new_order_id, new_short_id;

  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', p_total_amount, 'Data purchase - ' || p_bundle_size || ' ' || p_network, new_short_id);

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id);
END;
$$;
