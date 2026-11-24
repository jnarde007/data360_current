
CREATE TABLE public.price_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  network TEXT NOT NULL,
  product TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '',
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.price_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read price_items" ON public.price_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert price_items" ON public.price_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update price_items" ON public.price_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete price_items" ON public.price_items FOR DELETE TO authenticated USING (true);

-- Also allow public read for customer-facing pages
CREATE POLICY "Allow public read price_items" ON public.price_items FOR SELECT TO anon USING (true);
