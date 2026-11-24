ALTER TABLE public.store_orders DROP CONSTRAINT store_orders_price_item_id_fkey;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_price_item_id_fkey FOREIGN KEY (price_item_id) REFERENCES public.price_items(id) ON DELETE SET NULL;
ALTER TABLE public.store_orders DROP CONSTRAINT IF EXISTS store_orders_checker_product_id_fkey;
ALTER TABLE public.store_orders ADD CONSTRAINT store_orders_checker_product_id_fkey FOREIGN KEY (checker_product_id) REFERENCES public.checker_products(id) ON DELETE SET NULL;