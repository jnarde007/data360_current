-- Switch AFA short_id to a neutral 8-char uppercase hex derived from the row's UUID id.
-- This unifies the customer-facing SMS reference with the internal/admin reference.

-- 1. New default for fresh inserts: derive from a fresh UUID (will be overridden by trigger using NEW.id).
ALTER TABLE public.afa_registrations
  ALTER COLUMN short_id SET DEFAULT upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

-- 2. Trigger to keep short_id in sync with id on insert (so SMS reference == admin reference).
CREATE OR REPLACE FUNCTION public.set_afa_short_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Always derive from id so SMS and admin references match exactly.
  NEW.short_id := upper(substring(replace(NEW.id::text, '-', ''), 1, 8));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_afa_short_id ON public.afa_registrations;
CREATE TRIGGER trg_set_afa_short_id
BEFORE INSERT ON public.afa_registrations
FOR EACH ROW
EXECUTE FUNCTION public.set_afa_short_id();

-- 3. Backfill existing rows so historical references also match the SMS format.
UPDATE public.afa_registrations
SET short_id = upper(substring(replace(id::text, '-', ''), 1, 8));