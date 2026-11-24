ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_status_check;
ALTER TABLE public.stores ADD CONSTRAINT stores_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text, 'deleted'::text]));