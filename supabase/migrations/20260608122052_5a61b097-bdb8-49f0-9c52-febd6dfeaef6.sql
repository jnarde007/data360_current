CREATE OR REPLACE FUNCTION public.sync_store_order_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_so RECORD;
  v_new_so_status text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT * INTO v_so FROM public.store_orders WHERE order_id = NEW.id;
  IF v_so.id IS NULL THEN RETURN NEW; END IF;

  -- Mirror in-flight statuses into store_orders so owners/buyers see real-time progress
  IF NEW.status IN ('pending_confirmation','pending','pending_manual','awaiting_manual_fulfillment','submitting','submitted','processing') THEN
    v_new_so_status := CASE
      WHEN NEW.status IN ('processing','submitted','submitting') THEN 'processing'
      ELSE 'pending'
    END;
    IF v_so.status <> v_new_so_status AND v_so.status NOT IN ('delivered','failed','refunded') THEN
      UPDATE public.store_orders SET status = v_new_so_status WHERE id = v_so.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Terminal: delivered → credit owner wallet
  IF NEW.status = 'delivered' AND v_so.status IN ('pending','processing') THEN
    UPDATE public.store_wallets
      SET pending_balance = GREATEST(pending_balance - v_so.profit, 0),
          available_balance = available_balance + v_so.profit,
          updated_at = now()
      WHERE owner_id = v_so.store_owner_id;
    UPDATE public.store_orders SET status = 'delivered' WHERE id = v_so.id;
  ELSIF NEW.status IN ('rejected','refunded','customer_cancelled','cancelled_before_processing','failed')
        AND v_so.status IN ('pending','processing') THEN
    UPDATE public.store_wallets
      SET pending_balance = GREATEST(pending_balance - v_so.profit, 0), updated_at = now()
      WHERE owner_id = v_so.store_owner_id;
    UPDATE public.store_orders
      SET status = CASE WHEN NEW.status='failed' THEN 'failed' ELSE 'refunded' END
      WHERE id = v_so.id;
  END IF;

  RETURN NEW;
END $function$;

-- Backfill any currently in-flight store orders so the UI catches up immediately
UPDATE public.store_orders so
SET status = 'processing'
FROM public.orders o
WHERE so.order_id = o.id
  AND so.status = 'pending'
  AND o.status IN ('processing','submitted','submitting');