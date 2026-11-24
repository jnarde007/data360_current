CREATE TABLE public.mtn_provider_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_provider text NOT NULL DEFAULT 'Portal-02' CHECK (active_provider IN ('Portal-02', 'iGet')),
  iget_bundle_type text NOT NULL DEFAULT 'mtnup2u' CHECK (iget_bundle_type IN ('mtnup2u','mtn-justforu','mtn-fibre')),
  switched_at timestamptz,
  switched_by uuid
);
GRANT SELECT ON public.mtn_provider_settings TO authenticated;
GRANT ALL ON public.mtn_provider_settings TO service_role;
ALTER TABLE public.mtn_provider_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read MTN provider settings" ON public.mtn_provider_settings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id=auth.uid() AND status='active' AND role='Super Admin'));

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_bundle_type text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_submission_reference text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_submission_started_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_submission_uncertain boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_purchase_cost numeric;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_transaction_reference text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_completed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_routing_version integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX orders_provider_submission_reference_unique ON public.orders(provider_name,provider_submission_reference) WHERE provider_submission_reference IS NOT NULL;
COMMENT ON COLUMN public.orders.provider_purchase_cost IS 'Provider-confirmed purchase cost; distinct from configured cost_price, never a customer wallet balance.';
COMMENT ON COLUMN public.orders.provider_routing_version IS 'Version 0 denotes a legacy order; version 1 pins MTN provider at creation.';

CREATE OR REPLACE FUNCTION public.pin_mtn_order_provider() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_settings public.mtn_provider_settings%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.network='MTN' THEN
      SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true FOR SHARE;
      NEW.provider_name:=COALESCE(v_settings.active_provider,'Portal-02');
      NEW.provider_bundle_type:=CASE WHEN NEW.provider_name='iGet' THEN COALESCE(v_settings.iget_bundle_type,'mtnup2u') ELSE NULL END;
      NEW.provider_routing_version:=1;
      NEW.provider_submission_reference:=NULL;
      NEW.provider_submission_started_at:=NULL;
      NEW.provider_submission_uncertain:=false;
      IF NEW.provider_name='iGet' THEN
        RAISE EXCEPTION 'IGET_DOCUMENTATION_PENDING: MTN iGet activation requires verified tracking and idempotency documentation';
      END IF;
    END IF;
  ELSIF OLD.network='MTN' AND OLD.provider_routing_version=1 THEN
    IF NEW.provider_name IS DISTINCT FROM OLD.provider_name OR NEW.provider_bundle_type IS DISTINCT FROM OLD.provider_bundle_type OR NEW.network IS DISTINCT FROM OLD.network OR NEW.provider_routing_version IS DISTINCT FROM OLD.provider_routing_version THEN
      RAISE EXCEPTION 'MTN provider and bundle type are immutable after order creation';
    END IF;
    IF OLD.provider_submission_reference IS NOT NULL AND NEW.provider_submission_reference IS DISTINCT FROM OLD.provider_submission_reference THEN
      RAISE EXCEPTION 'Provider submission reference is immutable';
    END IF;
    IF OLD.provider_submission_started_at IS NOT NULL AND NEW.provider_submission_started_at IS DISTINCT FROM OLD.provider_submission_started_at THEN
      RAISE EXCEPTION 'Provider submission start is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pin_mtn_order_provider() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_pin_mtn_order_provider BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.pin_mtn_order_provider();

CREATE OR REPLACE FUNCTION public.admin_get_mtn_provider_management() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_settings public.mtn_provider_settings%ROWTYPE; v_balance public.provider_balance_current%ROWTYPE; v_configured boolean; v_admin_name text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE auth_user_id=auth.uid() AND status='active' AND role='Super Admin') THEN RAISE EXCEPTION 'Super Admin access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true;
  SELECT * INTO v_balance FROM public.provider_balance_current WHERE provider='Portal-02';
  SELECT EXISTS(SELECT 1 FROM public.network_api_configs WHERE network='MTN' AND api_base_url<>'' AND api_key<>'') INTO v_configured;
  SELECT name INTO v_admin_name FROM public.admin_users WHERE id=v_settings.switched_by;
  RETURN jsonb_build_object('active_provider',COALESCE(v_settings.active_provider,'Portal-02'),'iget_bundle_type',COALESCE(v_settings.iget_bundle_type,'mtnup2u'),'switched_at',v_settings.switched_at,'switched_by_name',v_admin_name,'portal_configured',v_configured,'portal_last_check',v_balance.last_checked_at,'portal_last_status',v_balance.status,'iget_activation_ready',false,'iget_connection_status','unverified','iget_blocker','Official tracking, authentication and timeout/idempotency documentation required');
