ALTER TABLE public.mtn_provider_settings ADD COLUMN IF NOT EXISTS portal02_api_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.mtn_provider_settings ADD COLUMN IF NOT EXISTS iget_api_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.mtn_provider_settings ADD CONSTRAINT mtn_provider_mutual_exclusion CHECK (NOT (portal02_api_enabled AND iget_api_enabled));

CREATE OR REPLACE FUNCTION public.pin_mtn_order_provider() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_settings public.mtn_provider_settings%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.network='MTN' THEN
      SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true FOR SHARE;
      IF v_settings.portal02_api_enabled THEN
        NEW.provider_name:='Portal-02';
        NEW.provider_bundle_type:=NULL;
      ELSIF v_settings.iget_api_enabled THEN
        NEW.provider_name:='iGet';
        NEW.provider_bundle_type:=COALESCE(v_settings.iget_bundle_type,'mtnup2u');
      ELSE
        NEW.provider_name:='Manual';
        NEW.provider_bundle_type:=NULL;
      END IF;
      NEW.provider_routing_version:=1;
      NEW.provider_submission_reference:=NULL;
      NEW.provider_submission_started_at:=NULL;
      NEW.provider_submission_uncertain:=false;
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