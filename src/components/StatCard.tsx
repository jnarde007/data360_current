import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  subtitle?: string;
  secondaryValue?: string;
  breakdown?: { label: string; value: string }[];
  accent?: 'teal' | 'amber' | 'blue' | 'purple' | 'green' | 'red';
  className?: string;
  /** Navigate to this route on click */
  href?: string;
}

const accentStyles = {
  teal:   { icon: 'icon-box-teal',        tint: 'bg-gradient-to-br from-teal/[0.08] via-card to-card',           border: 'border-l-[3px] border-l-teal/60',        glow: 'hover:shadow-[0_10px_30px_-10px_hsl(var(--teal)/0.25)]',        value: 'text-teal' },
  amber:  { icon: 'icon-box-amber',       tint: 'bg-gradient-to-br from-amber/[0.08] via-card to-card',          border: 'border-l-[3px] border-l-amber/60',       glow: 'hover:shadow-[0_10px_30px_-10px_hsl(var(--amber)/0.25)]',       value: 'text-amber' },
  blue:   { icon: 'icon-box-primary',     tint: 'bg-gradient-to-br from-primary/[0.08] via-card to-card',        border: 'border-l-[3px] border-l-primary/60',     glow: 'hover:shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.25)]',     value: 'text-primary' },
  purple: { icon: 'icon-box-purple',      tint: 'bg-gradient-to-br from-purple/[0.08] via-card to-card',         border: 'border-l-[3px] border-l-purple/60',      glow: 'hover:shadow-[0_10px_30px_-10px_hsl(var(--purple)/0.25)]',      value: 'text-purple' },
  green:  { icon: 'icon-box-success',     tint: 'bg-gradient-to-br from-success/[0.08] via-card to-card',        border: 'border-l-[3px] border-l-success/60',     glow: 'hover:shadow-[0_10px_30px_-10px_hsl(var(--success)/0.25)]',     value: 'text-success' },
  red:    { icon: 'icon-box-destructive', tint: 'bg-gradient-to-br from-destructive/[0.08] via-card to-card',    border: 'border-l-[3px] border-l-destructive/60', glow: 'hover:shadow-[0_10px_30px_-10px_hsl(var(--destructive)/0.25)]', value: 'text-destructive' },
};

export function StatCard({ title, value, icon, subtitle, secondaryValue, breakdown, accent, className = '', href }: StatCardProps) {
  const a = accent ? accentStyles[accent] : null;
  const navigate = useNavigate();

  const handleClick = () => {
    if (href) navigate(href);
  };

  return (
    <div
      className={`kpi-card group card-shine card-hover ${a ? `${a.border} ${a.tint} ${a.glow}` : ''} ${href ? 'cursor-pointer' : ''} ${className}`}
      onClick={handleClick}
      role={href ? 'link' : undefined}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">{title}</p>
        <div className={`icon-box icon-box-md transition-transform duration-300 group-hover:scale-110 ${a ? a.icon : 'icon-box-primary'}`}>
          {icon}
        </div>
      </div>
      <div className="mt-auto">
        <p className={`text-[1.65rem] font-bold tabular-nums tracking-tight leading-none ${a ? a.value : 'text-foreground'}`}>{value}</p>
        {secondaryValue && (
          <p className="text-[11px] text-muted-foreground/60 mt-2.5 tabular-nums font-medium">{secondaryValue}</p>
        )}
        {breakdown && breakdown.length > 0 && (
          <div className="mt-3 pt-3 card-divider space-y-1.5">
            {breakdown.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground/60">{item.label}</span>
                <span className="text-muted-foreground tabular-nums font-medium">{item.value}</span>
              </div>
            ))}
          </div>
        )}
        {subtitle && (
          <p className="text-[11px] text-muted-foreground/50 mt-2.5 leading-relaxed">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
