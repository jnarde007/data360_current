CREATE OR REPLACE FUNCTION public._has_active_order_for_recipient(p_network text, p_recipient_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE recipient_phone = regexp_replace(p_recipient_phone, '[^0-9]', '', 'g')
      AND network = p_network
      AND status NOT IN (
        'delivered',
        'failed',
        'rejected',
        'refunded',
        'cancelled',
        'customer_cancelled',
        'cancelled_before_processing'
      )
  );
$function$;