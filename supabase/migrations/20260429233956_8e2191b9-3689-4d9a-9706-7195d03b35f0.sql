ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS afa_registration_id uuid;
ALTER TABLE public.refunds ALTER COLUMN order_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_afa_unique_active
  ON public.refunds (afa_registration_id)
  WHERE afa_registration_id IS NOT NULL AND status <> 'refund_failed';