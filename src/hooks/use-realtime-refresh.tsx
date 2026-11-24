import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

type TableName = 'customers' | 'orders' | 'topups' | 'wallet_transactions' | 'network_api_configs' | 'platform_settings' | 'price_items' | 'affiliate_withdrawals' | 'support_tickets' | 'support_messages' | 'payment_attempts' | 'payouts' | 'refunds';

/**
 * Subscribe to Supabase realtime changes on one or more tables.
 * Calls `onUpdate` (debounced) whenever a change arrives.
 */
export function useRealtimeRefresh(
  tables: TableName[],
  onUpdate: () => void,
  channelName: string,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (tables.length === 0) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onUpdateRef.current();
      }, 150); // Fast debounce for near-instant UI updates on status changes
    };

    let channel = supabase.channel(channelName);

    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        debouncedRefresh,
      );
    }

    channel.subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [channelName, tables.join(',')]);
}
