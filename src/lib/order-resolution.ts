/**
 * Shared derivation of the CUSTOMER-FACING order status.
 *
 * Four distinct concepts must never be collapsed into one:
 *   A. Provider status     — what the upstream provider reported
 *   B. Order status        — the DATA360 order row status
 *   C. Payment status      — wallet debit / Paystack payment
 *   D. Refund status       — the `refunds` ledger (and legacy wallet credit)
 *
 * A provider "failed" alone NEVER means the customer's money came back.
 */

/** Refund ledger statuses that prove money actually returned to the buyer. */
export const CONFIRMED_REFUND_STATUSES = ['refunded', 'completed'] as const;

/** Refund ledger statuses that are still in flight (money NOT back yet). */
export const IN_FLIGHT_REFUND_STATUSES = ['refund_pending', 'processing'] as const;

export interface RefundRecordLike {
  id?: string;
  status: string;
  refund_method?: string | null;
  refund_amount?: number | string | null;
  total_refunded?: number | string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface RefundEvidence {
  /** True only when a refund ledger row (or legacy wallet credit) confirms the money returned. */
  confirmed: boolean;
  /** True when a refund exists but has not completed yet. */
  inFlight: boolean;
  amount: number | null;
  at: string | null;
  method: 'wallet' | 'paystack' | null;
  status: string | null;
}

export const EMPTY_REFUND_EVIDENCE: RefundEvidence = {
  confirmed: false, inFlight: false, amount: null, at: null, method: null, status: null,
};

/**
 * Build refund evidence from the refunds ledger, with an optional legacy
 * wallet-credit fallback (older orders refunded before the refunds table).
 */
export function buildRefundEvidence(
  refund: RefundRecordLike | null | undefined,
  legacyWalletCredit?: { amount: number | string; created_at: string } | null,
): RefundEvidence {
  if (refund) {
    const confirmed = (CONFIRMED_REFUND_STATUSES as readonly string[]).includes(refund.status);
    return {
      confirmed,
      inFlight: !confirmed && (IN_FLIGHT_REFUND_STATUSES as readonly string[]).includes(refund.status),
      amount: Number(refund.total_refunded ?? 0) > 0
        ? Number(refund.total_refunded)
        : (refund.refund_amount != null ? Number(refund.refund_amount) : null),
      at: refund.completed_at || refund.created_at || null,
      method: refund.refund_method === 'paystack' ? 'paystack' : refund.refund_method === 'wallet' ? 'wallet' : null,
      status: refund.status,
    };
  }
  if (legacyWalletCredit) {
    return {
      confirmed: true, inFlight: false,
      amount: Number(legacyWalletCredit.amount),
      at: legacyWalletCredit.created_at,
      method: 'wallet',
      status: 'refunded',
    };
  }
  return EMPTY_REFUND_EVIDENCE;
}

export type CustomerStatusKey =
  | 'being_resolved'
  | 'refund_processing'
  | 'failed_refunded'
  | 'raw';

export interface CustomerStatusView {
  key: CustomerStatusKey;
  /** Status key to feed to StatusBadge. */
  badgeStatus: string;
  label: string;
  /** Short explanation shown in detail views. Empty for pass-through statuses. */
  message: string;
  tone: 'neutral' | 'resolving' | 'refunded';
}

const REFUND_TERMINAL = ['rejected', 'refunded'];

export interface OrderStatusInput {
  status: string;
  payment_method?: string | null;
}

/**
 * Translate the raw order status + refund evidence into what the customer sees.
 */
export function deriveCustomerStatus(
  order: OrderStatusInput,
  evidence: RefundEvidence = EMPTY_REFUND_EVIDENCE,
): CustomerStatusView {
  const status = order.status;

  if (evidence.confirmed && (status === 'failed' || REFUND_TERMINAL.includes(status))) {
    return {
      key: 'failed_refunded',
      badgeStatus: 'failed_refunded',
      label: 'Failed — Refunded',
      message: evidence.method === 'wallet'
        ? 'This order could not be completed and the amount was returned to your DATA360 wallet.'
        : 'This order could not be completed and the amount was refunded to your original payment method.',
      tone: 'refunded',
    };
  }

  if (REFUND_TERMINAL.includes(status)) {
    // Order closed but the refund ledger has not confirmed the money moved yet.
    return {
      key: 'refund_processing',
      badgeStatus: 'refund_processing',
      label: 'Refund Processing',
      message: 'This order was closed and your refund is being processed. You do not need to do anything.',
      tone: 'resolving',
    };
  }

  if (status === 'failed') {
    return {
      key: 'being_resolved',
      badgeStatus: 'being_resolved',
      label: 'Order Being Resolved',
      message: "We couldn't complete your order on the first attempt. Your payment has not been refunded because we're still working to complete your order. Please don't place another order.",
      tone: 'resolving',
    };
  }

  return { key: 'raw', badgeStatus: status, label: '', message: '', tone: 'neutral' };
}

// ── Admin: provider status view ─────────────────────────────

export interface ProviderStatusInput {
  delivery_mode?: string | null;
  provider_name?: string | null;
  provider_order_id?: string | null;
  provider_reference?: string | null;
  provider_response?: unknown;
  status: string;
}

export function providerFailureReason(order: ProviderStatusInput): string {
  const r = order.provider_response as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return '';
  const raw = (r.error ?? r.message ?? (r as any)?.data?.message ?? '') as unknown;
  return typeof raw === 'string' ? raw : '';
}

export function deriveProviderStatus(order: ProviderStatusInput): { label: string; tone: 'neutral' | 'warning' | 'danger' | 'success' } {
  if (order.delivery_mode !== 'api') return { label: 'Manual — not sent', tone: 'neutral' };
  const hasProviderOrder = !!(order.provider_order_id || order.provider_reference);
  if (order.status === 'delivered') return { label: 'Fulfilled', tone: 'success' };
  if (order.status === 'failed') {
    return hasProviderOrder
      ? { label: 'Failed — resolution pending', tone: 'warning' }
      : { label: 'Failed — no provider order', tone: 'danger' };
  }
  if (REFUND_TERMINAL.includes(order.status)) {
    return hasProviderOrder
      ? { label: 'Failed after provider order', tone: 'danger' }
      : { label: 'Failed — no provider order', tone: 'danger' };
  }
  return hasProviderOrder ? { label: 'Responded', tone: 'neutral' } : { label: 'Awaiting response', tone: 'warning' };
}

// ── Admin: reprocess eligibility ────────────────────────────

export interface ReprocessInput {
  status: string;
  buyer_type?: string | null;
  customer_id?: string | null;
  payment_method?: string | null;
  provider_order_id?: string | null;
  provider_reference?: string | null;
  grace_period_ends_at?: string | null;
}

export interface ReprocessEligibility {
  eligible: boolean;
  reason: string;
}

/**
 * Reprocess is ONLY for registered wallet orders whose wallet refund is
 * confirmed and where the provider never created an order/reference.
 * Anything else must be handled manually.
 */
export function evaluateReprocess(
  order: ReprocessInput,
  evidence: RefundEvidence,
  opts: { networkAvailable: boolean | null; alreadyReprocessed: boolean },
): ReprocessEligibility {
  const deny = (reason: string) => ({ eligible: false, reason });

  if (order.status === 'delivered') return deny('Reprocess unavailable — this order was delivered.');
  if ((order.buyer_type || 'registered') !== 'registered' || !order.customer_id) {
    return deny('Reprocess unavailable — only registered wallet customers can be reprocessed.');
  }
  if ((order.payment_method || 'wallet').toLowerCase() !== 'wallet') {
    return deny('Reprocess unavailable — Paystack payments must be paid again by the customer.');
  }
  if (!REFUND_TERMINAL.includes(order.status) && order.status !== 'failed') {
    return deny('Reprocess unavailable — the order is still active.');
  }
  if (!evidence.confirmed) {
    return deny('Reprocess unavailable — customer refund has not been confirmed.');
  }
  if (evidence.method !== 'wallet') {
    return deny('Reprocess unavailable — the refund was not returned to the DATA360 wallet.');
  }
  if (order.provider_order_id || order.provider_reference) {
    return deny('Reprocess unavailable — provider resolution is still pending on the original request.');
  }
  if (order.grace_period_ends_at && new Date(order.grace_period_ends_at).getTime() > Date.now()) {
    return deny('Reprocess unavailable — the grace period has not ended.');
  }
  if (opts.alreadyReprocessed) {
    return deny('Reprocess unavailable — this order has already been reprocessed.');
  }
  if (opts.networkAvailable === false) {
    return deny('Reprocess unavailable — this network is currently halted.');
  }
  if (opts.networkAvailable === null) {
    return deny('Reprocess unavailable — network availability could not be confirmed.');
  }
  return { eligible: true, reason: '' };
}
