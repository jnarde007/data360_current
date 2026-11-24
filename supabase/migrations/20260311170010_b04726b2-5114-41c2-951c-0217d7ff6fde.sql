
-- Drop the ambiguous 7-parameter overload, keep only the 9-parameter version
DROP FUNCTION IF EXISTS public.place_order(uuid, text, text, text, integer, numeric, numeric);
