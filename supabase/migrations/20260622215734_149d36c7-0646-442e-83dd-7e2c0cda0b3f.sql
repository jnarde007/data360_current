
-- Reverse 4 erroneous wallet credits caused by paystack-webhook treating
-- AFA paystack-direct charges as wallet top-ups.
-- For each affected (customer_id, PSK-AFA-...) pair:
--   1. Reduce wallet_balance by 15.30
--   2. Insert a debit wallet_transaction (reversal) — balances auto-set by trigger
--   3. Mark the topups row as 'reversed'
DO $$
DECLARE
  v_pairs CONSTANT text[][] := ARRAY[
    ['c14ce631-448c-4699-827b-30e686ee93f5','PSK-AFA-1782062138441-IQL90N'],
    ['2c05d001-5225-41e0-bf00-e45a24a9d36e','PSK-AFA-1779692360600-SO7Z62'],
    ['d798d184-e661-4c75-b98c-b23043e6d4d4','PSK-AFA-1778919029168-BQV2CN'],
    ['a7270897-d3a9-4c9d-b3da-7b670bd3491a','PSK-AFA-1778013386183-X5PWSC']
  ];
  v_cid uuid;
  v_ref text;
  v_amount numeric := 15.30;
  v_existing_credit uuid;
  v_existing_reversal uuid;
  v_balance numeric;
BEGIN
  FOR i IN 1..array_length(v_pairs,1) LOOP
    v_cid := v_pairs[i][1]::uuid;
    v_ref := v_pairs[i][2];

    -- Make sure original credit exists
    SELECT id INTO v_existing_credit
    FROM public.wallet_transactions
    WHERE customer_id = v_cid AND reference = v_ref AND type = 'credit'
    LIMIT 1;
    IF v_existing_credit IS NULL THEN
      RAISE NOTICE 'No original credit for %, skipping', v_ref;
      CONTINUE;
    END IF;

    -- Don't double-reverse
    SELECT id INTO v_existing_reversal
    FROM public.wallet_transactions
    WHERE customer_id = v_cid AND reference = v_ref || '-REV' AND type = 'debit'
    LIMIT 1;
    IF v_existing_reversal IS NOT NULL THEN
      RAISE NOTICE 'Already reversed %, skipping', v_ref;
      CONTINUE;
    END IF;

    SELECT wallet_balance INTO v_balance FROM public.customers WHERE id = v_cid;
    IF v_balance < v_amount THEN
      RAISE NOTICE 'Insufficient balance to reverse % for %, skipping', v_ref, v_cid;
      CONTINUE;
    END IF;

    UPDATE public.customers
      SET wallet_balance = wallet_balance - v_amount
      WHERE id = v_cid;

    INSERT INTO public.wallet_transactions (customer_id, type, amount, description, reference)
    VALUES (
      v_cid, 'debit', v_amount,
      'Reversal: erroneous wallet credit for AFA Paystack payment',
      v_ref || '-REV'
    );

    -- Mark the corresponding topup as reversed (status text is unrestricted)
    UPDATE public.topups
       SET status = 'reversed'
     WHERE customer_id = v_cid AND payment_reference = v_ref;
  END LOOP;
END $$;
