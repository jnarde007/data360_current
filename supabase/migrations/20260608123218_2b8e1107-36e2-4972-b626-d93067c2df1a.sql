
-- 1. Replace place_store_order_paystack: underlying order's total_amount = admin base price * qty
--    The store's selling price and profit remain on store_orders.
CREATE OR REPLACE FUNCTION public.place_store_order_paystack(
  p_store_slug text,
  p_price_item_id uuid,
  p_recipient_phone text,
  p_quantity integer,
  p_payment_reference text,
  p_buyer_phone text,
  p_buyer_email text DEFAULT ''
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_sp RECORD;
  v_item RECORD;
  v_qty integer;
  v_selling_total numeric;   -- buyer-facing (store) total
  v_admin_total numeric;     -- admin/platform base total
  v_profit numeric;
  v_order_result json;
  v_order_id uuid;
  v_existing_store_order RECORD;
BEGIN
  SELECT id, owner_id, name, status INTO v_store
  FROM public.stores WHERE slug = lower(trim(p_store_slug));
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_store.status <> 'active' THEN RAISE EXCEPTION 'Store is not active'; END IF;

  SELECT sp.selling_price, sp.active INTO v_sp
  FROM public.store_products sp
  WHERE sp.store_id = v_store.id AND sp.price_item_id = p_price_item_id;
  IF v_sp.selling_price IS NULL THEN RAISE EXCEPTION 'Product not available in this store'; END IF;
  IF NOT v_sp.active THEN RAISE EXCEPTION 'Product is inactive'; END IF;

  SELECT network, size, price, cost_price INTO v_item
  FROM public.price_items WHERE id = p_price_item_id;
  IF v_item.network IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  v_qty := GREATEST(p_quantity, 1);
  v_selling_total := v_sp.selling_price * v_qty;
  v_admin_total   := v_item.price * v_qty;
  v_profit        := (v_sp.selling_price - v_item.price) * v_qty;

  -- Idempotency
  SELECT so.id, so.order_id INTO v_existing_store_order
  FROM public.store_orders so
  JOIN public.orders o ON o.id = so.order_id
  WHERE o.payment_reference = p_payment_reference;
  IF v_existing_store_order.id IS NOT NULL THEN
    RETURN json_build_object('store_order_id', v_existing_store_order.id, 'order_id', v_existing_store_order.order_id, 'already_processed', true);
  END IF;

  -- Underlying order uses ADMIN base price as total_amount and TRUE supplier cost.
  v_order_result := public.place_order_guest_paystack(
    v_item.network, v_item.size, p_recipient_phone, v_qty,
    v_admin_total, p_payment_reference, p_buyer_phone, COALESCE(p_buyer_email,''),
    '', COALESCE(v_item.cost_price, v_item.price), 'manual', ''
  );
  v_order_id := (v_order_result->>'order_id')::uuid;

  INSERT INTO public.store_orders(store_id, store_owner_id, price_item_id, order_id, buyer_phone, amount_paid, profit, status)
  VALUES (v_store.id, v_store.owner_id, p_price_item_id, v_order_id,
          regexp_replace(p_buyer_phone,'[^0-9]','','g'), v_selling_total, v_profit, 'pending')
  RETURNING id INTO v_existing_store_order.id;

  INSERT INTO public.store_wallets(owner_id, pending_balance)
  VALUES (v_store.owner_id, v_profit)
  ON CONFLICT (owner_id) DO UPDATE
    SET pending_balance = public.store_wallets.pending_balance + EXCLUDED.pending_balance, updated_at = now();

  RETURN json_build_object(
    'store_order_id', v_existing_store_order.id,
    'order_id', v_order_id,
    'tracking_token', v_order_result->>'tracking_token',
    'short_id', v_order_result->>'short_id'
  );
END $$;

-- 2. Backfill existing store orders: set orders.total_amount = price_items.price * quantity,
--    and orders.cost_price = price_items.cost_price (if currently equals the platform base).
UPDATE public.orders o
SET total_amount = pi.price * GREATEST(o.quantity, 1),
    cost_price   = COALESCE(pi.cost_price, pi.price)
FROM public.store_orders so
JOIN public.price_items pi ON pi.id = so.price_item_id
WHERE so.order_id = o.id
  AND o.total_amount <> pi.price * GREATEST(o.quantity, 1);
