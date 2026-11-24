-- Stop leaking other users' stores into owner dashboards, and require admin approval by default.
DROP POLICY IF EXISTS "stores_public_active_read" ON public.stores;
ALTER TABLE public.stores ALTER COLUMN status SET DEFAULT 'pending';