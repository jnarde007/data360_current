/**
 * Shared order status classification and metric rules.
 * ALL pages must use these helpers for consistent counting.
 */

/** Statuses where the order is permanently closed and money was returned */
export const REFUNDED_TERMINAL_STATUSES = [
  'customer_cancelled',
  'cancelled_before_processing',
  'rejected',
  'refunded',
] as const;

/** All locked terminal statuses (includes delivered as a success terminal) */
export const TERMINAL_STATUSES = [
  ...REFUNDED_TERMINAL_STATUSES,
  'delivered',
] as const;

/** Statuses that count as real business activity (operational / in-flight orders) */
export const OPERATIONAL_STATUSES = [
  'pending_confirmation',
  'pending',
  'pending_manual',
  'awaiting_manual_fulfillment',
  'submitted',
  'processing',
  'failed',
] as const;

// ── Predicates ──────────────────────────────────────────────

/** Order is permanently closed (delivered, refunded, cancelled, or rejected) */
export const isTerminal = (status: string): boolean =>
  (TERMINAL_STATUSES as readonly string[]).includes(status);

/** Order was refunded/cancelled/rejected (money returned) */
export const isRefundedTerminal = (status: string): boolean =>
  (REFUNDED_TERMINAL_STATUSES as readonly string[]).includes(status);

/** Order counts as a real business attempt (not cancelled/rejected, includes delivered) */
export const isOperational = (status: string): boolean =>
  !isRefundedTerminal(status);

/** Order was successfully delivered */
export const isDelivered = (status: string): boolean =>
  status === 'delivered';

/** Order failed but is recoverable / retryable */
export const isFailed = (status: string): boolean =>
  status === 'failed';

// ── Metric helpers ──────────────────────────────────────────

export interface OrderLike {
  status: string;
  total_amount: number | string;
}

/** Count of operational (non-refunded-terminal) orders */
export function countOperationalOrders<T extends { status: string }>(orders: T[]): number {
  return orders.filter(o => isOperational(o.status)).length;
}

/** Count of delivered orders only */
export function countDeliveredOrders<T extends { status: string }>(orders: T[]): number {
  return orders.filter(o => isDelivered(o.status)).length;
}

/**
 * Total amount spent = sum of all orders EXCEPT refunded/cancelled/rejected ones.
 * Money for refunded-terminal orders was returned to the customer, so it was
 * never truly spent. Everything else (delivered + in-flight + failed) counts.
 */
export function totalSpent<T extends OrderLike>(orders: T[]): number {
  return orders
    .filter(o => !isRefundedTerminal(o.status))
    .reduce((sum, o) => sum + Number(o.total_amount), 0);
}


/**
 * Total amount for operational orders (pending + processing + delivered + failed).
 * Useful for "total order value" that excludes cancelled/rejected.
 */
export function totalOperationalAmount<T extends OrderLike>(orders: T[]): number {
  return orders
    .filter(o => isOperational(o.status))
    .reduce((sum, o) => sum + Number(o.total_amount), 0);
}

/**
 * Supabase filter string for excluding refunded terminal statuses.
 * Use: .not('status', 'in', TERMINAL_STATUS_FILTER)
 */
export const TERMINAL_STATUS_FILTER = `("${REFUNDED_TERMINAL_STATUSES.join('","')}")`;
