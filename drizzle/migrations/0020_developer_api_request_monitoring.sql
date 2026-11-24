
CREATE TABLE public.api_monitor_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL DEFAULT 'count' CHECK (mode IN ('off','count','shadow')),
  limits jsonb NOT NULL,
  counting_started_at timestamptz,
  shadow_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.admin_users(id)
);
GRANT ALL ON public.api_monitor_settings TO service_role;
ALTER TABLE public.api_monitor_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.api_monitor_settings(mode, limits, counting_started_at) VALUES ('count', '{
 "key":      {"read":{"burst_10s":60,"per_minute":300,"per_day":5000},"purchase":{"burst_10s":10,"per_minute":60,"per_day":500}},
 "customer": {"read":{"burst_10s":120,"per_minute":600,"per_day":5000},"purchase":{"burst_10s":20,"per_minute":120,"per_day":500}}
}'::jsonb, now());

CREATE TABLE public.api_request_counters (
  bucket_start timestamptz NOT NULL,
  customer_id uuid,
  api_key_id uuid,
  endpoint text NOT NULL,
  outcome text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  would_block_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX api_request_counters_uq ON public.api_request_counters (bucket_start, customer_id, api_key_id, endpoint, outcome) NULLS NOT DISTINCT;
CREATE INDEX api_request_counters_customer ON public.api_request_counters (customer_id, bucket_start);
GRANT ALL ON public.api_request_counters TO service_role;
ALTER TABLE public.api_request_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.api_invalid_key_counters (
  bucket_start timestamptz NOT NULL,
  endpoint text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_start, endpoint)
);
GRANT ALL ON public.api_invalid_key_counters TO service_role;
ALTER TABLE public.api_invalid_key_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.api_rate_windows (
  scope text NOT NULL,
  subject_id uuid NOT NULL,
  req_class text NOT NULL,
  win text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject_id, req_class, win, window_start)
);
GRANT ALL ON public.api_rate_windows TO service_role;
ALTER TABLE public.api_rate_windows ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.api_shadow_blocks (
  bucket_start timestamptz NOT NULL,
  customer_id uuid,
  api_key_id uuid,
  rule text NOT NULL,
  count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX api_shadow_blocks_uq ON public.api_shadow_blocks (bucket_start, customer_id, api_key_id, rule) NULLS NOT DISTINCT;
GRANT ALL ON public.api_shadow_blocks TO service_role;
ALTER TABLE public.api_shadow_blocks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.api_monitor_failures (
  bucket_start timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('record_failed','timeout')),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_start, kind)
);
GRANT ALL ON public.api_monitor_failures TO service_role;
ALTER TABLE public.api_monitor_failures ENABLE ROW LEVEL SECURITY;

