
-- Add anon policies for admin_users
CREATE POLICY "Allow anon read admin_users" ON public.admin_users FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert admin_users" ON public.admin_users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update admin_users" ON public.admin_users FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete admin_users" ON public.admin_users FOR DELETE TO anon USING (true);

-- Add anon policies for customers
CREATE POLICY "Allow anon read customers" ON public.customers FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert customers" ON public.customers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update customers" ON public.customers FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete customers" ON public.customers FOR DELETE TO anon USING (true);

-- Add anon policies for orders
CREATE POLICY "Allow anon read orders" ON public.orders FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert orders" ON public.orders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update orders" ON public.orders FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete orders" ON public.orders FOR DELETE TO anon USING (true);

-- Add anon policies for topups
CREATE POLICY "Allow anon read topups" ON public.topups FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert topups" ON public.topups FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update topups" ON public.topups FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete topups" ON public.topups FOR DELETE TO anon USING (true);

-- Add anon policies for price_items
CREATE POLICY "Allow anon insert price_items" ON public.price_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update price_items" ON public.price_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete price_items" ON public.price_items FOR DELETE TO anon USING (true);

-- Add anon policies for platform_settings
CREATE POLICY "Allow anon insert settings" ON public.platform_settings FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update settings" ON public.platform_settings FOR UPDATE TO anon USING (true) WITH CHECK (true);
