
CREATE TABLE public.sms_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT '',
  recipient_phone text NOT NULL DEFAULT '',
  message_body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  provider_response jsonb DEFAULT '{}'::jsonb,
  error_message text DEFAULT '',
  related_order_id uuid DEFAULT NULL,
  related_purchase_id uuid DEFAULT NULL,
  customer_id uuid DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages sms_send_log"
  ON public.sms_send_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins read sms_send_log"
  ON public.sms_send_log FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE INDEX idx_sms_send_log_order ON public.sms_send_log(related_order_id) WHERE related_order_id IS NOT NULL;
CREATE INDEX idx_sms_send_log_purchase ON public.sms_send_log(related_purchase_id) WHERE related_purchase_id IS NOT NULL;
CREATE INDEX idx_sms_send_log_status ON public.sms_send_log(status);
