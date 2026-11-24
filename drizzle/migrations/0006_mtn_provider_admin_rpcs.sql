CREATE OR REPLACE FUNCTION public.admin_get_mtn_provider_management() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_settings public.mtn_provider_settings%ROWTYPE; v_balance public.provider_balance_current%ROWTYPE; v_configured boolean; v_admin_name text; v_mode text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE auth_user_id=auth.uid() AND status='active' AND role='Super Admin') THEN RAISE EXCEPTION 'Super Admin access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_settings FROM public.mtn_provider_settings WHERE singleton=true;
  SELECT * INTO v_balance FROM public.provider_balance_current WHERE provider='Portal-02';
  SELECT EXISTS(SELECT 1 FROM public.network_api_configs WHERE network='MTN' AND api_base_url<>'' AND api_key<>'') INTO v_configured;
  SELECT name INTO v_admin_name FROM public.admin_users WHERE id=v_settings.switched_by;
  v_mode:=CASE WHEN COALESCE(v_settings.portal02_api_enabled,false) THEN 'PORTAL-02 AUTOMATIC DELIVERY' WHEN COALESCE(v_settings.iget_api_enabled,false) THEN 'IGET AUTOMATIC DELIVERY' ELSE 'MANUAL PROCESSING' END;
  RETURN jsonb_build_object('portal02_api_enabled',COALESCE(v_settings.portal02_api_enabled,false),'iget_api_enabled',COALESCE(v_settings.iget_api_enabled,false),'delivery_mode',v_mode,'active_provider',v_mode,'iget_bundle_type',COALESCE(v_settings.iget_bundle_type,'mtnup2u'),'switched_at',v_settings.switched_at,'switched_by_name',v_admin_name,'portal_configured',v_configured,'portal_last_check',v_balance.last_checked_at,'portal_last_status',v_balance.status,'iget_activation_ready',true,'iget_connection_status','reuses verified AT/Telecel iGet integration','iget_blocker',NULL);
END $$;