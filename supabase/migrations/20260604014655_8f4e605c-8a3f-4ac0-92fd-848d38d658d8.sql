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

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    )::jsonb,
    body := jsonb_build_object('event', v_event, 'store_order_id', NEW.id)::jsonb
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_store_owner_notify failed: %', SQLERRM;
  RETURN NEW;
END $$;