
-- Enum for exam types (create if not exists)
DO $$ BEGIN CREATE TYPE public.exam_type AS ENUM ('wassce', 'bece'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sequence for short_id
CREATE SEQUENCE IF NOT EXISTS checker_purchase_seq START 1000;

-- Checker products catalog
CREATE TABLE IF NOT EXISTS public.checker_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  exam_type public.exam_type NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Checker inventory (individual serial/pin codes)
CREATE TABLE IF NOT EXISTS public.checker_inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.checker_products(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL,
  pin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  batch_id TEXT NOT NULL DEFAULT '',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES public.customers(id),
  UNIQUE(serial_number, pin)
);

-- Checker purchases
CREATE TABLE IF NOT EXISTS public.checker_purchases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  short_id TEXT NOT NULL DEFAULT ('CHK-' || nextval('checker_purchase_seq'::regclass)::text),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  product_id UUID NOT NULL REFERENCES public.checker_products(id),
  checker_inventory_id UUID REFERENCES public.checker_inventory(id),
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  sms_status TEXT NOT NULL DEFAULT 'pending',
  sms_phone TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.checker_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checker_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checker_purchases ENABLE ROW LEVEL SECURITY;

-- checker_products policies
CREATE POLICY "Admins manage checker_products" ON public.checker_products FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Authenticated read active checker_products" ON public.checker_products FOR SELECT TO authenticated USING (status = 'active');

-- checker_inventory policies
CREATE POLICY "Admins manage checker_inventory" ON public.checker_inventory FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- checker_purchases policies
CREATE POLICY "Customers read own checker_purchases" ON public.checker_purchases FOR SELECT TO authenticated USING (customer_id = get_my_customer_id() OR is_admin());
CREATE POLICY "Admins manage checker_purchases" ON public.checker_purchases FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Index for fast available checker lookup
CREATE INDEX IF NOT EXISTS idx_checker_inventory_available ON public.checker_inventory(product_id, status) WHERE status = 'available';

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.checker_purchases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.checker_inventory;

-- Atomic purchase function: deducts wallet, assigns next available checker, creates purchase record
CREATE OR REPLACE FUNCTION public.purchase_checker(
  p_customer_id UUID,
  p_product_id UUID,
  p_sms_phone TEXT DEFAULT ''
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_checker RECORD;
  v_balance NUMERIC;
  v_purchase_id UUID;
  v_short_id TEXT;
BEGIN
  -- Lock and get product
  SELECT * INTO v_product FROM checker_products WHERE id = p_product_id AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  -- Check balance
  SELECT wallet_balance INTO v_balance FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Customer not found');
  END IF;
  IF v_balance < v_product.price THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient wallet balance');
  END IF;

  -- Lock and get next available checker
  SELECT * INTO v_checker FROM checker_inventory
    WHERE product_id = p_product_id AND status = 'available'
    ORDER BY imported_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Out of stock');
  END IF;

  -- Deduct wallet
  UPDATE customers SET wallet_balance = wallet_balance - v_product.price WHERE id = p_customer_id;

  -- Mark checker as sold
  UPDATE checker_inventory SET status = 'sold', sold_at = now(), assigned_to = p_customer_id WHERE id = v_checker.id;

  -- Create purchase record
  INSERT INTO checker_purchases (customer_id, product_id, checker_inventory_id, amount, sms_phone, status)
    VALUES (p_customer_id, p_product_id, v_checker.id, v_product.price, p_sms_phone, 'completed')
    RETURNING id, short_id INTO v_purchase_id, v_short_id;

  -- Create wallet transaction
  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
    VALUES (p_customer_id, 'debit', v_product.price,
            'Results Checker: ' || v_product.name,
            v_short_id);

  RETURN json_build_object(
    'success', true,
    'purchase_id', v_purchase_id,
    'short_id', v_short_id,
    'serial_number', v_checker.serial_number,
    'pin', v_checker.pin,
    'product_name', v_product.name,
    'amount', v_product.price
  );
END;
$$;
