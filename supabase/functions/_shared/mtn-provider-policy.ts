/** Parses a catalog size label like "8GB" / "50Gb" into whole GB; null if not a GB data size. */
export function parseCapacityGb(size: string | null | undefined): number | null {
  const m = String(size ?? '').trim().match(/^(\d+)\s*gb$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

/** Allowed MTN capacities come from the admin's MTN data price list, not a fixed list. */
export function capacitiesFromCatalog(items: { product?: string | null; size?: string | null }[]): number[] {
  const set = new Set<number>();
  for (const it of items) {
    if ((it.product ?? '').toLowerCase() !== 'data') continue;
    const gb = parseCapacityGb(it.size);
    if (gb) set.add(gb);
  }
  return [...set].sort((a, b) => a - b);
}

export const MTN_IGET_BUNDLE_TYPES = ['mtnup2u', 'mtn-justforu', 'mtn-fibre'] as const;

export function resolveMtnProvider(order: { provider_name?: string | null; provider_routing_version?: number | null }) {
  if (order.provider_name === 'Portal-02' || order.provider_name === 'iGet') return order.provider_name;
  // Pre-switch legacy MTN orders must never inherit a later administrator selection.
  if (!order.provider_routing_version) return 'Portal-02';
  throw new Error('Pinned MTN provider is missing or invalid');
}

export function validateMtnIgetPurchase(phone: string, capacity: number, bundleType: string, allowedCapacities: number[]) {
  if (!/^0[235]\d{8}$/.test(phone)) throw new Error('Invalid Ghana mobile number');
  if (!Number.isInteger(capacity) || capacity <= 0 || !allowedCapacities.includes(capacity)) throw new Error('Unsupported iGet MTN capacity');
  if (!MTN_IGET_BUNDLE_TYPES.some(value => value === bundleType)) throw new Error('Unsupported iGet MTN bundle type');
}

export function mapMtnIgetStatus(status: unknown): 'pending' | 'processing' | 'delivered' | 'failed' {
  switch (typeof status === 'string' ? status.toLowerCase() : '') {
    case 'completed': return 'delivered';
    case 'processing': return 'processing';
    case 'failed': return 'failed';
    default: return 'pending';
  }
}

export function mustHoldMtnSubmission(order: {
  provider_submission_started_at?: string | null;
  provider_submission_uncertain?: boolean | null;
  provider_reference?: string | null;
  provider_order_id?: string | null;
}) {
  return Boolean(order.provider_submission_started_at || order.provider_submission_uncertain || order.provider_reference || order.provider_order_id);
}