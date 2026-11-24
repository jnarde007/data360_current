CREATE OR REPLACE FUNCTION public.pin_mtn_order_provider() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_settings public.mtn_provider_settings%ROWTYPE; v_active text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.network='MTN' THEN
      SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true FOR SHARE;
      IF v_settings.portal02_api_enabled THEN
        NEW.provider_name:='Portal-02'; NEW.provider_bundle_type:=NULL;
      ELSIF v_settings.iget_api_enabled THEN
        NEW.provider_name:='iGet'; NEW.provider_bundle_type:=COALESCE(v_settings.iget_bundle_type,'mtnup2u');
      ELSE
        NEW.provider_name:='Manual'; NEW.provider_bundle_type:=NULL;
      END IF;
      NEW.provider_routing_version:=1;
      NEW.provider_submission_reference:=NULL;
      NEW.provider_submission_started_at:=NULL;
      NEW.provider_submission_uncertain:=false;
    END IF;
  ELSIF OLD.network='MTN' AND OLD.provider_routing_version=1 THEN
    IF NEW.provider_name IS DISTINCT FROM OLD.provider_name OR NEW.provider_bundle_type IS DISTINCT FROM OLD.provider_bundle_type OR NEW.network IS DISTINCT FROM OLD.network OR NEW.provider_routing_version IS DISTINCT FROM OLD.provider_routing_version THEN
      SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true;
      v_active := CASE WHEN v_settings.portal02_api_enabled THEN 'Portal-02' WHEN v_settings.iget_api_enabled THEN 'iGet' ELSE NULL END;
      IF NOT (OLD.provider_name='Manual' AND v_active IS NOT NULL AND NEW.provider_name=v_active
              AND NEW.network=OLD.network AND NEW.provider_routing_version=OLD.provider_routing_version
              AND NEW.provider_bundle_type IS NOT DISTINCT FROM (CASE WHEN v_active='iGet' THEN COALESCE(v_settings.iget_bundle_type,'mtnup2u') ELSE NULL END)
              AND OLD.provider_submission_started_at IS NULL AND NOT OLD.provider_submission_uncertain
              AND COALESCE(OLD.provider_reference,'')='' AND COALESCE(OLD.provider_order_id,'')=''
              AND OLD.status IN ('pending','pending_confirmation','submitting')) THEN
        RAISE EXCEPTION 'MTN provider and bundle type are immutable after order creation';
      END IF;
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