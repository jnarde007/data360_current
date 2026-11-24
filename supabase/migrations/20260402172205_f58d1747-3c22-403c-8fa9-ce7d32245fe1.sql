
-- Add payment_method to checker_purchases for reporting
ALTER TABLE public.checker_purchases ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'wallet';

-- Add payment_method to orders for reporting
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'wallet';
