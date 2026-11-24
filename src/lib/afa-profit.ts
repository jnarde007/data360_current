// AFA profit integration helpers.
//
// AFA registrations live in their own `afa_registrations` table and are NOT
// part of the `orders` table. Without this helper they are silently excluded
// from every profit, revenue, network and report calculation.
//
// We solve this by fetching AFA registrations and projecting them into the
// SAME shape as orders, with network = 'AFA' and a status mapping that lines
// up with how the order pipeline classifies things:
//
//   registered  -> delivered  (success — counts toward revenue & profit)
//   submitted   -> pending
//   processing  -> processing
//   rejected    -> rejected   (refunded / excluded from revenue & profit)
//
// Cost price is read once from `price_items` (product = 'AFA Registration',
// network = 'MTN'). All AFA registrations share the same cost basis.

import { supabase } from '@/integrations/supabase/client';

export interface SyntheticAfaOrder {
  id: string;
  short_id: string;
  network: string;        // 'AFA'
  bundle_size: string;    // 'Registration'
  total_amount: number;
  cost_price: number;
  status: string;
  created_at: string;
  customer_id: string | null;
  recipient_phone: string;
  provider_name: string;
}

const AFA_STATUS_MAP: Record<string, string> = {
  registered: 'delivered',
  submitted: 'pending',
  processing: 'processing',
  rejected: 'rejected',
};

/** Fetch the current AFA cost_price (single source of truth). */
export async function fetchAfaCostPrice(): Promise<number> {
  const { data } = await supabase
    .from('price_items')
    .select('cost_price')
    .eq('product', 'AFA Registration')
    .eq('network', 'MTN')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.cost_price || 0);
}

interface FetchAfaOptions {
  startISO?: string;
  endISO?: string;
}

/**
 * Load AFA registrations and project them as order-shaped rows so they merge
 * cleanly into the existing profit / revenue / report pipelines.
 */
export async function fetchAfaAsOrders(opts: FetchAfaOptions = {}): Promise<SyntheticAfaOrder[]> {
  const cost = await fetchAfaCostPrice();

  let q = supabase
    .from('afa_registrations')
    .select('id, short_id, total_amount, status, created_at, customer_id, registration_phone');

  if (opts.startISO) q = q.gte('created_at', opts.startISO);
  if (opts.endISO) q = q.lte('created_at', opts.endISO);

  const { data, error } = await q;
  if (error || !data) return [];

  return (data as any[]).map((r) => ({
    id: r.id,
    short_id: r.short_id,
    network: 'AFA',
    bundle_size: 'Registration',
    total_amount: Number(r.total_amount || 0),
    cost_price: cost,
    status: AFA_STATUS_MAP[r.status] || r.status,
    created_at: r.created_at,
    customer_id: r.customer_id,
    recipient_phone: r.registration_phone || '',
    provider_name: 'AFA',
  }));
}
