
-- Add short_id to orders with auto-increment prefix
CREATE SEQUENCE IF NOT EXISTS orders_short_id_seq START 1000;
ALTER TABLE public.orders ADD COLUMN short_id text NOT NULL DEFAULT 'ORD-' || nextval('orders_short_id_seq')::text;
CREATE UNIQUE INDEX orders_short_id_idx ON public.orders (short_id);

-- Add short_id to topups with auto-increment prefix
CREATE SEQUENCE IF NOT EXISTS topups_short_id_seq START 1000;
ALTER TABLE public.topups ADD COLUMN short_id text NOT NULL DEFAULT 'TOP-' || nextval('topups_short_id_seq')::text;
CREATE UNIQUE INDEX topups_short_id_idx ON public.topups (short_id);

-- Create a function to auto-generate order short_id on insert
CREATE OR REPLACE FUNCTION public.generate_order_short_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.short_id IS NULL OR NEW.short_id = '' THEN
    NEW.short_id := 'ORD-' || nextval('orders_short_id_seq')::text;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_short_id
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_order_short_id();

-- Create a function to auto-generate topup short_id on insert
CREATE OR REPLACE FUNCTION public.generate_topup_short_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.short_id IS NULL OR NEW.short_id = '' THEN
    NEW.short_id := 'TOP-' || nextval('topups_short_id_seq')::text;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_topup_short_id
  BEFORE INSERT ON public.topups
  FOR EACH ROW EXECUTE FUNCTION public.generate_topup_short_id();
