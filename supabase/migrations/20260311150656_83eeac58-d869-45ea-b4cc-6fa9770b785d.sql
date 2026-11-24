
-- Add soft-delete columns to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS anonymized_at timestamptz DEFAULT NULL;

-- Create partial unique indexes for active accounts only
-- First drop any existing unique constraints on email/phone if they exist
DROP INDEX IF EXISTS customers_email_active_unique;
DROP INDEX IF EXISTS customers_phone_active_unique;

CREATE UNIQUE INDEX customers_email_active_unique 
ON public.customers (email) 
WHERE status NOT IN ('deleted', 'archived') AND deleted_at IS NULL;

CREATE UNIQUE INDEX customers_phone_active_unique 
ON public.customers (phone) 
WHERE status NOT IN ('deleted', 'archived') AND deleted_at IS NULL AND phone != '';
