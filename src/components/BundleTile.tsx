import { Check } from 'lucide-react';
import { getNetworkTile } from '@/lib/network-colors';

interface Props {
  network: string;
  size: string;
  price: string;
  active: boolean;
  isAvailable?: boolean;
  onClick: () => void;
}

export function BundleTile({ network, size, price, active, isAvailable = true, onClick }: Props) {
  const disabled = !isAvailable;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={`relative overflow-hidden flex flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-3 transition-all duration-150 ${
        disabled
          ? 'cursor-not-allowed bg-secondary/80 border border-dashed border-border/80 text-foreground'
          : `text-white ${getNetworkTile(network)} active:scale-[0.97] ${
              active
                ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/70 scale-[1.03]'
                : 'opacity-90 hover:opacity-100 hover:-translate-y-0.5'
            }`
      }`}
    >
      <span className="pointer-events-none absolute -top-6 -right-6 w-14 h-14 rounded-full bg-white/15" />
      {active && !disabled && (
        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-white/90 flex items-center justify-center">
          <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
        </span>
      )}
      <span className={`relative text-base font-extrabold tracking-tight ${disabled ? 'text-muted-foreground' : 'text-white drop-shadow-sm'}`}>
        {size}
      </span>
      <span className={`relative text-[11px] font-semibold ${disabled ? 'text-muted-foreground/70 line-through' : 'text-white/90'}`}>
        {price}
      </span>
      {disabled && (
        <span className="relative mt-1 text-[9px] font-bold uppercase tracking-wider bg-destructive/15 text-destructive border border-destructive/20 px-2 py-0.5 rounded-full">
          Out of stock
        </span>
      )}
    </button>
  );
}
