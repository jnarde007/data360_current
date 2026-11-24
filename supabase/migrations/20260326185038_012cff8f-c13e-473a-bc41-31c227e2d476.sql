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
BEGIN
  -- 1a. Admin-initiated credit (manual top-up / adjustment)
  IF NEW.admin_id IS NOT NULL AND NEW.type = 'credit' THEN
    v_title := 'Wallet Credited';
    v_message := 'GH₵' || NEW.amount::text || ' has been credited to your wallet. ' || COALESCE(NEW.description, '');
    v_type := 'wallet';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object(
        'transaction_id', NEW.id,
        'amount', NEW.amount,
        'type', NEW.type,
        'reference', NEW.reference,
        'description', NEW.description
      ));
  END IF;

  -- 1b. Admin-initiated debit (manual deduction)
  IF NEW.admin_id IS NOT NULL AND NEW.type = 'debit' THEN
    v_title := 'Wallet Debited';
    v_message := 'GH₵' || NEW.amount::text || ' was deducted from your wallet. ' || COALESCE(NEW.description, '');
    v_type := 'wallet';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object(
        'transaction_id', NEW.id,
        'amount', NEW.amount,
        'type', NEW.type,
        'reference', NEW.reference,
        'description', NEW.description
      ));
  END IF;

  -- 1c. Order payment debit (customer placed an order)
  IF NEW.admin_id IS NULL AND NEW.type = 'debit' AND NEW.reference LIKE 'ORD-%' THEN
    v_title := 'Order Payment';
    v_message := 'GH₵' || NEW.amount::text || ' was deducted from your wallet for order ' || NEW.reference || '.';
    v_type := 'order_update';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object(
        'transaction_id', NEW.id,
        'amount', NEW.amount,
        'type', NEW.type,
        'reference', NEW.reference
      ));
  END IF;

  -- 1d. Non-order refund credit (order refunds already handled by notify_order_status_change)
  IF NEW.admin_id IS NULL AND NEW.type = 'credit' THEN
    v_is_order_refund := (NEW.reference LIKE 'REF-%');

    IF NOT v_is_order_refund THEN
      v_title := 'Wallet Refund';
      v_message := 'GH₵' || NEW.amount::text || ' was refunded to your wallet. ' || COALESCE(NEW.description, '');
      v_type := 'refund';

      INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
      VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
        jsonb_build_object(
          'transaction_id', NEW.id,
          'amount', NEW.amount,
          'type', NEW.type,
          'reference', NEW.reference,
          'description', NEW.description
        ));
    END IF;
  END IF;

  -- 2. Admin alert for large transactions (>= 500 GH₵)
  IF NEW.amount >= 500 THEN
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('admin', NULL, 'system',
      'Large Transaction Alert',
      'A ' || NEW.type || ' of GH₵' || NEW.amount::text || ' was recorded. Ref: ' || COALESCE(NEW.reference, 'N/A'),
      jsonb_build_object('transaction_id', NEW.id, 'customer_id', NEW.customer_id, 'amount', NEW.amount, 'type', NEW.type));
  END IF;

  RETURN NEW;
END;
$function$;