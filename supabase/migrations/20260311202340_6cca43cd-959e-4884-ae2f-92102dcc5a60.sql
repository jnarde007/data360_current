CREATE OR REPLACE FUNCTION public.enforce_terminal_order_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  terminal_statuses text[] := ARRAY['delivered', 'rejected', 'refunded', 'customer_cancelled', 'cancelled_before_processing'];
BEGIN
  IF OLD.status = ANY(terminal_statuses) AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cannot change order status from terminal status "%". This order is permanently closed.', OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;