
-- Predefined tag options for customer categorization
CREATE TABLE public.customer_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (customer_id, tag)
);

ALTER TABLE public.customer_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read customer_tags" ON public.customer_tags
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY "Admins insert customer_tags" ON public.customer_tags
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete customer_tags" ON public.customer_tags
  FOR DELETE TO authenticated USING (public.is_admin());

CREATE INDEX idx_customer_tags_customer_id ON public.customer_tags(customer_id);
