import { Check } from 'lucide-react';

interface Props {
  network: string;
  size: string;
  price: string;
  active: boolean;
  isAvailable?: boolean;
  onClick: () => void;
}

export function BundleTile({
  network,
  size,
  price,
  active,
  isAvailable = true,
  onClick,
}: Props) {
  const isMTN = network === 'MTN';
  const isTelecel = network === 'Telecel';
  const isAT = network === 'AirtelTigo';

  // 1. OUT OF STOCK STATE — elegant muted card with strikethrough
  if (!isAvailable) {
    return (
      <div
        role="button"
        aria-disabled="true"
        className="relative overflow-hidden flex flex-col items-center justify-between min-h-[102px] rounded-2xl p-2.5 bg-muted/60 border border-dashed border-border/80 opacity-60 cursor-not-allowed select-none text-center"
      >
        <span className="text-sm font-bold text-muted-foreground mt-1">{size}</span>
        <span className="text-xs font-semibold text-muted-foreground line-through">{price}</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-destructive/15 text-destructive border border-destructive/20">
          Out of stock
        </span>
      </div>
    );
  }

  // 2. STYLING BY NETWORK — Maximum contrast & elegant gradient
  const theme = isMTN
    ? {
        cardBg: 'bg-gradient-to-br from-amber-400 via-yellow-400 to-amber-500 border-amber-500/40 shadow-[0_6px_20px_-6px_rgba(245,158,11,0.45)]',
        sizeText: 'text-slate-950 font-black',
        priceText: 'text-slate-900/90 font-bold',
        pillBg: 'bg-black/10 border-black/10 text-slate-950',
        dotBg: 'bg-emerald-600',
        checkBg: 'bg-slate-950 text-amber-400',
        activeRing: 'ring-3 ring-offset-2 ring-slate-950 ring-offset-background scale-[1.03]',
      }
    : isTelecel
    ? {
        cardBg: 'bg-gradient-to-br from-rose-500 via-red-500 to-rose-600 border-red-500/30 shadow-[0_6px_20px_-6px_rgba(225,29,72,0.45)]',
        sizeText: 'text-white font-black',
        priceText: 'text-white/95 font-bold',
        pillBg: 'bg-white/15 border-white/20 text-white',
        dotBg: 'bg-emerald-300',
        checkBg: 'bg-white text-red-600',
        activeRing: 'ring-3 ring-offset-2 ring-red-600 ring-offset-background scale-[1.03]',
      }
    : {
        // AirtelTigo
        cardBg: 'bg-gradient-to-br from-blue-500 via-sky-500 to-blue-600 border-blue-500/30 shadow-[0_6px_20px_-6px_rgba(37,99,235,0.45)]',
        sizeText: 'text-white font-black',
        priceText: 'text-white/95 font-bold',
        pillBg: 'bg-white/15 border-white/20 text-white',
        dotBg: 'bg-emerald-300',
        checkBg: 'bg-white text-blue-600',
        activeRing: 'ring-3 ring-offset-2 ring-blue-600 ring-offset-background scale-[1.03]',
      };

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`relative overflow-hidden flex flex-col items-center justify-between min-h-[102px] rounded-2xl p-2.5 transition-all duration-200 cursor-pointer select-none border active:scale-[0.98] ${theme.cardBg} ${
        active
          ? `${theme.activeRing} shadow-lg z-10`
          : 'opacity-95 hover:opacity-100 hover:-translate-y-0.5 hover:shadow-md'
      }`}
    >
      {/* Glossy top-right corner reflection */}
      <span className="pointer-events-none absolute -top-8 -right-8 w-18 h-18 rounded-full bg-white/20 blur-[1px]" />

      {/* Selected Checkmark Badge */}
      {active && (
        <span className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm ${theme.checkBg}`}>
          <Check className="w-3 h-3 stroke-[3]" />
        </span>
      )}

      {/* Bundle Size */}
      <span className={`text-base sm:text-lg tracking-tight leading-tight pt-0.5 ${theme.sizeText}`}>
        {size}
      </span>

      {/* Bundle Price */}
      <span className={`text-xs tracking-tight ${theme.priceText}`}>
        {price}
      </span>

      {/* Clean "In Stock" Status Pill */}
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-xs ${theme.pillBg}`}>
        <span className="relative flex h-1.5 w-1.5">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${theme.dotBg}`} />
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${theme.dotBg}`} />
        </span>
        In stock
      </span>
    </button>
  );
}
