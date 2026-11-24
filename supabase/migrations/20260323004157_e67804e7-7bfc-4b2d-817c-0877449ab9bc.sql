
-- Notifications table for both customer and admin alerts
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL DEFAULT 'customer', -- 'customer' or 'admin'
  target_id uuid, -- customer_id for customer notifications, NULL for admin-broadcast
  type text NOT NULL DEFAULT 'info', -- order_update, topup_update, wallet, refund, security, system
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  read boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_notifications_target ON public.notifications (target_type, target_id, read, created_at DESC);
CREATE INDEX idx_notifications_admin ON public.notifications (target_type, created_at DESC) WHERE target_type = 'admin';

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Customers read their own notifications
CREATE POLICY "Customers read own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (
    (target_type = 'customer' AND target_id = get_my_customer_id())
    OR (target_type = 'admin' AND is_admin())
  );

-- Customers can mark their own notifications as read
CREATE POLICY "Customers update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    (target_type = 'customer' AND target_id = get_my_customer_id())
    OR (target_type = 'admin' AND is_admin())
  )
  WITH CHECK (
    (target_type = 'customer' AND target_id = get_my_customer_id())
    OR (target_type = 'admin' AND is_admin())
  );

-- Service role and admins can insert
CREATE POLICY "Service role inserts notifications"
  ON public.notifications FOR INSERT TO public
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins insert notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger: notify customer on order status change
CREATE OR REPLACE FUNCTION public.notify_order_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_title text;
  v_message text;
  v_type text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_type := 'order_update';

  CASE NEW.status
    WHEN 'delivered' THEN
      v_title := 'Order Delivered';
      v_message := 'Your order ' || NEW.short_id || ' (' || NEW.bundle_size || ' ' || NEW.network || ') has been delivered successfully.';
    WHEN 'processing' THEN
      v_title := 'Order Processing';
      v_message := 'Your order ' || NEW.short_id || ' is now being processed.';
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

  INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
  VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
    jsonb_build_object('order_id', NEW.id, 'short_id', NEW.short_id, 'status', NEW.status));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_order_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_order_status_change();

-- Trigger: notify customer on topup status change
CREATE OR REPLACE FUNCTION public.notify_topup_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_title text;
  v_message text;
  v_type text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_type := 'topup_update';

  CASE NEW.status
    WHEN 'approved' THEN
      v_title := 'Top-up Approved';
      v_message := 'Your top-up of GH₵' || NEW.amount::text || ' (' || NEW.short_id || ') has been approved and credited to your wallet.';
    WHEN 'rejected' THEN
      v_title := 'Top-up Rejected';
      v_message := 'Your top-up ' || NEW.short_id || ' was rejected. Please contact support if you believe this is an error.';
      v_type := 'failure';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
  VALUES ('customer', NEW.customer_id, v_type, v_title, v_message,
    jsonb_build_object('topup_id', NEW.id, 'short_id', NEW.short_id, 'status', NEW.status, 'amount', NEW.amount));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_topup_status
  AFTER UPDATE ON public.topups
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_topup_status_change();

-- Trigger: notify on wallet credit (admin manual credits)
CREATE OR REPLACE FUNCTION public.notify_wallet_transaction()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- Only notify on admin-initiated credits (has admin_id)
  IF NEW.admin_id IS NOT NULL AND NEW.type = 'credit' THEN
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', NEW.customer_id, 'wallet',
      'Wallet Credited',
      'GH₵' || NEW.amount::text || ' has been credited to your wallet. ' || COALESCE(NEW.description, ''),
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type));
  END IF;

  -- Notify admins on large transactions
  IF NEW.amount >= 500 THEN
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('admin', NULL, 'system',
      'Large Transaction Alert',
      'A ' || NEW.type || ' of GH₵' || NEW.amount::text || ' was recorded. Ref: ' || COALESCE(NEW.reference, 'N/A'),
      jsonb_build_object('transaction_id', NEW.id, 'customer_id', NEW.customer_id, 'amount', NEW.amount, 'type', NEW.type));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_wallet_transaction
  AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_wallet_transaction();

-- Trigger: notify admins on new pending topup
CREATE OR REPLACE FUNCTION public.notify_admin_new_topup()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_customer_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT full_name INTO v_customer_name FROM public.customers WHERE id = NEW.customer_id;
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('admin', NULL, 'topup_update',
      'New Top-up Request',
      'GH₵' || NEW.amount::text || ' top-up from ' || COALESCE(v_customer_name, 'Unknown') || ' (' || NEW.short_id || ') awaiting approval.',
      jsonb_build_object('topup_id', NEW.id, 'short_id', NEW.short_id, 'amount', NEW.amount, 'customer_id', NEW.customer_id));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_admin_new_topup
  AFTER INSERT ON public.topups
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_new_topup();

-- Trigger: notify admins on failed orders
CREATE OR REPLACE FUNCTION public.notify_admin_order_failure()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' THEN
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('admin', NULL, 'failure',
      'Order Failed',
      'Order ' || NEW.short_id || ' (' || NEW.bundle_size || ' ' || NEW.network || ') has failed and may need attention.',
      jsonb_build_object('order_id', NEW.id, 'short_id', NEW.short_id, 'network', NEW.network, 'customer_id', NEW.customer_id));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_admin_order_failure
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_order_failure();
