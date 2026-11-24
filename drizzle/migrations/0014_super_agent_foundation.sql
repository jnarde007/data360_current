CREATE TABLE public.super_agents (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.admin_users(id),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid REFERENCES public.admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.super_agents TO authenticated;
GRANT ALL ON public.super_agents TO service_role;
ALTER TABLE public.super_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view super agents" ON public.super_agents FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Customers view own super agent row" ON public.super_agents FOR SELECT TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid()));

CREATE TABLE public.super_agent_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  default_discount_pct numeric NOT NULL DEFAULT 0 CHECK (default_discount_pct >= 0 AND default_discount_pct < 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.admin_users(id)
);
INSERT INTO public.super_agent_settings(singleton) VALUES (true);
GRANT ALL ON public.super_agent_settings TO service_role;
ALTER TABLE public.super_agent_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.super_agent_price_overrides (
  price_item_id uuid PRIMARY KEY REFERENCES public.price_items(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.admin_users(id)
);
GRANT ALL ON public.super_agent_price_overrides TO service_role;
ALTER TABLE public.super_agent_price_overrides ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._super_agent_price(p_price_item_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT LEAST(pi.price, GREATEST(pi.cost_price,
           COALESCE(o.price, round(pi.price * (1 - s.default_discount_pct/100.0), 2))))
  FROM public.price_items pi
  CROSS JOIN public.super_agent_settings s
  LEFT JOIN public.super_agent_price_overrides o ON o.price_item_id = pi.id
  WHERE pi.id = p_price_item_id
$$;
REVOKE ALL ON FUNCTION public._super_agent_price(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._super_agent_active(p_customer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.super_agents sa JOIN public.customers c ON c.id = sa.customer_id
    WHERE sa.customer_id = p_customer_id AND sa.status = 'active' AND c.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public._super_agent_active(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._require_super_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM public.admin_users WHERE auth_user_id = auth.uid() AND status='active' AND role='Super Admin';
  IF v IS NULL THEN RAISE EXCEPTION 'Super Admin access required' USING ERRCODE='42501'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public._require_super_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_super_agent_pricing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid uuid;
BEGIN
  SELECT id INTO v_cid FROM public.customers WHERE auth_user_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
  IF v_cid IS NULL OR NOT public._super_agent_active(v_cid) THEN
    RETURN jsonb_build_object('is_super_agent', false, 'prices', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('is_super_agent', true, 'prices',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pi.id, 'price', public._super_agent_price(pi.id)))
              FROM public.price_items pi WHERE pi.product = 'Data'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_my_super_agent_pricing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_super_agent_pricing() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_super_agents(p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(r ORDER BY (r->>'sa_status') IS NULL, r->>'full_name') FROM (
    SELECT jsonb_build_object('customer_id', c.id, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone,
      'sa_status', sa.status, 'granted_at', sa.granted_at, 'granted_by_name', g.name,
      'status_changed_at', sa.status_changed_at, 'status_changed_by_name', ch.name) r
    FROM public.customers c
    LEFT JOIN public.super_agents sa ON sa.customer_id = c.id
    LEFT JOIN public.admin_users g ON g.id = sa.granted_by
    LEFT JOIN public.admin_users ch ON ch.id = sa.status_changed_by
    WHERE c.deleted_at IS NULL
      AND (CASE WHEN coalesce(trim(p_search),'') = '' THEN sa.customer_id IS NOT NULL
           ELSE (c.full_name ILIKE '%'||p_search||'%' OR c.email ILIKE '%'||p_search||'%' OR c.phone ILIKE '%'||p_search||'%' OR coalesce(c.username,'') ILIKE '%'||p_search||'%') END)
    LIMIT 100) t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_list_super_agents(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_super_agents(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_super_agent_status(p_customer_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid := public._require_super_admin(); v_cur text; v_new text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Customer not found'; END IF;
  SELECT status INTO v_cur FROM public.super_agents WHERE customer_id = p_customer_id FOR UPDATE;
  IF p_action = 'promote' THEN
    IF v_cur = 'active' THEN RAISE EXCEPTION 'Customer is already a Super Agent'; END IF;
    INSERT INTO public.super_agents(customer_id, status, granted_at, granted_by, status_changed_at, status_changed_by)
    VALUES (p_customer_id, 'active', now(), v_admin, now(), v_admin)
    ON CONFLICT (customer_id) DO UPDATE SET status='active', granted_at=now(), granted_by=v_admin, status_changed_at=now(), status_changed_by=v_admin;
    v_new := 'active';
  ELSIF p_action = 'suspend' THEN
    IF v_cur IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Only active Super Agents can be suspended'; END IF;
    v_new := 'suspended';
  ELSIF p_action = 'reactivate' THEN
    IF v_cur IS DISTINCT FROM 'suspended' THEN RAISE EXCEPTION 'Only suspended Super Agents can be reactivated'; END IF;
    v_new := 'active';
  ELSIF p_action = 'demote' THEN
    IF v_cur IS NULL OR v_cur = 'revoked' THEN RAISE EXCEPTION 'Customer is not a Super Agent'; END IF;
    v_new := 'revoked';
  ELSE RAISE EXCEPTION 'Invalid action';
  END IF;
  IF p_action <> 'promote' THEN
    UPDATE public.super_agents SET status=v_new, status_changed_at=now(), status_changed_by=v_admin WHERE customer_id=p_customer_id;
  END IF;
  INSERT INTO public.admin_activity_logs(admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'super_agent_'||p_action, 'customer', p_customer_id::text, jsonb_build_object('previous_status', v_cur, 'new_status', v_new));
  RETURN jsonb_build_object('customer_id', p_customer_id, 'status', v_new);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_super_agent_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_super_agent_status(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_super_agent_pricing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_super_admin();
  RETURN jsonb_build_object(
    'default_discount_pct', (SELECT default_discount_pct FROM public.super_agent_settings),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', pi.id, 'network', pi.network, 'size', pi.size, 'price', pi.price, 'cost_price', pi.cost_price,
        'override_price', o.price, 'super_agent_price', public._super_agent_price(pi.id)) ORDER BY pi.network, pi.price)
      FROM public.price_items pi LEFT JOIN public.super_agent_price_overrides o ON o.price_item_id = pi.id
      WHERE pi.product = 'Data'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.admin_get_super_agent_pricing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_super_agent_pricing() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_super_agent_default_discount(p_pct numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid := public._require_super_admin(); v_old numeric;
BEGIN
  IF p_pct IS NULL OR p_pct < 0 OR p_pct >= 100 THEN RAISE EXCEPTION 'Discount must be between 0 and 99.99%%'; END IF;
  SELECT default_discount_pct INTO v_old FROM public.super_agent_settings FOR UPDATE;
  UPDATE public.super_agent_settings SET default_discount_pct = round(p_pct, 2), updated_at = now(), updated_by = v_admin WHERE singleton;
  INSERT INTO public.admin_activity_logs(admin_id, action, target_type, target_id, details)
  VALUES (v_admin, 'super_agent_default_discount', 'pricing', 'super_agent', jsonb_build_object('old', v_old, 'new', round(p_pct,2)));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_super_agent_default_discount(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_super_agent_default_discount(numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_super_agent_override(p_price_item_id uuid, p_price numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid := public._require_super_admin(); v_item record; v_old numeric;
BEGIN
  SELECT id, price, cost_price INTO v_item FROM public.price_items WHERE id = p_price_item_id AND product = 'Data';
  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found'; END IF;
  SELECT price INTO v_old FROM public.super_agent_price_overrides WHERE price_item_id = p_price_item_id;
  IF p_price IS NULL THEN
    DELETE FROM public.super_agent_price_overrides WHERE price_item_id = p_price_item_id;
  ELSE
    IF p_price <= 0 THEN RAISE EXCEPTION 'Price must be greater than zero'; END IF;
    IF p_price < v_item.cost_price THEN RAISE EXCEPTION 'PRICE_BELOW_COST: Super Agent price cannot be below the cost price (GH₵%)', v_item.cost_price; END IF;
    IF p_price > v_item.price THEN RAISE EXCEPTION 'Super Agent price cannot be higher than the ordinary customer price (GH₵%)', v_item.price; END IF;
    INSERT INTO public.super_agent_price_overrides(price_item_id, price, updated_at, updated_by)
    VALUES (p_price_item_id, round(p_price, 2), now(), v_admin)
    ON CONFLICT (price_item_id) DO UPDATE SET price = EXCLUDED.price, updated_at = now(), updated_by = v_admin;
  END IF;
  INSERT INTO public.admin_activity_logs(admin_id, action, target_type, target_id, details)
  VALUES (v_admin, CASE WHEN p_price IS NULL THEN 'super_agent_override_reset' ELSE 'super_agent_override_set' END,
          'price_item', p_price_item_id::text, jsonb_build_object('old', v_old, 'new', p_price));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_super_agent_override(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_super_agent_override(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.place_order(p_customer_id uuid, p_network text, p_bundle_size text, p_recipient_phone text, p_quantity integer, p_total_amount numeric, p_cost_price numeric DEFAULT 0, p_delivery_mode text DEFAULT 'manual'::text, p_provider_name text DEFAULT ''::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_order_id uuid;
  new_short_id text;
  current_balance numeric;
  normalized_phone text;
  grace_end timestamptz;
  actual_cost_price numeric;
  v_available boolean;
  v_detected text;
  v_bypass boolean := false;
  v_email text;
  v_sa_price numeric;
BEGIN
  SELECT available_for_purchase INTO v_available
  FROM public.network_api_configs WHERE network = p_network LIMIT 1;
  IF NOT COALESCE(v_available, false) THEN
    RAISE EXCEPTION 'NETWORK_UNAVAILABLE: % is currently unavailable for purchase. Delivery is halted due to network issues.', p_network;
  END IF;

  normalized_phone := regexp_replace(p_recipient_phone, '[^0-9]', '', 'g');

  v_bypass := public.is_cross_network_authorized(p_customer_id);

  v_detected := public.detect_ghana_network(normalized_phone);
  IF v_detected IS NULL AND NOT v_bypass THEN
    RAISE EXCEPTION 'NETWORK_MISMATCH: % is not a valid Ghana mobile number.', p_recipient_phone;
  END IF;
  IF v_detected IS NOT NULL AND v_detected <> p_network THEN
    IF NOT v_bypass THEN
      RAISE EXCEPTION 'NETWORK_MISMATCH: % belongs to % but you selected %. Mixed-network batches are not allowed.', p_recipient_phone, v_detected, p_network;
    END IF;
  END IF;

  -- Duplicate-recipient guard
  IF public._has_active_order_for_recipient(p_network, normalized_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PENDING: % already has an active order in the system. Please wait for delivery before ordering again.', normalized_phone;
  END IF;

  SELECT pi.cost_price INTO actual_cost_price
  FROM public.price_items pi
  WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data'
  LIMIT 1;
  IF actual_cost_price IS NULL THEN actual_cost_price := COALESCE(p_cost_price, 0); END IF;

  -- Super Agent pricing: server-authoritative price for active Super Agents only.
  IF public._super_agent_active(p_customer_id) THEN
    SELECT public._super_agent_price(pi.id) INTO v_sa_price
    FROM public.price_items pi
    WHERE pi.network = p_network AND pi.size = p_bundle_size AND pi.product = 'Data' LIMIT 1;
    IF v_sa_price IS NOT NULL THEN
      p_total_amount := v_sa_price * GREATEST(COALESCE(p_quantity, 1), 1);
    END IF;
  END IF;

  SELECT wallet_balance, email INTO current_balance, v_email FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF current_balance IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF current_balance < p_total_amount THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;

  UPDATE customers SET wallet_balance = wallet_balance - p_total_amount WHERE id = p_customer_id;

  grace_end := now() + interval '3 minutes';

  INSERT INTO orders (customer_id, network, bundle_size, recipient_phone, quantity, total_amount, cost_price, delivery_mode, provider_name, status, grace_period_ends_at, detected_network)
  VALUES (p_customer_id, p_network, p_bundle_size, normalized_phone, p_quantity, p_total_amount, actual_cost_price, p_delivery_mode, p_provider_name, 'pending_confirmation', grace_end, v_detected)
  RETURNING id, short_id INTO new_order_id, new_short_id;

  IF v_bypass AND v_detected IS DISTINCT FROM p_network THEN
    INSERT INTO public.cross_network_bypass_audit (
      customer_id, customer_email, email, selected_network, detected_network,
      recipient_phone, order_id, order_short_id, flow, reason
    ) VALUES (
      p_customer_id, v_email, v_email, p_network, v_detected,
      normalized_phone, new_order_id, new_short_id, 'customer_wallet',
      'AUTHORIZED_CROSS_NETWORK_EXCEPTION'
    );
  END IF;

  INSERT INTO wallet_transactions (customer_id, type, amount, description, reference)
  VALUES (p_customer_id, 'debit', p_total_amount, 'Data purchase - ' || p_bundle_size || ' ' || p_network, new_short_id);

  RETURN json_build_object('order_id', new_order_id, 'short_id', new_short_id, 'grace_period_ends_at', grace_end);
END;
$function$;