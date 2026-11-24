
CREATE TABLE public.admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL,
  admin_name text NOT NULL DEFAULT '',
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read admin_notes"
  ON public.admin_notes FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert admin_notes"
  ON public.admin_notes FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete admin_notes"
  ON public.admin_notes FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE INDEX idx_admin_notes_customer ON public.admin_notes(customer_id);
