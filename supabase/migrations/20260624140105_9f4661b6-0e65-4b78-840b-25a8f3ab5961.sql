
-- Kill switch setting
INSERT INTO public.platform_settings(key, value)
VALUES ('disable_provider_diagnostics', 'false')
ON CONFLICT (key) DO NOTHING;

-- RPC: Super Admin flips the kill switch
CREATE OR REPLACE FUNCTION public.set_disable_provider_diagnostics(_disabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_super boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = _uid AND role='Super Admin' AND status='active'
  ) INTO _is_super;
  IF NOT _is_super THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.platform_settings
    SET value = CASE WHEN _disabled THEN 'true' ELSE 'false' END,
        updated_at = now()
    WHERE key='disable_provider_diagnostics';

  -- If turning the kill switch ON, also close any open diagnostics window.
  IF _disabled THEN
    UPDATE public.platform_settings SET value='false', updated_at=now() WHERE key='diagnostics_live_calls_allowed';
    UPDATE public.platform_settings SET value='', updated_at=now()
      WHERE key IN ('diagnostics_live_calls_expires_at','diagnostics_live_calls_token_hash');
  END IF;

  INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, admin_id, source, payload_summary)
  VALUES ('blocked','*','set_disable_provider_diagnostics',
          CASE WHEN _disabled THEN 'kill_switch_enabled' ELSE 'kill_switch_disabled' END,
          _uid, 'admin_ui', jsonb_build_object('disabled', _disabled));

  RETURN jsonb_build_object('ok', true, 'disabled', _disabled);
END;
$$;
REVOKE ALL ON FUNCTION public.set_disable_provider_diagnostics(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_disable_provider_diagnostics(boolean) TO authenticated;

-- Helper: notify every active Super Admin
CREATE OR REPLACE FUNCTION public.notify_super_admins(_type text, _title text, _message text, _metadata jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications(target_type, target_id, type, title, message, metadata)
  SELECT 'admin', au.auth_user_id, _type, _title, _message, coalesce(_metadata,'{}'::jsonb)
  FROM public.admin_users au
  WHERE au.role='Super Admin' AND au.status='active' AND au.auth_user_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_super_admins(text,text,text,jsonb) FROM PUBLIC;

-- Replace assert function with kill-switch + rate limiting + alerts
CREATE OR REPLACE FUNCTION public.assert_provider_call_allowed(
  _kind text,
  _provider text,
  _endpoint text,
  _confirmation_token text,
  _payload_summary jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_super boolean;
  _enabled text;
  _exp text;
  _stored_hash text;
  _candidate_hash text;
  _kill text;
  _per_min int;
  _per_hour int;
  _recent_blocks int;
BEGIN
  -- Hard rule: diagnostics may never place real provider orders.
  IF _kind = 'order_placement' THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'order_placement_forbidden_for_diagnostics', _uid, 'rpc', _payload_summary);
    PERFORM public.notify_super_admins(
      'security_alert',
      'Diagnostics order-placement blocked',
      'A diagnostic attempt tried to place a real provider order. Blocked.',
      jsonb_build_object('provider', _provider, 'endpoint', _endpoint, 'admin_id', _uid)
    );
    RAISE EXCEPTION 'order_placement is permanently disabled for diagnostics';
  END IF;

  IF _kind NOT IN ('probe_balance','probe_status') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Kill switch
  SELECT value INTO _kill FROM public.platform_settings WHERE key='disable_provider_diagnostics';
  IF coalesce(_kill,'false') = 'true' THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'kill_switch_enabled', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'provider diagnostics are globally disabled (kill switch)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = _uid AND role = 'Super Admin' AND status = 'active'
  ) INTO _is_super;

  IF NOT _is_super THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'not_super_admin', _uid, 'rpc', _payload_summary);
    PERFORM public.notify_super_admins(
      'security_alert',
      'Unauthorized provider call attempt',
      'A non-Super-Admin attempted to invoke provider diagnostics.',
      jsonb_build_object('provider', _provider, 'endpoint', _endpoint, 'user_id', _uid)
    );
    RAISE EXCEPTION 'forbidden: Super Admin required';
  END IF;

  -- Rate limits per admin (5/min, 20/hour) — count successful + blocked probe attempts
  SELECT count(*) INTO _per_min FROM public.provider_call_attempts
    WHERE admin_id = _uid AND created_at > now() - interval '1 minute'
      AND kind IN ('probe_balance','probe_status','blocked');
  IF _per_min >= 5 THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'rate_limit_per_minute', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'rate limit: max 5 diagnostic calls per minute';
  END IF;

  SELECT count(*) INTO _per_hour FROM public.provider_call_attempts
    WHERE admin_id = _uid AND created_at > now() - interval '1 hour'
      AND kind IN ('probe_balance','probe_status','blocked');
  IF _per_hour >= 20 THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'rate_limit_per_hour', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'rate limit: max 20 diagnostic calls per hour';
  END IF;

  SELECT value INTO _enabled FROM public.platform_settings WHERE key='diagnostics_live_calls_allowed';
  SELECT value INTO _exp FROM public.platform_settings WHERE key='diagnostics_live_calls_expires_at';
  SELECT value INTO _stored_hash FROM public.platform_settings WHERE key='diagnostics_live_calls_token_hash';

  IF coalesce(_enabled,'false') <> 'true' OR _exp IS NULL OR _exp = '' OR _exp::timestamptz < now() THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'diagnostics_window_closed_or_expired', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'diagnostics window is closed or expired. Open one in Admin Settings.';
  END IF;

  IF _confirmation_token IS NULL OR _confirmation_token = '' OR _stored_hash IS NULL OR _stored_hash = '' THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'missing_token', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'confirmation_token required';
  END IF;

  _candidate_hash := encode(digest(_confirmation_token, 'sha256'), 'hex');
  IF _candidate_hash <> _stored_hash THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'invalid_token_or_replay', _uid, 'rpc', _payload_summary);
    -- Burst alert: 3+ blocked attempts by this admin in 5 minutes
    SELECT count(*) INTO _recent_blocks FROM public.provider_call_attempts
      WHERE admin_id = _uid AND kind='blocked' AND created_at > now() - interval '5 minutes';
    IF _recent_blocks >= 3 THEN
      PERFORM public.notify_super_admins(
        'security_alert',
        'Multiple blocked diagnostic calls',
        format('%s blocked diagnostic attempts in the last 5 minutes.', _recent_blocks),
        jsonb_build_object('admin_id', _uid, 'recent_blocks', _recent_blocks)
      );
    END IF;
    RAISE EXCEPTION 'invalid or already-consumed confirmation_token';
  END IF;

  -- Consume the token (replay protection): rotate to a fresh random hash.
  UPDATE public.platform_settings
    SET value = encode(digest(encode(gen_random_bytes(18),'hex'), 'sha256'), 'hex'),
        updated_at = now()
    WHERE key='diagnostics_live_calls_token_hash';

  INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, admin_id, source, payload_summary)
  VALUES (_kind, _provider, _endpoint, 'allowed', _uid, 'rpc', _payload_summary);

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.assert_provider_call_allowed(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_provider_call_allowed(text,text,text,text,jsonb) TO authenticated, service_role;

-- Index to keep rate-limit counts fast
CREATE INDEX IF NOT EXISTS idx_provider_call_attempts_admin_created
  ON public.provider_call_attempts (admin_id, created_at DESC);
