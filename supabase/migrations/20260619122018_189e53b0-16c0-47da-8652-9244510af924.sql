CREATE OR REPLACE FUNCTION public.notify_admin_order_failure()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_message text;
  v_type text;
  v_customer_name text;
  v_is_store boolean;
  v_already_exists boolean;
BEGIN
  -- Get customer name for context
  IF NEW.customer_id IS NOT NULL THEN
    SELECT full_name INTO v_customer_name FROM public.customers WHERE id = NEW.customer_id;
  END IF;

  -- If no registered customer, determine if it's a store order or a direct guest order
  IF v_customer_name IS NULL THEN
    SELECT true INTO v_is_store FROM public.store_orders WHERE order_id = NEW.id LIMIT 1;
    IF FOUND THEN
      v_customer_name := 'a store';
    ELSIF NEW.buyer_type = 'guest' THEN
      v_customer_name := 'a guest';
    ELSE
      v_customer_name := 'Unknown';
    END IF;
  END IF;

  -- New order placed (INSERT with pending_confirmation)
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_confirmation' THEN
    v_title := 'New Order Received';
    v_message := 'New order ' || NEW.short_id || ' (' || NEW.bundle_size || ' ' || NEW.network || ') from ' || v_customer_name || '. Amount: GH₵' || NEW.total_amount::text;
    v_type := 'order_update';

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('admin', NULL, v_type, v_title, v_message,
      jsonb_build_object('order_id', NEW.id, 'short_id', NEW.short_id, 'status', NEW.status, 'customer_id', NEW.customer_id, 'network', NEW.network, 'amount', NEW.total_amount));

    RETURN NEW;
  END IF;

  -- Status change events (UPDATE only)
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'failed' THEN
      v_title := 'Order Failed';
      v_message := 'Order ' || NEW.short_id || ' (' || NEW.bundle_size || ' ' || NEW.network || ') from ' || v_customer_name || ' has failed and may need attention.';
      v_type := 'failure';
    WHEN 'customer_cancelled' THEN
      v_title := 'Order Cancelled by Customer';
      v_message := 'Order ' || NEW.short_id || ' was cancelled by ' || v_customer_name || '. GH₵' || NEW.total_amount::text || ' refunded.';
      v_type := 'order_update';
    WHEN 'cancelled_before_processing' THEN
      v_title := 'Order Auto-Cancelled';
      v_message := 'Order ' || NEW.short_id || ' from ' || v_customer_name || ' was cancelled before processing.';
      v_type := 'order_update';
    WHEN 'rejected' THEN
      v_title := 'Order Rejected';
      v_message := 'Order ' || NEW.short_id || ' from ' || v_customer_name || ' was rejected. Refund issued.';
      v_type := 'refund';
    ELSE
      RETURN NEW;
  END CASE;

  -- Deduplication
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE target_type = 'admin'
      AND metadata->>'order_id' = NEW.id::text
      AND metadata->>'status' = NEW.status
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
  VALUES ('admin', NULL, v_type, v_title, v_message,
    jsonb_build_object('order_id', NEW.id, 'short_id', NEW.short_id, 'status', NEW.status, 'customer_id', NEW.customer_id, 'network', NEW.network));

  RETURN NEW;
END;
$function$;