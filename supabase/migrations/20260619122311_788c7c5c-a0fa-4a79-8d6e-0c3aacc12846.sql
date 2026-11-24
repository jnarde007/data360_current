ALTER TABLE public.store_visits
  ADD CONSTRAINT store_visits_user_agent_len CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  ADD CONSTRAINT store_visits_referrer_len CHECK (referrer IS NULL OR length(referrer) <= 512),
  ADD CONSTRAINT store_visits_path_len CHECK (path IS NULL OR length(path) <= 512);