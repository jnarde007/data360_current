/**
 * Shared network color configuration for consistent branding
 * across landing page, guest buy page, and customer buy page.
 *
 * MTN = yellow, Telecel = red, AirtelTigo = blue
 *
 * IMPORTANT: `!` (important) prefixes are required on the solid-color
 * buttons. The shadcn `default` button variant applies the unlayered
 * `.gradient-primary` rule (see src/index.css), which beats plain
 * Tailwind background utilities, so a network color only sticks when
 * declared important. `!bg-none` removes the gradient image.
 */

export const NETWORK_ACCENT = {
  MTN: {
    tabActive: 'border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-500/25 shadow-sm',
    tabHover: 'hover:border-yellow-400/40 hover:bg-yellow-500/5',
    btnHover: 'hover:ring-2 hover:ring-yellow-400/30',
    badge: 'bg-yellow-500 text-white',
    btnPrimary: 'bg-none bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_4px_10px_rgba(0,0,0,0.15)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.2)] hover:-translate-y-[1px] active:translate-y-0',
    btnPlaceOrder: '!bg-none !bg-yellow-500 hover:!bg-yellow-500/90 text-white shadow-[0_4px_10px_rgba(0,0,0,0.15)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.2)] hover:-translate-y-[1px] active:translate-y-0',
    btnWallet: '!bg-none !bg-yellow-500 hover:!bg-yellow-500/90 text-white',
    headerBg: 'bg-yellow-50 dark:bg-yellow-500/[0.06]',
    headerBorder: 'border-yellow-200 dark:border-yellow-500/20',
    toggleActive: 'bg-yellow-500 text-white shadow-sm',
    cardSelected: 'border-yellow-400/50 bg-yellow-500/[0.04] dark:bg-yellow-500/[0.06]',
    stepBadge: 'bg-yellow-500 text-white',
    iconBg: 'bg-yellow-100 dark:bg-yellow-500/15',
    iconText: 'text-yellow-600 dark:text-yellow-400',
    topBar: 'h-1.5 bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500',
    headerGlow: 'bg-gradient-to-br from-yellow-500/[0.14] via-yellow-500/[0.05] to-transparent',
    summaryBox: 'border-yellow-500/25 bg-gradient-to-b from-yellow-500/[0.07] to-yellow-500/[0.02]',
    summaryHead: 'bg-yellow-500/[0.10] border-yellow-500/20 text-yellow-700 dark:text-yellow-300',
    totalText: 'text-yellow-600 dark:text-yellow-400',
    logoRing: 'ring-2 ring-yellow-500/30 bg-yellow-500/10',
  },
  Telecel: {
    tabActive: 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-500/25 shadow-sm',
    tabHover: 'hover:border-red-400/40 hover:bg-red-500/5',
    btnHover: 'hover:ring-2 hover:ring-red-400/30',
    badge: 'bg-red-500 text-white',
    btnPrimary: 'bg-none bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_4px_10px_rgba(0,0,0,0.15)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.2)] hover:-translate-y-[1px] active:translate-y-0',
    btnPlaceOrder: '!bg-none !bg-red-600 hover:!bg-red-600/90 text-white shadow-[0_4px_10px_rgba(0,0,0,0.15)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.2)] hover:-translate-y-[1px] active:translate-y-0',
    btnWallet: '!bg-none !bg-red-600 hover:!bg-red-600/90 text-white',
    headerBg: 'bg-red-50 dark:bg-red-500/[0.06]',
    headerBorder: 'border-red-200 dark:border-red-500/20',
    toggleActive: 'bg-red-500 text-white shadow-sm',
    cardSelected: 'border-red-400/50 bg-red-500/[0.04] dark:bg-red-500/[0.06]',
    stepBadge: 'bg-red-500 text-white',
    iconBg: 'bg-red-100 dark:bg-red-500/15',
    iconText: 'text-red-600 dark:text-red-400',
    topBar: 'h-1.5 bg-gradient-to-r from-red-500 via-rose-500 to-red-600',
    headerGlow: 'bg-gradient-to-br from-red-500/[0.14] via-red-500/[0.05] to-transparent',
    summaryBox: 'border-red-500/25 bg-gradient-to-b from-red-500/[0.07] to-red-500/[0.02]',
    summaryHead: 'bg-red-500/[0.10] border-red-500/20 text-red-700 dark:text-red-300',
    totalText: 'text-red-600 dark:text-red-400',
    logoRing: 'ring-2 ring-red-500/30 bg-red-500/10',
  },
  AirtelTigo: {
    tabActive: 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-1 ring-blue-500/25 shadow-sm',
    tabHover: 'hover:border-blue-400/40 hover:bg-blue-500/5',
    btnHover: 'hover:ring-2 hover:ring-blue-400/30',
    badge: 'bg-primary text-primary-foreground',
    btnPrimary: 'bg-none bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_4px_10px_rgba(0,0,0,0.15)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.2)] hover:-translate-y-[1px] active:translate-y-0',
    btnPlaceOrder: '!bg-none !bg-primary hover:!bg-primary/90 text-white shadow-[0_4px_10px_rgba(0,0,0,0.15)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.2)] hover:-translate-y-[1px] active:translate-y-0',
    btnWallet: '!bg-none !bg-primary hover:!bg-primary/90 text-white',
    headerBg: 'bg-blue-50 dark:bg-blue-500/[0.06]',
    headerBorder: 'border-blue-200 dark:border-blue-500/20',
    toggleActive: 'bg-primary text-primary-foreground shadow-sm',
    cardSelected: 'border-blue-400/50 bg-blue-500/[0.04] dark:bg-blue-500/[0.06]',
    stepBadge: 'bg-primary text-primary-foreground',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
    iconText: 'text-blue-600 dark:text-blue-400',
    topBar: 'h-1.5 bg-gradient-to-r from-blue-500 via-sky-500 to-cyan-500',
    headerGlow: 'bg-gradient-to-br from-blue-500/[0.14] via-blue-500/[0.05] to-transparent',
    summaryBox: 'border-blue-500/25 bg-gradient-to-b from-blue-500/[0.07] to-blue-500/[0.02]',
    summaryHead: 'bg-blue-500/[0.10] border-blue-500/20 text-blue-700 dark:text-blue-300',
    totalText: 'text-blue-600 dark:text-blue-400',
    logoRing: 'ring-2 ring-blue-500/30 bg-blue-500/10',
  },
} as const;

