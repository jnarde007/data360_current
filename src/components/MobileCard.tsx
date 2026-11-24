import { cn } from '@/lib/utils';

interface MobileCardField {
  label: string;
  value: React.ReactNode;
  className?: string;
}

interface MobileCardProps {
  fields: MobileCardField[];
  className?: string;
  action?: React.ReactNode;
}

export function MobileCard({ fields, className, action }: MobileCardProps) {
  return (
    <div className={cn('glass-card glow-border p-4 sm:p-5 space-y-3', className)}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {fields.map((f, i) => (
          <div key={i} className={cn(f.className)}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{f.label}</p>
            <div className="text-sm text-foreground mt-0.5">{f.value}</div>
          </div>
        ))}
      </div>
      {action && <div className="pt-2 card-divider">{action}</div>}
    </div>
  );
}
