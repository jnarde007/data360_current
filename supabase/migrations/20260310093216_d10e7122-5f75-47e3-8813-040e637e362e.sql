
-- Add foreign key from wallet_transactions.admin_id to admin_users.id
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES public.admin_users(id) ON DELETE SET NULL;
