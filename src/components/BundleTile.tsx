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

  // 1. OUT OF STOCK STATE — Defined card boundary, soft surface, distinct presence
  if (!isAvailable) {
    return (
      <div
        role="button"
        aria-disabled="true"
        className="relative overflow-hidden flex flex-col items-center justify-center gap-1 min-h-[88px] rounded-2xl p-3 bg-slate-100/90 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 shadow-xs cursor-not-allowed select-none text-center"
      >
        <span className="text-sm font-bold text-slate-700 dark:text-slate-300 leading-none">{size}</span>
        <span className="text-xs font-semibold text-slate-400 line-through leading-none mt-0.5">{price}</span>
        <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60">
          Out of stock
        </span>
      </div>
    );
  }

  // 2. LUXURY BRAND GRADIENTS & HIGH CONTRAST (Style 1)
  const theme = isMTN
    ? {
        cardBg: 'bg-gradient-to-b from-[#FBBF24] via-[#F59E0B] to-[#D97706] border-amber-300/40 shadow-[0_4px_16px_-4px_rgba(217,119,6,0.35)]',
        sizeText: 'text-slate-950 font-black',
        priceText: 'text-slate-950/85 font-extrabold',
        checkBg: 'bg-slate-950 text-amber-400',
        activeRing: 'ring-3 ring-offset-2 ring-slate-950 ring-offset-background scale-[1.03]',
      }
    : isTelecel
    ? {
        cardBg: 'bg-gradient-to-b from-rose-500 via-red-600 to-rose-700 border-red-400/30 shadow-[0_4px_16px_-4px_rgba(225,29,72,0.35)]',
        sizeText: 'text-white font-black',
        priceText: 'text-rose-100 font-extrabold',
        checkBg: 'bg-white text-red-600',
        activeRing: 'ring-3 ring-offset-2 ring-red-600 ring-offset-background scale-[1.03]',
      }
    : {
        // AirtelTigo: Rich Royal Sapphire & Cobalt Blue
        cardBg: 'bg-gradient-to-b from-[#2563EB] via-[#1D4ED8] to-[#1E3A8A] border-blue-400/30 shadow-[0_4px_16px_-4px_rgba(29,78,216,0.35)]',
        sizeText: 'text-white font-black',
        priceText: 'text-blue-100 font-extrabold',
        checkBg: 'bg-white text-blue-600',
        activeRing: 'ring-3 ring-offset-2 ring-blue-600 ring-offset-background scale-[1.03]',
      };

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`relative overflow-hidden flex flex-col items-center justify-center gap-1 min-h-[88px] rounded-2xl p-3 transition-all duration-150 cursor-pointer select-none border active:scale-[0.98] ${theme.cardBg} ${
        active
          ? `${theme.activeRing} shadow-lg z-10`
          : 'opacity-95 hover:opacity-100 hover:-translate-y-0.5 hover:shadow-md'
      }`}
    >
      {/* Subtle glossy card highlight in top corner */}
      <span className="pointer-events-none absolute -top-10 -right-10 w-24 h-24 rounded-full bg-white/15 blur-[2px]" />

      {/* Selected Checkmark Badge */}
      {active && (
        <span className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm ${theme.checkBg}`}>
          <Check className="w-3 h-3 stroke-[3]" />
        </span>
      )}

      {/* Bundle Size */}
      <span className={`text-base sm:text-lg tracking-tight leading-none drop-shadow-xs ${theme.sizeText}`}>
        {size}
      </span>

      {/* Bundle Price */}
      <span className={`text-xs sm:text-[13px] tracking-tight leading-none mt-0.5 ${theme.priceText}`}>
        {price}
      </span>
    </button>
  );
}
