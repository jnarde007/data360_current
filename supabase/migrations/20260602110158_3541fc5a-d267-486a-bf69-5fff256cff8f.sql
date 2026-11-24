-- Remove sensitive tables from realtime publication so authenticated users cannot subscribe and receive row payloads
ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_users;
ALTER PUBLICATION supabase_realtime DROP TABLE public.network_api_configs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.checker_inventory;
ALTER PUBLICATION supabase_realtime DROP TABLE public.price_items;