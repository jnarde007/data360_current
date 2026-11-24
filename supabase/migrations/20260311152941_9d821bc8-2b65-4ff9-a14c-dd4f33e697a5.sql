-- Ensure customer uniqueness only applies to non-deleted/non-archived accounts
DROP INDEX IF EXISTS public.customers_email_unique;
DROP INDEX IF EXISTS public.customers_phone_unique;

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_active_unique
ON public.customers (email)
WHERE status NOT IN ('deleted', 'archived') AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_active_unique
ON public.customers (phone)
WHERE status NOT IN ('deleted', 'archived') AND deleted_at IS NULL AND phone IS NOT NULL AND phone <> '';