
-- Phase B: Store Owner SMS — defaults, new events, digest trigger
-- 1) Update defaults for existing templates and seed new event templates
INSERT INTO public.platform_settings (key, value) VALUES
  ('store_sms_template_store_approved', 'Store {store_name} is live. Share your link: buy-data360.com/s/{slug}. Manage products and orders in My Store.'),
  ('store_sms_template_store_rejected', 'Store {store_name} wasn''t approved.{reason_suffix} Update your details in My Store and resubmit for review.'),
  ('store_sms_template_store_created', 'Store {store_name} submitted for review. Approval usually within 24h. You''ll get an SMS once it''s live.'),
  ('store_sms_template_store_new_order', 'New sale on {store_name}. Order {short_id} - GHS {amount}. GHS {profit} profit unlocks after delivery. View in My Store.'),
  ('store_sms_template_store_withdrawal_requested', 'Withdrawal of GHS {amount} to {momo_number} received. Typically paid within 24h on business days. You''ll get an SMS on payout.'),
  ('store_sms_template_store_withdrawal_paid', 'GHS {amount} paid to MoMo {momo_number}. {paystack_reference_suffix}Check your phone for the MoMo confirmation.'),
  ('store_sms_template_store_withdrawal_rejected', 'Your withdrawal of GHS {amount} was not approved.{reason_suffix} Funds returned to your available balance.'),
  ('store_sms_template_store_payout_failed', 'We could not complete your payout of GHS {amount} to {momo_number}. Please verify your MoMo details and try again from My Store.'),
  ('store_sms_template_store_suspended', 'Your store {store_name} has been temporarily suspended.{reason_suffix} Contact support or review details in My Store.'),
  ('store_sms_template_store_first_sale', 'Congratulations! {store_name} just received its first sale (Order {short_id}, GHS {amount}). Keep sharing your link to grow.'),
  ('store_sms_template_store_profit_digest', 'Today GHS {daily_profit} profit became available from {order_count} delivered order(s). Available balance: GHS {available_total}.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- 2) Replace trigger: keep store_new_order SMS; on delivered, only create in-app notification (no per-order SMS)
CREATE OR REPLACE FUNCTION public.trg_store_owner_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://bpntlyplmitxiaounthf.supabase.co/functions/v1/store-owner-notify';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbnRseXBsbWl0eGlhb3VudGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTg3MTQsImV4cCI6MjA4ODU3NDcxNH0.en6ActRrL5y9uV-GLw64gemQGpgywPVYpjt1Wfc3kgM';
  v_short text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New paid order: SMS to owner (edge function also detects first sale)
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon)::jsonb,
      body := jsonb_build_object('event','store_new_order','store_order_id',NEW.id)::jsonb
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    -- Profit unlocked: in-app notification only. Daily digest SMS handled by cron.
    SELECT short_id INTO v_short FROM public.orders WHERE id = NEW.order_id;
    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES (
      'customer',
      NEW.store_owner_id,
      'store_profit_available',
      'Profit unlocked',
      'GHS ' || to_char(NEW.profit, 'FM999990.00') || ' profit available from order ' || COALESCE(v_short,'') || '.',
      jsonb_build_object('store_order_id', NEW.id, 'order_id', NEW.order_id, 'profit', NEW.profit)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_store_owner_notify failed: %', SQLERRM;
  RETURN NEW;
END $$;

-- 3) Schedule daily profit digest at 19:00 Africa/Accra (= 19:00 UTC since Accra is UTC+0)
DO $$
BEGIN
  PERFORM cron.unschedule('store-profit-digest-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'store-profit-digest-daily',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://bpntlyplmitxiaounthf.supabase.co/functions/v1/send-profit-digests',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbnRseXBsbWl0eGlhb3VudGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTg3MTQsImV4cCI6MjA4ODU3NDcxNH0.en6ActRrL5y9uV-GLw64gemQGpgywPVYpjt1Wfc3kgM')::jsonb,
    body := jsonb_build_object('source','cron')::jsonb
  );
  $$
);
