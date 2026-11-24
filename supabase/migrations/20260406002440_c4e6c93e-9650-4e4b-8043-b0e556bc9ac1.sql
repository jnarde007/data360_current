
CREATE OR REPLACE FUNCTION public.notify_wallet_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_message text;
  v_type text;
  v_is_order_refund boolean := false;
  v_is_paystack_credit boolean := false;
  v_bal_text text := '';
BEGIN
  -- Build balance suffix if available
  IF NEW.balance_after IS NOT NULL THEN
    v_bal_text := ' New balance: GH₵' || NEW.balance_after::text;
  END IF;

  -- 1a. Admin-initiated credit
  IF NEW.admin_id IS NOT NULL AND NEW.type = 'credit' THEN
    v_title := 'Wallet Credited';
    v_message := 'GH₵' || NEW.amount::text || ' has been credited to your wallet. ' || COALESCE(NEW.description, '') || v_bal_text;
    v_type := 'wallet';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type, 'reference', NEW.reference, 'description', NEW.description));
  END IF;

  -- 1b. Admin-initiated debit
  IF NEW.admin_id IS NOT NULL AND NEW.type = 'debit' THEN
    v_title := 'Wallet Debited';
    v_message := 'GH₵' || NEW.amount::text || ' was deducted from your wallet. ' || COALESCE(NEW.description, '') || v_bal_text;
    v_type := 'wallet';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type, 'reference', NEW.reference, 'description', NEW.description));
  END IF;

  -- 1c. Order payment debit
  IF NEW.admin_id IS NULL AND NEW.type = 'debit' AND NEW.reference LIKE 'ORD-%' THEN
    v_title := 'Order Payment';
    v_message := 'GH₵' || NEW.amount::text || ' was deducted from your wallet for order ' || NEW.reference || '.' || v_bal_text;
    v_type := 'order_update';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type, 'reference', NEW.reference));
  END IF;

  -- 1d. Non-admin credits
  IF NEW.admin_id IS NULL AND NEW.type = 'credit' THEN
    v_is_order_refund := (NEW.reference LIKE 'REF-%');
    v_is_paystack_credit := (NEW.reference LIKE 'PSK-%');

    IF v_is_order_refund THEN
      NULL;
    ELSIF v_is_paystack_credit THEN
      v_title := 'Wallet Funded via Paystack';
      v_message := 'GH₵' || NEW.amount::text || ' has been added to your wallet via Paystack.' || v_bal_text;
      v_type := 'topup_update';

      INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
      VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type, 'reference', NEW.reference, 'description', NEW.description));
    ELSE
      v_title := 'Wallet Refund';
      v_message := 'GH₵' || NEW.amount::text || ' was refunded to your wallet. ' || COALESCE(NEW.description, '') || v_bal_text;
      v_type := 'refund';

      INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
      VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
        jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type, 'reference', NEW.reference, 'description', NEW.description));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
