
-- Add first-class timestamp and recovery fields to payment_attempts
ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS callback_received_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recovery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recovery_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS items_succeeded integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS items_total integer DEFAULT NULL;

-- Add unique partial index on orders.payment_reference for PSK- references (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_psk_payment_ref
  ON public.orders (payment_reference)
  WHERE payment_reference LIKE 'PSK-%';

-- Add unique partial index on checker_purchases.payment_reference for PSK- references
CREATE UNIQUE INDEX IF NOT EXISTS uq_checker_purchases_psk_payment_ref
  ON public.checker_purchases (payment_reference)
  WHERE payment_reference LIKE 'PSK-%';
