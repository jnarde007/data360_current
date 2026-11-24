import { supabase } from '@/integrations/supabase/client';

export type AvailabilityItem = { network: string; phone: string };
export type BlockedItem = {
  phone: string;
  network: string;
  blocked: true;
  existing_order_short_id?: string;
  existing_status?: string;
};

export type AvailabilityResult = {
  blocked: boolean;
  blocked_count: number;
  blocked_items: BlockedItem[];
};

/**
 * Server-side authoritative pre-flight check.
 * Returns blocked recipients (active non-final order already exists for that
 * network+phone). Call this BEFORE initiating any wallet debit or Paystack
 * popup so the buyer is never charged when the number is already in flight.
 */
export async function checkRecipientAvailability(
  items: AvailabilityItem[]
): Promise<AvailabilityResult> {
  const payload = items.map(i => ({
    network: i.network,
    phone: (i.phone || '').replace(/[^0-9]/g, ''),
  }));

  const { data, error } = await supabase.rpc('check_recipient_availability' as any, {
    p_items: payload as any,
  });

  if (error) {
    // Fail-safe: do NOT block the user on a network/RPC error — server-side
    // guards inside place_order* will still catch true duplicates.
    console.error('[checkRecipientAvailability] RPC error:', error);
    return { blocked: false, blocked_count: 0, blocked_items: [] };
  }

  const res = (data as any) || {};
  const arr: any[] = Array.isArray(res.items) ? res.items : [];
  const blocked_items = arr.filter(x => x?.blocked) as BlockedItem[];

  return {
    blocked: !!res.blocked,
    blocked_count: Number(res.blocked_count || blocked_items.length),
    blocked_items,
  };
}

export function formatBlockedMessage(blocked: BlockedItem[]): string {
  if (!blocked.length) return '';
  if (blocked.length === 1) {
    const b = blocked[0];
    const ref = b.existing_order_short_id ? ` (order #${b.existing_order_short_id})` : '';
    return `${b.phone} already has an active order${ref}. Wait for it to be delivered before ordering again.`;
  }
  return `${blocked.length} recipients already have active orders: ${blocked
    .map(b => b.phone)
    .join(', ')}. Wait for them to be delivered before ordering again.`;
}
