CREATE OR REPLACE FUNCTION public.admin_switch_mtn_provider(p_provider text,p_bundle_type text,p_expected_provider text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_admin_id uuid; v_settings public.mtn_provider_settings%ROWTYPE; v_portal boolean; v_iget boolean; v_current text;
BEGIN
  SELECT id INTO v_admin_id FROM public.admin_users WHERE auth_user_id=auth.uid() AND status='active' AND role='Super Admin';
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Super Admin access required' USING ERRCODE='42501'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('Portal-02','iGet','Manual') OR p_bundle_type IS NULL OR p_bundle_type NOT IN ('mtnup2u','mtn-justforu','mtn-fibre') THEN RAISE EXCEPTION 'Invalid MTN provider or bundle type' USING ERRCODE='22023'; END IF;
  INSERT INTO public.mtn_provider_settings(singleton) SELECT true WHERE NOT EXISTS (SELECT 1 FROM public.mtn_provider_settings WHERE singleton=true);
  SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true FOR UPDATE;
  v_portal:=(p_provider='Portal-02');
  v_iget:=(p_provider='iGet');
  IF v_settings.portal02_api_enabled THEN v_current:='Portal-02'; ELSIF v_settings.iget_api_enabled THEN v_current:='iGet'; ELSE v_current:='Manual'; END IF;
  IF p_expected_provider IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'Provider changed by another administrator; refresh and confirm again';
  END IF;
  UPDATE public.mtn_provider_settings SET portal02_api_enabled=v_portal,iget_api_enabled=v_iget,iget_bundle_type=p_bundle_type,switched_at=now(),switched_by=v_admin_id WHERE singleton=true;
  INSERT INTO public.admin_activity_logs(admin_id,action,target_type,target_id,details) VALUES(v_admin_id,'switch_mtn_provider','mtn_provider','MTN',jsonb_build_object('previous_portal02',v_settings.portal02_api_enabled,'previous_iget',v_settings.iget_api_enabled,'new_portal02',v_portal,'new_iget',v_iget,'bundle_type',p_bundle_type));
  RETURN public.admin_get_mtn_provider_management();
END $$;