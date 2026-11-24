
-- Column-level grants need explicit re-grant after revoke
GRANT UPDATE (full_name, phone, transaction_pin_hash) ON public.customers TO authenticated;
