ALTER TABLE public.store_orders DROP CONSTRAINT store_orders_kind_check;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_kind_check CHECK (
  (kind = 'data' AND (price_item_id IS NOT NULL OR order_id IS NOT NULL))
  OR (kind = 'checker' AND (checker_product_id IS NOT NULL OR checker_purchase_id IS NOT NULL))
  OR (kind = 'afa' AND afa_registration_id IS NOT NULL)
);