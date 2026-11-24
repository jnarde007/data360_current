
DO $$
DECLARE
  v_cid uuid := 'd798d184-e661-4c75-b98c-b23043e6d4d4';
  v_ref text := 'PSK-AFA-1778919029168-BQV2CN';
  v_balance numeric;
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM public.wallet_transactions
   WHERE customer_id = v_cid AND reference = v_ref || '-REV' AND type='debit' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN; END IF;

  SELECT wallet_balance INTO v_balance FROM public.customers WHERE id=v_cid;
  IF v_balance IS NULL OR v_balance <= 0 THEN RETURN; END IF;

  UPDATE public.customers SET wallet_balance = wallet_balance - v_balance WHERE id = v_cid;

  INSERT INTO public.wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (v_cid, 'debit', v_balance,
          'Partial reversal: erroneous wallet credit for AFA Paystack payment (remainder already consumed)',
          v_ref || '-REV');

  UPDATE public.topups SET status='reversed' WHERE customer_id = v_cid AND payment_reference = v_ref;
END $$;