-- Fixed vocabularies keep storage bounded and free of raw paths.
CREATE OR REPLACE FUNCTION public._api_valid_endpoint(p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p IN ('verify','packages','wallet','purchase_create','purchase_list','purchase_get','usage','usage_history')
$$;
CREATE OR REPLACE FUNCTION public._api_valid_outcome(p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p IN ('2xx','400','401','402','403','404','405','409','422','429','4xx','5xx')
$$;

-- Atomically counts one authenticated request. Every request (including retries) counts.
-- In shadow mode, also evaluates limits and records would-block hits. Never blocks.
CREATE OR REPLACE FUNCTION public.api_monitor_record(p_customer_id uuid, p_api_key_id uuid, p_endpoint text, p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record; v_class text; v_now timestamptz := now(); v_hour timestamptz := date_trunc('hour', now());
  v_rule text := NULL; v_n integer; v_lim integer;
  w record;
BEGIN
  IF p_customer_id IS NULL OR p_api_key_id IS NULL OR NOT _api_valid_endpoint(p_endpoint) OR NOT _api_valid_outcome(p_outcome) THEN
    RAISE EXCEPTION 'INVALID_MONITOR_INPUT';
  END IF;
  SELECT * INTO s FROM api_monitor_settings WHERE singleton;
  IF s.mode = 'off' THEN RETURN jsonb_build_object('mode','off'); END IF;
  v_class := CASE WHEN p_endpoint = 'purchase_create' THEN 'purchase' ELSE 'read' END;

  IF s.mode = 'shadow' THEN
    FOR w IN
      SELECT * FROM (VALUES
        ('key', p_api_key_id, 'burst_10s', to_timestamp(floor(extract(epoch FROM v_now)/10)*10)),
        ('key', p_api_key_id, 'per_minute', date_trunc('minute', v_now)),
        ('key', p_api_key_id, 'per_day', date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
        ('customer', p_customer_id, 'burst_10s', to_timestamp(floor(extract(epoch FROM v_now)/10)*10)),
        ('customer', p_customer_id, 'per_minute', date_trunc('minute', v_now)),
        ('customer', p_customer_id, 'per_day', date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      ) AS t(scope, subject, win, ws)
    LOOP
      INSERT INTO api_rate_windows(scope, subject_id, req_class, win, window_start, count)
      VALUES (w.scope, w.subject, v_class, w.win, w.ws, 1)
      ON CONFLICT (scope, subject_id, req_class, win, window_start) DO UPDATE SET count = api_rate_windows.count + 1
      RETURNING count INTO v_n;
      v_lim := (s.limits -> w.scope -> v_class ->> w.win)::int;
      IF v_rule IS NULL AND v_lim IS NOT NULL AND v_n > v_lim THEN
        v_rule := w.scope || '.' || v_class || '.' || w.win;
      END IF;
    END LOOP;
    IF v_rule IS NOT NULL THEN
      INSERT INTO api_shadow_blocks(bucket_start, customer_id, api_key_id, rule, count)
      VALUES (v_hour, p_customer_id, p_api_key_id, v_rule, 1)
      ON CONFLICT (bucket_start, customer_id, api_key_id, rule) DO UPDATE SET count = api_shadow_blocks.count + 1;
    END IF;
  END IF;

  INSERT INTO api_request_counters(bucket_start, customer_id, api_key_id, endpoint, outcome, count, would_block_count)
  VALUES (v_hour, p_customer_id, p_api_key_id, p_endpoint, p_outcome, 1, CASE WHEN v_rule IS NULL THEN 0 ELSE 1 END)
  ON CONFLICT (bucket_start, customer_id, api_key_id, endpoint, outcome) DO UPDATE
    SET count = api_request_counters.count + 1,
        would_block_count = api_request_counters.would_block_count + EXCLUDED.would_block_count;
  RETURN jsonb_build_object('mode', s.mode, 'would_block', v_rule IS NOT NULL, 'rule', v_rule);
END $$;

-- Invalid/missing key attempts: endpoint + hour only. Bounded to 8 rows per hour.
CREATE OR REPLACE FUNCTION public.api_monitor_record_invalid(p_endpoint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _api_valid_endpoint(p_endpoint) THEN RAISE EXCEPTION 'INVALID_MONITOR_INPUT'; END IF;
  IF (SELECT mode FROM api_monitor_settings WHERE singleton) = 'off' THEN RETURN; END IF;
  INSERT INTO api_invalid_key_counters(bucket_start, endpoint, count) VALUES (date_trunc('hour', now()), p_endpoint, 1)
  ON CONFLICT (bucket_start, endpoint) DO UPDATE SET count = api_invalid_key_counters.count + 1;
END $$;

CREATE OR REPLACE FUNCTION public.api_monitor_record_failure(p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO api_monitor_failures(bucket_start, kind, count) VALUES (date_trunc('hour', now()), p_kind, 1)
  ON CONFLICT (bucket_start, kind) DO UPDATE SET count = api_monitor_failures.count + 1;
END $$;

REVOKE ALL ON FUNCTION public.api_monitor_record(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_monitor_record_invalid(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_monitor_record_failure(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_monitor_record(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_monitor_record_invalid(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_monitor_record_failure(text) TO service_role;

-- Customer: own request usage only. Days are UTC (same as Ghana time).
CREATE OR REPLACE FUNCTION public.get_my_api_request_usage(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid uuid; v_start timestamptz; v_end timestamptz; s record;
BEGIN
  SELECT id INTO v_cid FROM customers WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  IF v_cid IS NULL OR NOT _super_agent_active(v_cid) THEN RETURN jsonb_build_object('available', false); END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
  v_start := p_from::timestamp AT TIME ZONE 'UTC'; v_end := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
  SELECT mode, limits, counting_started_at INTO s FROM api_monitor_settings WHERE singleton;
  RETURN jsonb_build_object(
    'available', true,
    'mode', s.mode,
    'counting_started_at', s.counting_started_at,
    'limits', s.limits,
    'totals', (SELECT jsonb_build_object(
        'requests', COALESCE(sum(count),0),
        'successful', COALESCE(sum(count) FILTER (WHERE outcome='2xx'),0),
        'unsuccessful', COALESCE(sum(count) FILTER (WHERE outcome<>'2xx'),0),
        'would_block', COALESCE(sum(would_block_count),0))
      FROM api_request_counters WHERE customer_id=v_cid AND bucket_start>=v_start AND bucket_start<v_end),
    'by_endpoint', COALESCE((SELECT jsonb_agg(x ORDER BY x.requests DESC) FROM (
        SELECT endpoint, sum(count)::int requests, (sum(count) FILTER (WHERE outcome='2xx'))::int successful
        FROM api_request_counters WHERE customer_id=v_cid AND bucket_start>=v_start AND bucket_start<v_end GROUP BY endpoint) x), '[]'::jsonb),
    'daily', (SELECT jsonb_agg(jsonb_build_object('date', d::date,
        'requests', COALESCE((SELECT sum(count) FROM api_request_counters c WHERE c.customer_id=v_cid AND c.bucket_start>=d::timestamp AT TIME ZONE 'UTC' AND c.bucket_start<(d::date+1)::timestamp AT TIME ZONE 'UTC'),0),
        'unsuccessful', COALESCE((SELECT sum(count) FROM api_request_counters c WHERE c.customer_id=v_cid AND c.outcome<>'2xx' AND c.bucket_start>=d::timestamp AT TIME ZONE 'UTC' AND c.bucket_start<(d::date+1)::timestamp AT TIME ZONE 'UTC'),0)) ORDER BY d)
      FROM generate_series(p_from, p_to, interval '1 day') d),
    'by_key', COALESCE((SELECT jsonb_agg(x ORDER BY x.requests DESC) FROM (
        SELECT k.name, k.key_prefix, k.is_active, sum(c.count)::int requests
        FROM api_request_counters c JOIN customer_api_keys k ON k.id=c.api_key_id AND k.customer_id=v_cid
        WHERE c.customer_id=v_cid AND c.bucket_start>=v_start AND c.bucket_start<v_end GROUP BY k.id, k.name, k.key_prefix, k.is_active) x), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.get_my_api_request_usage(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_api_request_usage(date, date) TO authenticated;

-- Admin report: Super Admin gets per-customer/key detail; Manager gets aggregates only.
CREATE OR REPLACE FUNCTION public.admin_api_usage_report(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_start timestamptz; v_end timestamptz; s record; v jsonb;
BEGIN
  SELECT role INTO v_role FROM admin_users WHERE auth_user_id = auth.uid() AND status='active';
  IF v_role IS NULL THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
  v_start := p_from::timestamp AT TIME ZONE 'UTC'; v_end := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
  SELECT mode, limits, counting_started_at, shadow_started_at INTO s FROM api_monitor_settings WHERE singleton;
  v := jsonb_build_object(
    'role', v_role,
    'mode', s.mode, 'limits', s.limits, 'counting_started_at', s.counting_started_at, 'shadow_started_at', s.shadow_started_at,
    'totals', (SELECT jsonb_build_object('requests', COALESCE(sum(count),0),
        'successful', COALESCE(sum(count) FILTER (WHERE outcome='2xx'),0),
        'unsuccessful', COALESCE(sum(count) FILTER (WHERE outcome<>'2xx'),0),
        'would_block', COALESCE(sum(would_block_count),0),
        'active_customers', count(DISTINCT customer_id), 'active_keys', count(DISTINCT api_key_id))
      FROM api_request_counters WHERE bucket_start>=v_start AND bucket_start<v_end),
    'invalid_key_attempts', (SELECT COALESCE(sum(count),0) FROM api_invalid_key_counters WHERE bucket_start>=v_start AND bucket_start<v_end),
    'monitor_failures', (SELECT COALESCE(sum(count),0) FROM api_monitor_failures WHERE bucket_start>=v_start AND bucket_start<v_end),
    'by_endpoint', COALESCE((SELECT jsonb_agg(x ORDER BY x.requests DESC) FROM (
        SELECT endpoint, sum(count)::int requests, (sum(count) FILTER (WHERE outcome<>'2xx'))::int unsuccessful
        FROM api_request_counters WHERE bucket_start>=v_start AND bucket_start<v_end GROUP BY endpoint) x), '[]'::jsonb),
    'by_outcome', COALESCE((SELECT jsonb_object_agg(outcome, n) FROM (
        SELECT outcome, sum(count)::int n FROM api_request_counters WHERE bucket_start>=v_start AND bucket_start<v_end GROUP BY outcome) x), '{}'::jsonb),
    'daily', (SELECT jsonb_agg(jsonb_build_object('date', d::date,
        'requests', COALESCE((SELECT sum(count) FROM api_request_counters c WHERE c.bucket_start>=d::timestamp AT TIME ZONE 'UTC' AND c.bucket_start<(d::date+1)::timestamp AT TIME ZONE 'UTC'),0),
        'invalid', COALESCE((SELECT sum(count) FROM api_invalid_key_counters c WHERE c.bucket_start>=d::timestamp AT TIME ZONE 'UTC' AND c.bucket_start<(d::date+1)::timestamp AT TIME ZONE 'UTC'),0),
        'would_block', COALESCE((SELECT sum(would_block_count) FROM api_request_counters c WHERE c.bucket_start>=d::timestamp AT TIME ZONE 'UTC' AND c.bucket_start<(d::date+1)::timestamp AT TIME ZONE 'UTC'),0)) ORDER BY d)
      FROM generate_series(p_from, p_to, interval '1 day') d),
    'would_block_rules', COALESCE((SELECT jsonb_object_agg(rule, n) FROM (
        SELECT rule, sum(count)::int n FROM api_shadow_blocks WHERE bucket_start>=v_start AND bucket_start<v_end GROUP BY rule) x), '{}'::jsonb)
  );
  IF v_role = 'Super Admin' THEN
    v := v || jsonb_build_object(
      'top_keys', COALESCE((SELECT jsonb_agg(x ORDER BY x.requests DESC) FROM (
        SELECT cu.full_name customer_name, k.name key_name, k.key_prefix, k.is_active,
               sum(c.count)::int requests,
               (sum(c.count) FILTER (WHERE c.outcome<>'2xx'))::int unsuccessful,
               sum(c.would_block_count)::int would_block,
               (sum(c.count) FILTER (WHERE c.bucket_start >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::int today
        FROM api_request_counters c
        JOIN customer_api_keys k ON k.id=c.api_key_id
        JOIN customers cu ON cu.id=c.customer_id
        WHERE c.bucket_start>=v_start AND c.bucket_start<v_end AND c.customer_id IS NOT NULL
        GROUP BY cu.full_name, k.id, k.name, k.key_prefix, k.is_active
        ORDER BY requests DESC LIMIT 50) x), '[]'::jsonb),
      'would_block_by_key', COALESCE((SELECT jsonb_agg(x ORDER BY x.hits DESC) FROM (
        SELECT cu.full_name customer_name, k.key_prefix, b.rule, sum(b.count)::int hits
        FROM api_shadow_blocks b JOIN customer_api_keys k ON k.id=b.api_key_id JOIN customers cu ON cu.id=b.customer_id
        WHERE b.bucket_start>=v_start AND b.bucket_start<v_end
        GROUP BY cu.full_name, k.key_prefix, b.rule ORDER BY hits DESC LIMIT 50) x), '[]'::jsonb)
    );
  END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_api_usage_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_api_usage_report(date, date) TO authenticated;

-- Super Admin: switch between off / count / shadow. Enforcement is not an allowed value.
CREATE OR REPLACE FUNCTION public.admin_set_api_monitor_mode(p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid := public._require_super_admin(); v_old text;
BEGIN
  IF p_mode NOT IN ('off','count','shadow') THEN RAISE EXCEPTION 'Invalid mode'; END IF;
  SELECT mode INTO v_old FROM api_monitor_settings WHERE singleton FOR UPDATE;
  UPDATE api_monitor_settings SET mode=p_mode, updated_at=now(), updated_by=v_admin,
    counting_started_at = CASE WHEN p_mode<>'off' AND (v_old='off' OR counting_started_at IS NULL) THEN now() ELSE counting_started_at END,
    shadow_started_at = CASE WHEN p_mode='shadow' AND v_old<>'shadow' THEN now() WHEN p_mode<>'shadow' THEN NULL ELSE shadow_started_at END
  WHERE singleton;
  INSERT INTO admin_activity_logs(admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'api_monitor_mode', 'platform', 'api_monitor', jsonb_build_object('previous', v_old, 'new', p_mode));
  RETURN jsonb_build_object('mode', p_mode);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_api_limits(p_limits jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid := public._require_super_admin(); v_old jsonb; sc text; cl text; w text; n numeric;
BEGIN
  FOREACH sc IN ARRAY ARRAY['key','customer'] LOOP
    FOREACH cl IN ARRAY ARRAY['read','purchase'] LOOP
      FOREACH w IN ARRAY ARRAY['burst_10s','per_minute','per_day'] LOOP
        BEGIN n := (p_limits -> sc -> cl ->> w)::numeric; EXCEPTION WHEN others THEN n := NULL; END;
        IF n IS NULL OR n < 1 OR n > 1000000 OR n <> floor(n) THEN RAISE EXCEPTION 'Invalid limit %.%.%', sc, cl, w; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  SELECT limits INTO v_old FROM api_monitor_settings WHERE singleton FOR UPDATE;
  UPDATE api_monitor_settings SET limits=p_limits, updated_at=now(), updated_by=v_admin WHERE singleton;
  INSERT INTO admin_activity_logs(admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'api_limits_update', 'platform', 'api_monitor', jsonb_build_object('previous', v_old, 'new', p_limits));
  RETURN p_limits;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_api_monitor_mode(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_api_limits(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_api_monitor_mode(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_api_limits(jsonb) TO authenticated;

-- Deleted customers: fold their usage into anonymous totals and drop identifying rows.
CREATE OR REPLACE FUNCTION public.api_monitor_anonymize_customer(p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO api_request_counters(bucket_start, customer_id, api_key_id, endpoint, outcome, count, would_block_count)
  SELECT bucket_start, NULL, NULL, endpoint, outcome, sum(count), sum(would_block_count)
  FROM api_request_counters WHERE customer_id = p_customer_id GROUP BY bucket_start, endpoint, outcome
  ON CONFLICT (bucket_start, customer_id, api_key_id, endpoint, outcome) DO UPDATE
    SET count = api_request_counters.count + EXCLUDED.count,
        would_block_count = api_request_counters.would_block_count + EXCLUDED.would_block_count;
  DELETE FROM api_request_counters WHERE customer_id = p_customer_id;
  INSERT INTO api_shadow_blocks(bucket_start, customer_id, api_key_id, rule, count)
  SELECT bucket_start, NULL, NULL, rule, sum(count) FROM api_shadow_blocks WHERE customer_id = p_customer_id GROUP BY bucket_start, rule
  ON CONFLICT (bucket_start, customer_id, api_key_id, rule) DO UPDATE SET count = api_shadow_blocks.count + EXCLUDED.count;
  DELETE FROM api_shadow_blocks WHERE customer_id = p_customer_id;
  DELETE FROM api_rate_windows WHERE subject_id = p_customer_id
     OR subject_id IN (SELECT id FROM customer_api_keys WHERE customer_id = p_customer_id);
END $$;
REVOKE ALL ON FUNCTION public.api_monitor_anonymize_customer(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_api_monitor_customer_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) OR (NEW.anonymized_at IS NOT NULL AND OLD.anonymized_at IS NULL) THEN
    PERFORM public.api_monitor_anonymize_customer(NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER api_monitor_customer_deleted AFTER UPDATE OF deleted_at, anonymized_at ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.trg_api_monitor_customer_deleted();

-- Retention.
CREATE OR REPLACE FUNCTION public.api_monitor_cleanup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM api_rate_windows WHERE window_start < now() - interval '2 days';
  DELETE FROM api_request_counters WHERE bucket_start < now() - interval '13 months';
  DELETE FROM api_shadow_blocks WHERE bucket_start < now() - interval '90 days';
  DELETE FROM api_invalid_key_counters WHERE bucket_start < now() - interval '30 days';
  DELETE FROM api_monitor_failures WHERE bucket_start < now() - interval '90 days';
END $$;
REVOKE ALL ON FUNCTION public.api_monitor_cleanup() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('api-monitor-cleanup', '30 3 * * *', 'SELECT public.api_monitor_cleanup()');
