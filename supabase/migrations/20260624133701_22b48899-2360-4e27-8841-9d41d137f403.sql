
-- Provider call attempts audit log
CREATE TABLE IF NOT EXISTS public.provider_call_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('probe_balance','probe_status','order_placement','blocked')),
  provider text NOT NULL,
  endpoint text,
  payload_summary jsonb,
  outcome text,
  blocked_reason text,
  admin_id uuid,
  confirmation_token text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_call_attempts TO authenticated;
GRANT ALL ON public.provider_call_attempts TO service_role;

ALTER TABLE public.provider_call_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super Admin read provider_call_attempts"
  ON public.provider_call_attempts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.auth_user_id = auth.uid()
        AND au.role = 'Super Admin'
        AND au.status = 'active'
    )
  );

CREATE POLICY "service_role manage provider_call_attempts"
  ON public.provider_call_attempts FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_provider_call_attempts_created
  ON public.provider_call_attempts (created_at DESC);

-- Seed platform_settings rows used by the diagnostic gate
INSERT INTO public.platform_settings(key, value)
VALUES
  ('diagnostics_live_calls_allowed', 'false'),
  ('diagnostics_live_calls_expires_at', ''),
  ('diagnostics_live_calls_approved_by', ''),
  ('diagnostics_live_calls_note', ''),
  ('diagnostics_live_calls_token_hash', '')
ON CONFLICT (key) DO NOTHING;

-- RPC: super-admin opens a diagnostics window
CREATE OR REPLACE FUNCTION public.set_diagnostics_window(
  _enabled boolean,
  _duration_minutes integer,
  _note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_super boolean;
  _exp timestamptz;
  _token text;
  _token_hash text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = _uid AND role = 'Super Admin' AND status = 'active'
  ) INTO _is_super;

  IF NOT _is_super THEN
    RAISE EXCEPTION 'forbidden: Super Admin required';
  END IF;

  IF NOT _enabled THEN
    UPDATE public.platform_settings SET value='false', updated_at=now() WHERE key='diagnostics_live_calls_allowed';
    UPDATE public.platform_settings SET value='', updated_at=now() WHERE key IN ('diagnostics_live_calls_expires_at','diagnostics_live_calls_approved_by','diagnostics_live_calls_note','diagnostics_live_calls_token_hash');
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, admin_id, source, payload_summary)
    VALUES ('blocked','*','set_diagnostics_window','window_closed', _uid, 'admin_ui', jsonb_build_object('enabled', false));
    RETURN jsonb_build_object('ok', true, 'enabled', false);
  END IF;

  IF _duration_minutes IS NULL OR _duration_minutes < 1 OR _duration_minutes > 60 THEN
    RAISE EXCEPTION 'duration_minutes must be between 1 and 60';
  END IF;
  IF _note IS NULL OR length(trim(_note)) < 5 THEN
    RAISE EXCEPTION 'note (reason) is required';
  END IF;

  _exp := now() + make_interval(mins => _duration_minutes);
  _token := encode(gen_random_bytes(18), 'hex');
  _token_hash := encode(digest(_token, 'sha256'), 'hex');

  UPDATE public.platform_settings SET value='true', updated_at=now() WHERE key='diagnostics_live_calls_allowed';
  UPDATE public.platform_settings SET value=_exp::text, updated_at=now() WHERE key='diagnostics_live_calls_expires_at';
  UPDATE public.platform_settings SET value=_uid::text, updated_at=now() WHERE key='diagnostics_live_calls_approved_by';
  UPDATE public.platform_settings SET value=_note, updated_at=now() WHERE key='diagnostics_live_calls_note';
  UPDATE public.platform_settings SET value=_token_hash, updated_at=now() WHERE key='diagnostics_live_calls_token_hash';

  INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, admin_id, source, payload_summary)
  VALUES ('blocked','*','set_diagnostics_window','window_opened', _uid, 'admin_ui',
    jsonb_build_object('enabled', true, 'expires_at', _exp, 'note', _note));

  -- Return one-time token to the admin (shown once in UI)
  RETURN jsonb_build_object('ok', true, 'enabled', true, 'expires_at', _exp, 'confirmation_token', _token);
END;
$$;

REVOKE ALL ON FUNCTION public.set_diagnostics_window(boolean,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_diagnostics_window(boolean,integer,text) TO authenticated;

-- RPC: assert + consume token for a single provider call.
-- Order-placement diagnostics are ALWAYS denied.
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
BEGIN
  -- Hard rule: diagnostics may never place real provider orders.
  IF _kind = 'order_placement' THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'order_placement_forbidden_for_diagnostics', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'order_placement is permanently disabled for diagnostics';
  END IF;

  IF _kind NOT IN ('probe_balance','probe_status') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = _uid AND role = 'Super Admin' AND status = 'active'
  ) INTO _is_super;

  IF NOT _is_super THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'not_super_admin', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'forbidden: Super Admin required';
  END IF;

  SELECT value INTO _enabled FROM public.platform_settings WHERE key='diagnostics_live_calls_allowed';
  SELECT value INTO _exp FROM public.platform_settings WHERE key='diagnostics_live_calls_expires_at';
  SELECT value INTO _stored_hash FROM public.platform_settings WHERE key='diagnostics_live_calls_token_hash';

  IF coalesce(_enabled,'false') <> 'true' OR _exp IS NULL OR _exp = '' OR _exp::timestamptz < now() THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'diagnostics_window_closed_or_expired', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'diagnostics window is closed. Open one in Admin Settings.';
  END IF;

  IF _confirmation_token IS NULL OR _confirmation_token = '' OR _stored_hash IS NULL OR _stored_hash = '' THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'missing_token', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'confirmation_token required';
  END IF;

  _candidate_hash := encode(digest(_confirmation_token, 'sha256'), 'hex');
  IF _candidate_hash <> _stored_hash THEN
    INSERT INTO public.provider_call_attempts(kind, provider, endpoint, outcome, blocked_reason, admin_id, source, payload_summary)
    VALUES ('blocked', _provider, _endpoint, 'denied', 'invalid_token', _uid, 'rpc', _payload_summary);
    RAISE EXCEPTION 'invalid confirmation_token';
  END IF;

  -- Consume the token (rotate to a new one so each call needs a fresh confirmation).
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

-- RPC: super-admin rotates the one-time confirmation token without changing window.
CREATE OR REPLACE FUNCTION public.rotate_diagnostics_token()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_super boolean;
  _enabled text;
  _exp text;
  _token text;
  _hash text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE auth_user_id = _uid AND role='Super Admin' AND status='active'
  ) INTO _is_super;
  IF NOT _is_super THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT value INTO _enabled FROM public.platform_settings WHERE key='diagnostics_live_calls_allowed';
  SELECT value INTO _exp FROM public.platform_settings WHERE key='diagnostics_live_calls_expires_at';
  IF coalesce(_enabled,'false') <> 'true' OR _exp IS NULL OR _exp='' OR _exp::timestamptz < now() THEN
    RAISE EXCEPTION 'diagnostics window not open';
  END IF;

  _token := encode(gen_random_bytes(18),'hex');
  _hash := encode(digest(_token,'sha256'),'hex');
  UPDATE public.platform_settings SET value=_hash, updated_at=now() WHERE key='diagnostics_live_calls_token_hash';
  RETURN jsonb_build_object('ok', true, 'confirmation_token', _token);
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_diagnostics_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_diagnostics_token() TO authenticated;

-- Ensure pgcrypto for digest/gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto;
