
-- Fix price_items: restrict base table to admin-only, customers use public_price_items view
DROP POLICY IF EXISTS "Public read price_items" ON public.price_items;

CREATE POLICY "Admins read price_items"
  ON public.price_items FOR SELECT TO authenticated
  USING (public.is_admin());
