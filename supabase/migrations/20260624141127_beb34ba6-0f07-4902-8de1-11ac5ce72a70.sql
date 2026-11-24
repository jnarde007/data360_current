-- Harden notify_super_admins so it can never fail the calling RPC
CREATE OR REPLACE FUNCTION public.notify_super_admins(_type text, _title text, _message text, _metadata jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notifications(target_type, target_id, type, title, message, metadata)
    SELECT 'admin', au.auth_user_id, _type, _title, _message, coalesce(_metadata,'{}'::jsonb)
    FROM public.admin_users au
    WHERE au.role='Super Admin' AND au.status='active' AND au.auth_user_id IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort alerting must NEVER fail the main flow (assert/kill-switch/etc).
    RAISE WARNING 'notify_super_admins failed: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_super_admins(text,text,text,jsonb) FROM PUBLIC;

-- Retention: purge provider_call_attempts older than 180 days
CREATE OR REPLACE FUNCTION public.cleanup_provider_call_attempts()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _deleted integer;
BEGIN
  DELETE FROM public.provider_call_attempts
  WHERE created_at < now() - interval '180 days';
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_provider_call_attempts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_provider_call_attempts() TO service_role;

-- Daily retention cron at 03:15 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('cleanup-provider-call-attempts')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-provider-call-attempts');
    PERFORM cron.schedule(
      'cleanup-provider-call-attempts',
      '15 3 * * *',
      $cron$ SELECT public.cleanup_provider_call_attempts(); $cron$
    );
  END IF;
END$$;