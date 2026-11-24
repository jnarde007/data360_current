
-- 1) Owner notification preferences on customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) Rewrite trigger: NEW ORDERS no longer send SMS — only in-app notification.
--    First-sale detection still calls store-owner-notify (which sends the celebratory SMS).
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
  v_store_name text;
  v_order_count int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- In-app only: new sale notification for the owner
    SELECT o.short_id, s.name
      INTO v_short, v_store_name
      FROM public.orders o
      LEFT JOIN public.stores s ON s.id = NEW.store_id
     WHERE o.id = NEW.order_id;

    INSERT INTO public.notifications (target_type, target_id, type, title, message, metadata)
    VALUES (
      'customer',
      NEW.store_owner_id,
      'store_new_order',
      'New order',
      'New sale on ' || COALESCE(v_store_name, 'your store')
        || '. Order ' || COALESCE(v_short, '')
        || ' — GHS ' || to_char(NEW.amount_paid, 'FM999990.00')
        || ' (GHS ' || to_char(NEW.profit, 'FM999990.00') || ' profit unlocks on delivery).',
      jsonb_build_object('store_order_id', NEW.id, 'order_id', NEW.order_id, 'amount', NEW.amount_paid, 'profit', NEW.profit)
    );

    -- First-sale celebration: still SMS via edge function
    SELECT count(*) INTO v_order_count FROM public.store_orders WHERE store_id = NEW.store_id;
    IF v_order_count <= 1 THEN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon)::jsonb,
        body := jsonb_build_object('event','store_first_sale_only','store_order_id',NEW.id)::jsonb
      );
    END IF;

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
