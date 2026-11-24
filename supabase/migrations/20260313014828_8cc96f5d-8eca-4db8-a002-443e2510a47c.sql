
-- Add momo_number and momo_name columns to affiliate_withdrawals
ALTER TABLE public.affiliate_withdrawals
  ADD COLUMN IF NOT EXISTS momo_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS momo_name text NOT NULL DEFAULT '';

-- Create a SECURITY DEFINER function for safe withdrawal requests
CREATE OR REPLACE FUNCTION public.request_affiliate_withdrawal(
  p_amount numeric,
  p_momo_number text,
  p_momo_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_customer_id uuid;
  v_available numeric;
  v_withdrawal_id uuid;
BEGIN
  -- Get customer
  SELECT id, available_commission INTO v_customer_id, v_available
  FROM public.customers
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  IF p_amount < 20 THEN
    RAISE EXCEPTION 'Minimum withdrawal amount is GHS 20';
  END IF;

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient commission balance';
  END IF;

  IF TRIM(p_momo_number) = '' THEN
    RAISE EXCEPTION 'MoMo number is required';
  END IF;

  IF TRIM(p_momo_name) = '' THEN
    RAISE EXCEPTION 'MoMo name is required';
  END IF;

  -- Deduct from available_commission
  UPDATE public.customers
  SET available_commission = available_commission - p_amount
  WHERE id = v_customer_id;

  -- Insert withdrawal request
  INSERT INTO public.affiliate_withdrawals (customer_id, amount, momo_number, momo_name, status)
  VALUES (v_customer_id, p_amount, TRIM(p_momo_number), TRIM(p_momo_name), 'pending')
  RETURNING id INTO v_withdrawal_id;

  RETURN json_build_object(
    'withdrawal_id', v_withdrawal_id,
    'new_available', v_available - p_amount
  );
END;
$$;
