
-- Customers table
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  affiliate_code TEXT NOT NULL DEFAULT '',
  referred_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read customers" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update customers" ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete customers" ON public.customers FOR DELETE TO authenticated USING (true);

-- Orders table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  bundle_size TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update orders" ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete orders" ON public.orders FOR DELETE TO authenticated USING (true);

-- Topups table
CREATE TABLE public.topups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'momo',
  network TEXT NOT NULL DEFAULT '',
  momo_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read topups" ON public.topups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert topups" ON public.topups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update topups" ON public.topups FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete topups" ON public.topups FOR DELETE TO authenticated USING (true);

-- Admin users table
CREATE TABLE public.admin_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Manager',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read admin_users" ON public.admin_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert admin_users" ON public.admin_users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update admin_users" ON public.admin_users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete admin_users" ON public.admin_users FOR DELETE TO authenticated USING (true);
