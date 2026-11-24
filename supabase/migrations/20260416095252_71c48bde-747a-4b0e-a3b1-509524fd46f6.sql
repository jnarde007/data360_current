
-- 1. Update notify_order_status_change: remove 'pending' and 'processing' cases
CREATE OR REPLACE FUNCTION public.notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_message text;
  v_type text;
  v_already_exists boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_type := 'order_update';

  CASE NEW.status
    WHEN 'pending_confirmation' THEN
      v_title := 'Order Received';
      v_message := 'We''ve received your order ' || NEW.short_id || ' (' || NEW.bundle_size || ' ' || NEW.network || '). You can cancel within 3 minutes.';
    WHEN 'delivered' THEN
      v_title := 'Order Completed';
      v_message := 'Your order ' || NEW.short_id || ' (' || NEW.bundle_size || ' ' || NEW.network || ') has been delivered successfully.';
    WHEN 'failed' THEN
      v_title := 'Order Failed';
      v_message := 'Your order ' || NEW.short_id || ' could not be completed. Please contact support.';
      v_type := 'failure';
    WHEN 'rejected' THEN
      v_title := 'Order Rejected & Refunded';
      v_message := 'Your order ' || NEW.short_id || ' was rejected. A refund has been issued to your wallet.';
      v_type := 'refund';
    WHEN 'customer_cancelled' THEN
      v_title := 'Order Cancelled';
      v_message := 'Your order ' || NEW.short_id || ' has been cancelled and refunded.';
      v_type := 'refund';
    WHEN 'cancelled_before_processing' THEN
      v_title := 'Order Cancelled';
      v_message := 'Your order ' || NEW.short_id || ' was cancelled before processing. Refund issued.';
      v_type := 'refund';
    ELSE
      RETURN NEW;
  END CASE;

  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE target_type = 'customer'
      AND target_id = NEW.customer_id
      AND metadata->>'order_id' = NEW.id::text
      AND metadata->>'status' = NEW.status
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
  VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
    jsonb_build_object('order_id', NEW.id, 'short_id', NEW.short_id, 'status', NEW.status));

  RETURN NEW;
END;
$function$;

-- 2. Update notify_wallet_transaction: remove order-payment debit (ORD-*) notification
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
  IF NEW.balance_after IS NOT NULL THEN
    v_bal_text := ' New balance: GH₵' || NEW.balance_after::text;
  END IF;

  -- Admin-initiated credit
  IF NEW.admin_id IS NOT NULL AND NEW.type = 'credit' THEN
    v_title := 'Wallet Credited';
    v_message := 'GH₵' || NEW.amount::text || ' has been credited to your wallet. ' || COALESCE(NEW.description, '') || v_bal_text;
    v_type := 'wallet';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type, 'reference', NEW.reference, 'description', NEW.description));
  END IF;

  -- Admin-initiated debit
  IF NEW.admin_id IS NOT NULL AND NEW.type = 'debit' THEN
    v_title := 'Wallet Debited';
    v_message := 'GH₵' || NEW.amount::text || ' was deducted from your wallet. ' || COALESCE(NEW.description, '') || v_bal_text;
    v_type := 'wallet';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type, 'reference', NEW.reference, 'description', NEW.description));
  END IF;

  -- Order payment debit (ORD-*) — REMOVED: redundant with "Order Received" notification

  -- Non-admin credits
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

-- 3. Update notify_ticket_status_change: remove 'pending' case
CREATE OR REPLACE FUNCTION public.notify_ticket_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_message text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'resolved' THEN
      v_title := 'Ticket Resolved';
      v_message := 'Your support ticket ' || NEW.short_id || ' has been resolved.';
    WHEN 'closed' THEN
      v_title := 'Ticket Closed';
      v_message := 'Your support ticket ' || NEW.short_id || ' has been closed.';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
  VALUES ('customer', NEW.customer_id, 'support', v_title, v_message,
    jsonb_build_object('ticket_id', NEW.id, 'short_id', NEW.short_id, 'status', NEW.status));

  RETURN NEW;
END;
$function$;
