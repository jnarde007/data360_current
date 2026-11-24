
-- Sequence for short IDs (must exist before table)
CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START 1001;

-- Support tickets table
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id text NOT NULL DEFAULT ('TKT-' || nextval('support_ticket_seq'::regclass)::text),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'Other',
  message text NOT NULL DEFAULT '',
  related_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  related_wallet_transaction_id uuid REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Support messages table
CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  sender_role text NOT NULL DEFAULT 'customer',
  message text NOT NULL DEFAULT '',
  attachment_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- RLS for support_tickets
CREATE POLICY "Customers read own tickets"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (customer_id = public.get_my_customer_id() OR public.is_admin());

CREATE POLICY "Customers insert own tickets"
  ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (customer_id = public.get_my_customer_id());

CREATE POLICY "Customers update own tickets"
  ON public.support_tickets FOR UPDATE TO authenticated
  USING (customer_id = public.get_my_customer_id() OR public.is_admin())
  WITH CHECK (customer_id = public.get_my_customer_id() OR public.is_admin());

-- RLS for support_messages
CREATE POLICY "Users read messages for accessible tickets"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id
      AND (t.customer_id = public.get_my_customer_id() OR public.is_admin())
    )
  );

CREATE POLICY "Users insert messages for accessible tickets"
  ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id
      AND (t.customer_id = public.get_my_customer_id() OR public.is_admin())
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;

-- Notification trigger for new tickets (notify admin)
CREATE OR REPLACE FUNCTION public.notify_new_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer_name text;
BEGIN
  SELECT full_name INTO v_customer_name FROM public.customers WHERE id = NEW.customer_id;
  
  INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
  VALUES ('admin', NULL, 'support', 'New Support Ticket',
    'New ticket ' || NEW.short_id || ' from ' || COALESCE(v_customer_name, 'Unknown') || ': ' || NEW.subject,
    jsonb_build_object('ticket_id', NEW.id, 'short_id', NEW.short_id, 'category', NEW.category, 'priority', NEW.priority));
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_support_ticket
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_support_ticket();

-- Notification trigger for ticket status changes (notify customer)
CREATE OR REPLACE FUNCTION public.notify_ticket_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_title text;
  v_message text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'pending' THEN
      v_title := 'Ticket Under Review';
      v_message := 'Your support ticket ' || NEW.short_id || ' is being reviewed.';
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
$$;

CREATE TRIGGER trg_notify_ticket_status_change
  AFTER UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_ticket_status_change();

-- Notification trigger for replies
CREATE OR REPLACE FUNCTION public.notify_support_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket record;
BEGIN
  IF NEW.sender_role = 'admin' THEN
    SELECT short_id, customer_id INTO v_ticket FROM public.support_tickets WHERE id = NEW.ticket_id;
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('customer', v_ticket.customer_id, 'support', 'New Reply on Ticket',
      'Admin replied to your ticket ' || v_ticket.short_id || '.',
      jsonb_build_object('ticket_id', NEW.ticket_id, 'short_id', v_ticket.short_id));
  END IF;

  IF NEW.sender_role = 'customer' THEN
    SELECT short_id INTO v_ticket FROM public.support_tickets WHERE id = NEW.ticket_id;
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES ('admin', NULL, 'support', 'Customer Replied on Ticket',
      'New reply on ticket ' || v_ticket.short_id || '.',
      jsonb_build_object('ticket_id', NEW.ticket_id, 'short_id', v_ticket.short_id));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_support_reply
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_reply();

-- Update updated_at on ticket changes
CREATE OR REPLACE FUNCTION public.update_ticket_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_ticket_timestamp
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_ticket_timestamp();
