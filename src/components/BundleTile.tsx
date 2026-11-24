import { Check } from 'lucide-react';
import { getNetworkTile } from '@/lib/network-colors';

interface Props {
  network: string;
  size: string;
  price: string;
  active: boolean;
  onClick: () => void;
}

export function BundleTile({ network, size, price, active, onClick }: Props) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`relative overflow-hidden flex flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-3 text-white transition-all duration-150 active:scale-[0.97] ${getNetworkTile(network)} ${
        active
          ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/70 scale-[1.03]'
          : 'opacity-90 hover:opacity-100 hover:-translate-y-0.5'
      }`}
    >
      <span className="pointer-events-none absolute -top-6 -right-6 w-14 h-14 rounded-full bg-white/15" />
      {active && (
        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-white/90 flex items-center justify-center">
          <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
        </span>
      )}
      <span className="relative text-base font-extrabold tracking-tight drop-shadow-sm">{size}</span>
      <span className="relative text-[11px] font-semibold text-white/90">{price}</span>
    </button>
  );
}
