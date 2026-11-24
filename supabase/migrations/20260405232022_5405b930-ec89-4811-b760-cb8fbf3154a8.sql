
-- 1. Add payment_reference column to topups
ALTER TABLE public.topups ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';

-- 2. Create unique partial index for Paystack references (non-empty only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_unique_paystack_reference
ON public.topups (payment_reference)
WHERE payment_reference <> '';

-- 3. Update credit_wallet_paystack to also create the topup row atomically
CREATE OR REPLACE FUNCTION public.credit_wallet_paystack(
  p_customer_id uuid,
  p_reference text,
  p_amount numeric,
  p_description text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_balance numeric;
  v_tx_id uuid;
  v_topup_id uuid;
BEGIN
  -- Check idempotency on wallet_transactions
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE reference = p_reference AND type = 'credit'
  ) THEN
    RETURN json_build_object('already_processed', true);
  END IF;

  -- Lock customer row and credit balance
  UPDATE public.customers
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_customer_id
  RETURNING wallet_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN json_build_object('error', 'Customer not found');
  END IF;

  -- Insert wallet transaction (unique index prevents duplicates even under race)
  BEGIN
    INSERT INTO public.wallet_transactions (customer_id, type, amount, description, reference)
    VALUES (p_customer_id, 'credit', p_amount, p_description, p_reference)
    RETURNING id INTO v_tx_id;
  EXCEPTION WHEN unique_violation THEN
    -- Race condition: rollback the balance update
    UPDATE public.customers
    SET wallet_balance = wallet_balance - p_amount
    WHERE id = p_customer_id;
    RETURN json_build_object('already_processed', true);
  END;

  -- Create topup record atomically (unique index on payment_reference prevents duplicates)
  BEGIN
    INSERT INTO public.topups (customer_id, amount, method, network, momo_number, status, payment_reference)
    VALUES (p_customer_id, p_amount, 'paystack', '', '', 'approved', p_reference)
    RETURNING id INTO v_topup_id;
  EXCEPTION WHEN unique_violation THEN
    -- Topup already exists (shouldn't happen if wallet_transactions check passed, but safety net)
    NULL;
  END;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance, 'transaction_id', v_tx_id);
END;
$$;
