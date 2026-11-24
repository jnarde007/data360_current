-- Send store-owner SMS notifications via the store-owner-notify edge function.
-- Triggered for two events:
--   * store_new_order        — on INSERT into store_orders (buyer just paid)
--   * store_profit_available — when store_orders.status flips to 'delivered'

CREATE OR REPLACE FUNCTION public.trg_store_owner_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
  v_url text := 'https://bpntlyplmitxiaounthf.supabase.co/functions/v1/store-owner-notify';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbnRseXBsbWl0eGlhb3VudGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTg3MTQsImV4cCI6MjA4ODU3NDcxNH0.en6ActRrL5y9uV-GLw64gemQGpgywPVYpjt1Wfc3kgM';
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'store_new_order';
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    v_event := 'store_profit_available';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM extensions.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('event', v_event, 'store_order_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the underlying transaction if HTTP fails
  RAISE WARNING 'trg_store_owner_notify failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_orders_owner_notify ON public.store_orders;
CREATE TRIGGER trg_store_orders_owner_notify
  AFTER INSERT OR UPDATE OF status ON public.store_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_store_owner_notify();