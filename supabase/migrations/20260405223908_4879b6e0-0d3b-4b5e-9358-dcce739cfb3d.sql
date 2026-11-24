-- Create a unique partial index on wallet_transactions.reference for PSK- references
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_unique_psk_reference 
ON public.wallet_transactions (reference) 
WHERE reference LIKE 'PSK-%' AND type = 'credit';

-- Atomic idempotent wallet credit function
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
BEGIN
  -- Check idempotency
  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE reference = p_reference AND type = 'credit'
  ) THEN
    RETURN json_build_object('already_processed', true);
  END IF;

  -- Lock customer row and credit
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
    -- Race condition: another request already inserted. Rollback the balance update.
    UPDATE public.customers
    SET wallet_balance = wallet_balance - p_amount
    WHERE id = p_customer_id;
    RETURN json_build_object('already_processed', true);
  END;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance, 'transaction_id', v_tx_id);
END;
$$;