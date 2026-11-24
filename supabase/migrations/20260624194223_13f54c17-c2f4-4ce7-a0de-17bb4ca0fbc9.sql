-- Fix This Week, Migration 1/3: Performance indexes for hot read paths.

CREATE INDEX IF NOT EXISTS idx_notifications_target_created
  ON public.notifications (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON public.orders (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_created_desc
  ON public.orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_orders_order_id
  ON public.store_orders (order_id);
