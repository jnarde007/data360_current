
-- 1. Add balance_before and balance_after columns (nullable for backward compat)
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS balance_before numeric,
  ADD COLUMN IF NOT EXISTS balance_after numeric;

-- 2. Create trigger function to auto-populate balance_before/balance_after
-- At insert time, the customer's wallet_balance already reflects the post-transaction state
CREATE OR REPLACE FUNCTION public.set_wallet_transaction_balances()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_balance numeric;
BEGIN
  -- Get the customer's current wallet balance (which is already the post-transaction balance)
  SELECT wallet_balance INTO v_current_balance
  FROM public.customers
  WHERE id = NEW.customer_id;

  IF v_current_balance IS NOT NULL THEN
    NEW.balance_after := v_current_balance;
    IF NEW.type = 'credit' THEN
      NEW.balance_before := v_current_balance - NEW.amount;
    ELSIF NEW.type = 'debit' THEN
      NEW.balance_before := v_current_balance + NEW.amount;
    ELSE
      NEW.balance_before := v_current_balance;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Create the trigger (BEFORE INSERT so we can modify NEW)
DROP TRIGGER IF EXISTS trg_set_wallet_balances ON public.wallet_transactions;
CREATE TRIGGER trg_set_wallet_balances
  BEFORE INSERT ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wallet_transaction_balances();
