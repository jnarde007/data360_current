
-- 1. Loosen validate trigger: only delivered & refunded are truly terminal.
CREATE OR REPLACE FUNCTION public.validate_store_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_terminal text[] := ARRAY['delivered','refunded'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.amount_paid IS NULL OR NEW.amount_paid <= 0 THEN
      RAISE EXCEPTION 'store_orders.amount_paid must be positive';
    END IF;
    IF NEW.profit IS NULL OR NEW.profit < 0 THEN
      RAISE EXCEPTION 'store_orders.profit must be >= 0 (got %)', NEW.profit;
    END IF;
    IF NEW.profit > NEW.amount_paid THEN
      RAISE EXCEPTION 'store_orders.profit (%) cannot exceed amount_paid (%)', NEW.profit, NEW.amount_paid;
    END IF;
    IF NEW.status NOT IN ('pending','processing','delivered','refunded','failed') THEN
      RAISE EXCEPTION 'Invalid store_orders.status: %', NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = ANY(v_terminal) AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'store_orders status "%" is terminal and cannot change', OLD.status;
  END IF;
  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    RAISE EXCEPTION 'store_orders.amount_paid is immutable';
  END IF;
  IF NEW.profit IS DISTINCT FROM OLD.profit THEN
    RAISE EXCEPTION 'store_orders.profit is immutable';
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.store_owner_id IS DISTINCT FROM OLD.store_owner_id THEN
    RAISE EXCEPTION 'store_orders ownership is immutable';
  END IF;
  RETURN NEW;
END $function$;

-- 2. Fix sync trigger to recover failed → delivered and credit profit.
CREATE OR REPLACE FUNCTION public.sync_store_order_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so RECORD;
  v_new_so_status text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT * INTO v_so FROM public.store_orders WHERE order_id = NEW.id;
  IF v_so.id IS NULL THEN RETURN NEW; END IF;

  -- In-flight: mirror upstream status into store_orders (skip if already delivered/refunded)
  IF NEW.status IN ('pending_confirmation','pending','pending_manual','awaiting_manual_fulfillment','submitting','submitted','processing') THEN
    v_new_so_status := CASE
      WHEN NEW.status IN ('processing','submitted','submitting') THEN 'processing'
      ELSE 'pending'
    END;
    IF v_so.status <> v_new_so_status AND v_so.status NOT IN ('delivered','refunded') THEN
      UPDATE public.store_orders SET status = v_new_so_status WHERE id = v_so.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Terminal delivered → credit owner wallet (covers fresh delivery AND failed-then-delivered recovery)
  IF NEW.status = 'delivered' AND v_so.status IN ('pending','processing') THEN
    UPDATE public.store_wallets
      SET pending_balance = GREATEST(pending_balance - v_so.profit, 0),
          available_balance = available_balance + v_so.profit,
          updated_at = now()
      WHERE owner_id = v_so.store_owner_id;
    UPDATE public.store_orders SET status = 'delivered' WHERE id = v_so.id;

  ELSIF NEW.status = 'delivered' AND v_so.status = 'failed' THEN
    -- Recovery path: order was previously marked failed (pending was already
    -- decremented at that time). Just credit the available balance.
    UPDATE public.store_wallets
      SET available_balance = available_balance + v_so.profit, updated_at = now()
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

-- 3. Back-fill ORD-4655: credit GHS 1.50 to KDK Bundle Hub owner wallet and mark store_order delivered.
DO $$
DECLARE
  v_so RECORD;
BEGIN
  SELECT so.id, so.store_owner_id, so.profit, so.status
    INTO v_so
  FROM public.store_orders so
  JOIN public.orders o ON o.id = so.order_id
  WHERE o.short_id = 'ORD-4655';

  IF v_so.id IS NOT NULL AND v_so.status = 'failed' THEN
    UPDATE public.store_wallets
      SET available_balance = available_balance + v_so.profit, updated_at = now()
      WHERE owner_id = v_so.store_owner_id;
    UPDATE public.store_orders SET status = 'delivered' WHERE id = v_so.id;
  END IF;
END $$;
