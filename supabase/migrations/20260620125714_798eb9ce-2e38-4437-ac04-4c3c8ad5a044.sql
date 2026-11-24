CREATE OR REPLACE FUNCTION public.check_recipient_availability(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_network text;
  v_phone text;
  v_normalized text;
  v_existing_short text;
  v_existing_status text;
  v_results jsonb := '[]'::jsonb;
  v_blocked_count int := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('blocked', false, 'blocked_count', 0, 'items', '[]'::jsonb);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_network := v_item->>'network';
    v_phone := v_item->>'phone';
    v_normalized := regexp_replace(COALESCE(v_phone,''), '[^0-9]', '', 'g');

    v_existing_short := NULL;
    v_existing_status := NULL;

    -- Only block if there is a non-terminal (in-flight) order for this
    -- recipient on the same network. Terminal statuses (delivered, failed,
    -- rejected, refunded, customer_cancelled, cancelled_before_processing,
    -- and the legacy 'cancelled') must NEVER block a new purchase.
    SELECT short_id, status
      INTO v_existing_short, v_existing_status
    FROM public.orders
    WHERE recipient_phone = v_normalized
      AND network = v_network
      AND status NOT IN (
        'delivered',
        'failed',
        'rejected',
        'refunded',
        'cancelled',
        'customer_cancelled',
        'cancelled_before_processing'
      )
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_short IS NOT NULL THEN
      v_blocked_count := v_blocked_count + 1;
      v_results := v_results || jsonb_build_object(
        'phone', v_normalized,
        'network', v_network,
        'blocked', true,
        'existing_order_short_id', v_existing_short,
        'existing_status', v_existing_status
      );
    ELSE
      v_results := v_results || jsonb_build_object(
        'phone', v_normalized,
        'network', v_network,
        'blocked', false
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'blocked', v_blocked_count > 0,
    'blocked_count', v_blocked_count,
    'items', v_results
  );
END;
$function$;