/** Brand gradient tiles for bundle pickers (matches storefront network buttons). */
export const NETWORK_TILE = {
  MTN: 'bg-gradient-to-br from-yellow-400 to-amber-500 shadow-[0_6px_16px_-6px_rgba(234,179,8,0.6)]',
  Telecel: 'bg-gradient-to-br from-red-500 to-rose-600 shadow-[0_6px_16px_-6px_rgba(225,29,72,0.6)]',
  AirtelTigo: 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-[0_6px_16px_-6px_rgba(37,99,235,0.6)]',
} as const;

export function getNetworkTile(network: string) {
  return NETWORK_TILE[network as keyof typeof NETWORK_TILE] || NETWORK_TILE.MTN;
}

/** Thin left accent stripe per network, used on order list cards. */
export const NETWORK_STRIPE = {
  MTN: 'before:bg-yellow-500',
  Telecel: 'before:bg-red-500',
  AirtelTigo: 'before:bg-blue-500',
} as const;

export function getNetworkStripe(network: string) {
  return NETWORK_STRIPE[network as keyof typeof NETWORK_STRIPE] || 'before:bg-primary';
}

/** "0242527582" -> "024 252 7582" for easier reading. */
export function formatPhoneSpaced(phone: string | null | undefined) {
  const p = (phone || '').replace(/\s+/g, '');
  const m = p.match(/^(\d{3})(\d{3})(\d+)$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : p;
}

export type NetworkName = keyof typeof NETWORK_ACCENT;

export function getNetworkAccent(network: string) {
  return NETWORK_ACCENT[network as NetworkName] || NETWORK_ACCENT.MTN;
}
