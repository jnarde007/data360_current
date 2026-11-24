import { Loader2, ArrowDown } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  refreshing: boolean;
  pulling: boolean;
}

export function PullToRefreshIndicator({ pullDistance, refreshing, pulling }: PullToRefreshIndicatorProps) {
  if (!pulling && pullDistance === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center pointer-events-none transition-transform duration-200"
      style={{ transform: `translateY(${pullDistance - 40}px)`, opacity: Math.min(pullDistance / 60, 1) }}
    >
      <div className="w-10 h-10 rounded-full bg-primary/10 backdrop-blur-sm border border-primary/20 flex items-center justify-center">
        {refreshing ? (
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        ) : (
          <ArrowDown className="w-5 h-5 text-primary transition-transform" style={{ transform: pullDistance > 60 ? 'rotate(180deg)' : 'none' }} />
        )}
      </div>
    </div>
  );
}
