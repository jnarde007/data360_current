
-- 1. Expand customer order notifications with deduplication and "order received"
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
  -- Only fire on actual status changes (UPDATE) or new inserts
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
    WHEN 'processing' THEN
      v_title := 'Order Processing';
      v_message := 'Your order ' || NEW.short_id || ' is now being processed.';
    WHEN 'pending' THEN
      v_title := 'Order Queued';
      v_message := 'Your order ' || NEW.short_id || ' is queued for fulfillment.';
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

  -- Deduplication: skip if identical notification already exists for this order+status
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

-- 2. Expand admin order notifications: new orders, cancellations, failures
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
  v_already_exists boolean;
BEGIN
  -- Get customer name for context
  IF NEW.customer_id IS NOT NULL THEN
    SELECT full_name INTO v_customer_name FROM public.customers WHERE id = NEW.customer_id;
  END IF;
  v_customer_name := COALESCE(v_customer_name, 'Unknown');

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

-- 3. Update customer trigger to also fire on INSERT (for "order received")
DROP TRIGGER IF EXISTS trg_notify_order_status ON public.orders;
CREATE TRIGGER trg_notify_order_status
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_order_status_change();

-- 4. Update admin trigger to also fire on INSERT (for "new order")
DROP TRIGGER IF EXISTS trg_notify_admin_order_failure ON public.orders;
CREATE TRIGGER trg_notify_admin_order_events
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_order_failure();
