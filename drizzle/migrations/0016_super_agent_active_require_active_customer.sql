CREATE OR REPLACE FUNCTION public._super_agent_active(p_customer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.super_agents sa JOIN public.customers c ON c.id = sa.customer_id
    WHERE sa.customer_id = p_customer_id AND sa.status = 'active'
      AND c.status = 'active' AND c.deleted_at IS NULL)
$function$;
REVOKE ALL ON FUNCTION public._super_agent_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._super_agent_active(uuid) TO service_role;