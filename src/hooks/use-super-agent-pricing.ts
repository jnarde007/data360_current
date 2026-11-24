import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/** Signed-in customer's Super Agent status and special prices (server-computed). */
export function useSuperAgentPricing() {
  const { user } = useAuth();
  const [isSuperAgent, setIsSuperAgent] = useState(false);
  const [prices, setPrices] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    if (!user) { setIsSuperAgent(false); setPrices({}); return; }
    const { data, error } = await supabase.rpc('get_my_super_agent_pricing' as any);
    if (error || !data) { setIsSuperAgent(false); setPrices({}); return; }
    const d = data as { is_super_agent: boolean; prices: { id: string; price: number }[] };
    setIsSuperAgent(!!d.is_super_agent);
    const map: Record<string, number> = {};
    (d.prices || []).forEach(p => { map[p.id] = Number(p.price); });
    setPrices(map);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);
  return { isSuperAgent, prices, refresh };
}