END $$;
REVOKE ALL ON FUNCTION public.admin_get_mtn_provider_management() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_mtn_provider_management() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_switch_mtn_provider(p_provider text,p_bundle_type text,p_expected_provider text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_admin_id uuid; v_settings public.mtn_provider_settings%ROWTYPE;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE auth_user_id=auth.uid() AND status='active' AND role='Super Admin';
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Super Admin access required' USING ERRCODE='42501'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('Portal-02','iGet') OR p_bundle_type IS NULL OR p_bundle_type NOT IN ('mtnup2u','mtn-justforu','mtn-fibre') THEN RAISE EXCEPTION 'Invalid MTN provider or bundle type' USING ERRCODE='22023'; END IF;
  IF p_provider='iGet' THEN RAISE EXCEPTION 'IGET_DOCUMENTATION_PENDING: MTN iGet activation requires verified tracking and idempotency documentation'; END IF;
  INSERT INTO public.mtn_provider_settings(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;
  SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true FOR UPDATE;
  IF p_expected_provider IS DISTINCT FROM v_settings.active_provider THEN RAISE EXCEPTION 'Provider changed by another administrator; refresh and confirm again'; END IF;
  IF p_provider=v_settings.active_provider AND p_bundle_type=v_settings.iget_bundle_type THEN RETURN public.admin_get_mtn_provider_management(); END IF;
  UPDATE public.mtn_provider_settings SET active_provider=p_provider,iget_bundle_type=p_bundle_type,switched_at=now(),switched_by=v_admin_id WHERE singleton=true;
  INSERT INTO public.admin_activity_logs(admin_id,action,target_type,target_id,details) VALUES(v_admin_id,'switch_mtn_provider','mtn_provider','MTN',jsonb_build_object('previous_provider',v_settings.active_provider,'new_provider',p_provider,'bundle_type',p_bundle_type));
  RETURN public.admin_get_mtn_provider_management();
END $$;
REVOKE ALL ON FUNCTION public.admin_switch_mtn_provider(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_switch_mtn_provider(text,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_mtn_provider_report(p_from timestamptz,p_to timestamptz,p_provider text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE auth_user_id=auth.uid() AND status='active' AND role='Super Admin') THEN RAISE EXCEPTION 'Super Admin access required' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR (p_provider IS NOT NULL AND p_provider NOT IN ('Portal-02','iGet')) THEN RAISE EXCEPTION 'Invalid reporting filters'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (
    SELECT COALESCE(NULLIF(provider_name,''),'Legacy / unassigned') AS provider,
      count(*) AS total_orders,
      count(*) FILTER(WHERE status='delivered') AS successful_orders,
      count(*) FILTER(WHERE status IN ('failed','rejected','refunded','customer_cancelled','cancelled_before_processing','cancelled')) AS failed_orders,
      count(*) FILTER(WHERE status IN ('pending_confirmation','pending','processing','submitting')) AS pending_orders,
      COALESCE(sum(total_amount) FILTER(WHERE status='delivered'),0) AS revenue,
      COALESCE(sum(cost_price) FILTER(WHERE status='delivered'),0) AS configured_cost,
      COALESCE(sum(provider_purchase_cost) FILTER(WHERE status='delivered'),0) AS confirmed_purchase_cost,
      count(*) FILTER(WHERE status='delivered' AND provider_purchase_cost IS NULL) AS missing_purchase_cost_orders,
      COALESCE(sum(total_amount-cost_price) FILTER(WHERE status='delivered'),0) AS configured_profit,
      COALESCE(sum(total_amount-cost_price) FILTER(WHERE status IN ('pending_confirmation','pending','processing','submitting')),0) AS projected_profit
    FROM public.orders WHERE network='MTN' AND created_at>=p_from AND created_at<p_to AND (p_provider IS NULL OR provider_name=p_provider)
    GROUP BY COALESCE(NULLIF(provider_name,''),'Legacy / unassigned') ORDER BY provider
  ) r);
END $$;
REVOKE ALL ON FUNCTION public.admin_mtn_provider_report(timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_mtn_provider_report(timestamptz,timestamptz,text) TO authenticated,service_role;