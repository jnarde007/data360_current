import { Crown } from 'lucide-react';

export function SuperAgentBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-amber/15 px-2.5 py-0.5 text-xs font-semibold text-amber ${className}`}>
      <Crown className="h-3.5 w-3.5" /> Super Agent
    </span>
  );
}
