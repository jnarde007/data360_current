
-- ============================================================
-- 1. Column additions for fund locking
-- ============================================================
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS locked_commission numeric NOT NULL DEFAULT 0;

ALTER TABLE public.store_wallets
  ADD COLUMN IF NOT EXISTS locked_balance numeric(12,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 2. Unified payouts table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id text NOT NULL DEFAULT ('PO-' || upper(substring(replace(gen_random_uuid()::text,'-','') for 8))),
  payout_type text NOT NULL CHECK (payout_type IN ('affiliate','store')),
  owner_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,

  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  net_amount numeric(12,2) NOT NULL CHECK (net_amount > 0),

  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','processing','success','failed','reversed','cancelled')),
  rail text NOT NULL DEFAULT 'paystack' CHECK (rail IN ('paystack','momo_manual')),

  -- Recipient details
  recipient_type text NOT NULL DEFAULT 'mobile_money' CHECK (recipient_type IN ('mobile_money','ghipss')),
  momo_number text NOT NULL DEFAULT '',
  momo_name text NOT NULL DEFAULT '',
  network text NOT NULL DEFAULT '' CHECK (network IN ('','MTN','VOD','ATL')),
  bank_code text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',

  -- Paystack references
  paystack_recipient_code text,
  paystack_transfer_code text,
  paystack_transfer_reference text UNIQUE,
  paystack_response jsonb,

  -- Operational
  idempotency_key text NOT NULL UNIQUE,
  failure_reason text DEFAULT '',
  admin_note text NOT NULL DEFAULT '',

  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  processed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payouts_owner ON public.payouts(owner_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON public.payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_type_status ON public.payouts(payout_type, status);
CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON public.payouts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_transfer_ref ON public.payouts(paystack_transfer_reference);
CREATE INDEX IF NOT EXISTS idx_payouts_processing ON public.payouts(status) WHERE status IN ('processing','approved');

GRANT SELECT ON public.payouts TO authenticated;
GRANT ALL ON public.payouts TO service_role;

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read own payouts"
  ON public.payouts FOR SELECT TO authenticated
  USING (owner_id = public.get_my_customer_id() OR public.is_admin());

CREATE POLICY "Admins update payouts"
  ON public.payouts FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TRIGGER trg_payouts_updated
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 3. Paystack recipient cache
-- ============================================================
CREATE TABLE IF NOT EXISTS public.paystack_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  recipient_type text NOT NULL DEFAULT 'mobile_money' CHECK (recipient_type IN ('mobile_money','ghipss')),
  network text NOT NULL DEFAULT '',
  bank_code text NOT NULL DEFAULT '',
  account_number text NOT NULL,
  account_name text NOT NULL DEFAULT '',
  recipient_code text NOT NULL,
  paystack_response jsonb,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paystack_recipients_unique
  ON public.paystack_recipients(customer_id, account_number, bank_code)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_paystack_recipients_customer ON public.paystack_recipients(customer_id);

GRANT SELECT ON public.paystack_recipients TO authenticated;
GRANT ALL ON public.paystack_recipients TO service_role;

ALTER TABLE public.paystack_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read own recipients"
  ON public.paystack_recipients FOR SELECT TO authenticated
  USING (customer_id = public.get_my_customer_id() OR public.is_admin());

-- ============================================================
-- 4. Audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payout_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.payouts(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('customer','admin','system','webhook')),
  prev_status text,
  new_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_logs_payout ON public.payout_audit_logs(payout_id);
CREATE INDEX IF NOT EXISTS idx_payout_audit_logs_created ON public.payout_audit_logs(created_at DESC);

GRANT SELECT ON public.payout_audit_logs TO authenticated;
GRANT ALL ON public.payout_audit_logs TO service_role;

ALTER TABLE public.payout_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit logs"
  ON public.payout_audit_logs FOR SELECT TO authenticated
  USING (public.is_admin());

-- ============================================================
-- 5. Helper: append audit row
-- ============================================================
CREATE OR REPLACE FUNCTION public.payout_audit(
  p_payout_id uuid,
  p_action text,
  p_actor_id uuid,
  p_actor_type text,
  p_prev_status text,
  p_new_status text,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payout_audit_logs(payout_id, action, actor_id, actor_type, prev_status, new_status, details)
  VALUES (p_payout_id, p_action, p_actor_id, p_actor_type, p_prev_status, p_new_status, COALESCE(p_details,'{}'::jsonb));
END;
$$;

-- ============================================================
-- 6. RPC: request_affiliate_payout
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_affiliate_payout(
  p_amount numeric,
  p_momo_number text,
  p_momo_name text,
  p_network text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid := public.get_my_customer_id();
  v_min numeric;
  v_enabled boolean;
  v_available numeric;
  v_payout_id uuid;
  v_idem text;
  v_existing public.payouts%ROWTYPE;
BEGIN
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('error','Not authenticated');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error','Invalid amount');
  END IF;

  IF p_network NOT IN ('MTN','VOD','ATL') THEN
    RETURN jsonb_build_object('error','Invalid network. Must be MTN, VOD, or ATL');
  END IF;

  IF length(trim(p_momo_number)) < 9 THEN
    RETURN jsonb_build_object('error','Invalid mobile money number');
  END IF;

  SELECT (value)::numeric INTO v_min FROM public.platform_settings WHERE key='payout_min_affiliate';
  IF v_min IS NULL THEN v_min := 20; END IF;
  IF p_amount < v_min THEN
    RETURN jsonb_build_object('error', format('Minimum withdrawal is GHS %s', v_min));
  END IF;

  SELECT (value)::boolean INTO v_enabled FROM public.platform_settings WHERE key='payouts_enabled_affiliate';
  IF v_enabled IS FALSE THEN
    RETURN jsonb_build_object('error','Affiliate payouts are temporarily disabled');
  END IF;

  v_idem := COALESCE(p_idempotency_key, 'aff-' || v_customer_id::text || '-' || extract(epoch from now())::bigint::text);

  -- Idempotency: return existing if same key already produced a payout
  SELECT * INTO v_existing FROM public.payouts WHERE idempotency_key = v_idem;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'payout_id', v_existing.id, 'already_processed', true, 'status', v_existing.status);
  END IF;

  -- Lock the customer row, check balance, move funds available -> locked
  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;
  SELECT available_commission INTO v_available FROM public.customers WHERE id = v_customer_id;

  IF v_available < p_amount THEN
    RETURN jsonb_build_object('error', 'Insufficient available commission');
  END IF;

  UPDATE public.customers
     SET available_commission = available_commission - p_amount,
         locked_commission = locked_commission + p_amount
   WHERE id = v_customer_id;

  INSERT INTO public.payouts(
    payout_type, owner_id, amount, fee, net_amount,
    status, rail,
    recipient_type, momo_number, momo_name, network,
    idempotency_key, requested_by
  ) VALUES (
    'affiliate', v_customer_id, p_amount, 0, p_amount,
    'pending_approval', 'paystack',
    'mobile_money', p_momo_number, p_momo_name, p_network,
    v_idem, v_customer_id
  ) RETURNING id INTO v_payout_id;

  PERFORM public.payout_audit(v_payout_id, 'requested', v_customer_id, 'customer', NULL, 'pending_approval',
    jsonb_build_object('amount', p_amount, 'network', p_network));

  RETURN jsonb_build_object('success', true, 'payout_id', v_payout_id, 'status', 'pending_approval');
END;
$$;

-- ============================================================
-- 7. RPC: admin_create_store_payout (admin-only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_create_store_payout(
  p_owner_id uuid,
  p_amount numeric,
  p_momo_number text,
  p_momo_name text,
  p_network text,
  p_admin_note text DEFAULT '',
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_min numeric;
  v_enabled boolean;
  v_available numeric;
  v_payout_id uuid;
  v_idem text;
  v_existing public.payouts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error','Invalid amount');
  END IF;

  IF p_network NOT IN ('MTN','VOD','ATL') THEN
    RETURN jsonb_build_object('error','Invalid network');
  END IF;

  SELECT (value)::numeric INTO v_min FROM public.platform_settings WHERE key='payout_min_store';
  IF v_min IS NULL THEN v_min := 20; END IF;
  IF p_amount < v_min THEN
    RETURN jsonb_build_object('error', format('Minimum store payout is GHS %s', v_min));
  END IF;

  SELECT (value)::boolean INTO v_enabled FROM public.platform_settings WHERE key='payouts_enabled_store';
  IF v_enabled IS FALSE THEN
    RETURN jsonb_build_object('error','Store payouts are temporarily disabled');
  END IF;

  v_idem := COALESCE(p_idempotency_key, 'store-' || p_owner_id::text || '-' || extract(epoch from now())::bigint::text);

  SELECT * INTO v_existing FROM public.payouts WHERE idempotency_key = v_idem;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'payout_id', v_existing.id, 'already_processed', true, 'status', v_existing.status);
  END IF;

  -- Ensure store wallet row exists, lock it, move funds available -> locked
  INSERT INTO public.store_wallets(owner_id) VALUES (p_owner_id) ON CONFLICT (owner_id) DO NOTHING;
  PERFORM 1 FROM public.store_wallets WHERE owner_id = p_owner_id FOR UPDATE;
  SELECT available_balance INTO v_available FROM public.store_wallets WHERE owner_id = p_owner_id;

  IF v_available < p_amount THEN
    RETURN jsonb_build_object('error','Insufficient store available balance');
  END IF;

  UPDATE public.store_wallets
     SET available_balance = available_balance - p_amount,
         locked_balance = locked_balance + p_amount,
         updated_at = now()
   WHERE owner_id = p_owner_id;

  INSERT INTO public.payouts(
    payout_type, owner_id, amount, fee, net_amount,
    status, rail,
    recipient_type, momo_number, momo_name, network,
    idempotency_key, requested_by, admin_note
  ) VALUES (
    'store', p_owner_id, p_amount, 0, p_amount,
    'pending_approval', 'paystack',
    'mobile_money', p_momo_number, p_momo_name, p_network,
    v_idem, v_admin_id, COALESCE(p_admin_note,'')
  ) RETURNING id INTO v_payout_id;

  PERFORM public.payout_audit(v_payout_id, 'admin_created', v_admin_id, 'admin', NULL, 'pending_approval',
    jsonb_build_object('amount', p_amount, 'network', p_network));

  RETURN jsonb_build_object('success', true, 'payout_id', v_payout_id, 'status', 'pending_approval');
END;
$$;

-- ============================================================
-- 8. RPC: admin_approve_payout (admin -> approved, ready for transfer)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_approve_payout(
  p_payout_id uuid,
  p_rail text DEFAULT 'paystack'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_payout public.payouts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  IF p_rail NOT IN ('paystack','momo_manual') THEN
    RETURN jsonb_build_object('error','Invalid rail');
  END IF;

  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Payout not found'); END IF;
  IF v_payout.status <> 'pending_approval' THEN
    RETURN jsonb_build_object('error', format('Cannot approve payout in status %s', v_payout.status));
  END IF;

  UPDATE public.payouts
     SET status = 'approved',
         rail = p_rail,
         approved_by = v_admin_id,
         approved_at = now()
   WHERE id = p_payout_id;

  PERFORM public.payout_audit(p_payout_id, 'approved', v_admin_id, 'admin', 'pending_approval', 'approved',
    jsonb_build_object('rail', p_rail));

  RETURN jsonb_build_object('success', true, 'payout_id', p_payout_id, 'status', 'approved', 'rail', p_rail);
END;
$$;

-- ============================================================
-- 9. RPC: admin_cancel_payout (releases lock back to available)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cancel_payout(
  p_payout_id uuid,
  p_reason text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_payout public.payouts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Payout not found'); END IF;
  IF v_payout.status NOT IN ('pending_approval','approved') THEN
    RETURN jsonb_build_object('error', format('Cannot cancel payout in status %s', v_payout.status));
  END IF;

  -- Release lock back to available
  IF v_payout.payout_type = 'affiliate' THEN
    UPDATE public.customers
       SET available_commission = available_commission + v_payout.amount,
           locked_commission = locked_commission - v_payout.amount
     WHERE id = v_payout.owner_id;
  ELSE
    UPDATE public.store_wallets
       SET available_balance = available_balance + v_payout.amount,
           locked_balance = locked_balance - v_payout.amount,
           updated_at = now()
     WHERE owner_id = v_payout.owner_id;
  END IF;

  UPDATE public.payouts
     SET status = 'cancelled',
         cancelled_at = now(),
         failure_reason = COALESCE(p_reason,''),
         admin_note = CASE WHEN length(coalesce(p_reason,''))>0 THEN p_reason ELSE admin_note END
   WHERE id = p_payout_id;

  PERFORM public.payout_audit(p_payout_id, 'cancelled', v_admin_id, 'admin', v_payout.status, 'cancelled',
    jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('success', true, 'status','cancelled');
END;
$$;

-- ============================================================
-- 10. RPC: mark_payout_processing (called by edge fn after Paystack accepts)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_payout_processing(
  p_payout_id uuid,
  p_recipient_code text,
  p_transfer_code text,
  p_transfer_reference text,
  p_response jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.payouts%ROWTYPE;
BEGIN
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Payout not found'); END IF;
  IF v_payout.status NOT IN ('approved','processing') THEN
    RETURN jsonb_build_object('error', format('Cannot mark processing from status %s', v_payout.status));
  END IF;

  UPDATE public.payouts
     SET status = 'processing',
         paystack_recipient_code = p_recipient_code,
         paystack_transfer_code = p_transfer_code,
         paystack_transfer_reference = p_transfer_reference,
         paystack_response = COALESCE(p_response, paystack_response),
         processed_at = COALESCE(processed_at, now())
   WHERE id = p_payout_id;

  PERFORM public.payout_audit(p_payout_id, 'transfer_initiated', NULL, 'system', v_payout.status, 'processing',
    jsonb_build_object('transfer_code', p_transfer_code, 'reference', p_transfer_reference));

  RETURN jsonb_build_object('success', true, 'status','processing');
END;
$$;

-- ============================================================
-- 11. RPC: apply_payout_success (webhook -> finalize debit)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_payout_success(
  p_payout_id uuid,
  p_response jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.payouts%ROWTYPE;
BEGIN
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Payout not found'); END IF;
  IF v_payout.status = 'success' THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;
  IF v_payout.status NOT IN ('processing','approved') THEN
    RETURN jsonb_build_object('error', format('Cannot mark success from status %s', v_payout.status));
  END IF;

  -- Finalize: remove from locked, add to withdrawn / total decrement
  IF v_payout.payout_type = 'affiliate' THEN
    UPDATE public.customers
       SET locked_commission = locked_commission - v_payout.amount,
           total_commission = GREATEST(total_commission - v_payout.amount, 0)
     WHERE id = v_payout.owner_id;
  ELSE
    UPDATE public.store_wallets
       SET locked_balance = locked_balance - v_payout.amount,
           withdrawn_balance = withdrawn_balance + v_payout.amount,
           updated_at = now()
     WHERE owner_id = v_payout.owner_id;
  END IF;

  UPDATE public.payouts
     SET status = 'success',
         completed_at = now(),
         paystack_response = COALESCE(p_response, paystack_response)
   WHERE id = p_payout_id;

  PERFORM public.payout_audit(p_payout_id, 'transfer_success', NULL, 'webhook', v_payout.status, 'success', '{}'::jsonb);

  RETURN jsonb_build_object('success', true, 'status','success');
END;
$$;

-- ============================================================
-- 12. RPC: apply_payout_failure (webhook -> release lock)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_payout_failure(
  p_payout_id uuid,
  p_new_status text,
  p_reason text,
  p_response jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.payouts%ROWTYPE;
BEGIN
  IF p_new_status NOT IN ('failed','reversed') THEN
    RETURN jsonb_build_object('error','Invalid failure status');
  END IF;

  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Payout not found'); END IF;
  IF v_payout.status IN ('failed','reversed','cancelled') THEN
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END IF;

  -- Release lock back to available (or undo a previous success on reversal)
  IF v_payout.status = 'success' AND p_new_status = 'reversed' THEN
    -- Reversal of a previously successful payout: credit back to available, restore total
    IF v_payout.payout_type = 'affiliate' THEN
      UPDATE public.customers
         SET available_commission = available_commission + v_payout.amount,
             total_commission = total_commission + v_payout.amount
       WHERE id = v_payout.owner_id;
    ELSE
      UPDATE public.store_wallets
         SET available_balance = available_balance + v_payout.amount,
             withdrawn_balance = GREATEST(withdrawn_balance - v_payout.amount, 0),
             updated_at = now()
       WHERE owner_id = v_payout.owner_id;
    END IF;
  ELSE
    -- Funds were locked, never debited: release back to available
    IF v_payout.payout_type = 'affiliate' THEN
      UPDATE public.customers
         SET available_commission = available_commission + v_payout.amount,
             locked_commission = GREATEST(locked_commission - v_payout.amount, 0)
       WHERE id = v_payout.owner_id;
    ELSE
      UPDATE public.store_wallets
         SET available_balance = available_balance + v_payout.amount,
             locked_balance = GREATEST(locked_balance - v_payout.amount, 0),
             updated_at = now()
       WHERE owner_id = v_payout.owner_id;
    END IF;
  END IF;

  UPDATE public.payouts
     SET status = p_new_status,
         failure_reason = COALESCE(p_reason,''),
         completed_at = now(),
         paystack_response = COALESCE(p_response, paystack_response)
   WHERE id = p_payout_id;

  PERFORM public.payout_audit(p_payout_id, 'transfer_' || p_new_status, NULL, 'webhook', v_payout.status, p_new_status,
    jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('success', true, 'status', p_new_status);
END;
$$;

-- Permission grants for RPCs
REVOKE ALL ON FUNCTION public.request_affiliate_payout(numeric, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_affiliate_payout(numeric, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_create_store_payout(uuid, numeric, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_create_store_payout(uuid, numeric, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_approve_payout(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_approve_payout(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_cancel_payout(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_cancel_payout(uuid, text) TO authenticated;

-- These are called only by edge functions (service_role)
REVOKE ALL ON FUNCTION public.mark_payout_processing(uuid, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_payout_processing(uuid, text, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.apply_payout_success(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_payout_success(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.apply_payout_failure(uuid, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_payout_failure(uuid, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.payout_audit(uuid, text, uuid, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.payout_audit(uuid, text, uuid, text, text, text, jsonb) TO service_role;

-- ============================================================
-- 13. Default settings
-- ============================================================
INSERT INTO public.platform_settings(key, value) VALUES
  ('payouts_enabled_affiliate','true'),
  ('payouts_enabled_store','true'),
  ('payout_min_affiliate','20'),
  ('payout_min_store','20'),
  ('payout_fee_pct','0'),
  ('payout_fee_flat','0'),
  ('payout_auto_approve','false'),
  ('payout_momo_fallback_enabled','true')
ON CONFLICT (key) DO NOTHING;

-- Add to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.payouts;
