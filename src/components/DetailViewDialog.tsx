import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getNetworkAccent } from '@/lib/network-colors';

export interface DetailHero {
  network: string;
  logo?: string;
  heading: React.ReactNode;
  caption?: React.ReactNode;
  amount?: React.ReactNode;
  status?: React.ReactNode;
}

export interface DetailField {
  label: string;
  value: React.ReactNode;
  className?: string;
  emphasized?: boolean;
  dividerBefore?: boolean;
}

interface DetailViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  fields: DetailField[];
  icon?: React.ReactNode;
  onReportIssue?: () => void;
  hero?: DetailHero;
}

export function DetailViewDialog({ open, onOpenChange, title, subtitle, fields, icon, onReportIssue, hero }: DetailViewDialogProps) {
  const accent = hero ? getNetworkAccent(hero.network) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[420px] p-0 overflow-hidden gap-0 border-border/40 shadow-xl [&>button]:h-8 [&>button]:w-8 [&>button]:top-3.5 [&>button]:right-3.5 [&>button]:rounded-full [&>button]:border [&>button]:border-border/50 [&>button]:bg-muted/50 [&>button:hover]:bg-muted [&>button]:transition-all [&>button]:duration-150 [&>button_svg]:h-3.5 [&>button_svg]:w-3.5 [&>button]:opacity-70 [&>button:hover]:opacity-100"
        style={{ borderRadius: '20px' }}
      >
        {accent && <div className={accent.topBar} />}
        {/* Header */}
        <div className={cn("px-6 pt-5 pb-4", accent ? accent.headerGlow : "bg-gradient-to-b from-primary/[0.04] to-transparent dark:from-primary/[0.08]")}>
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-foreground pr-10">
              {icon}
              <span>{title}</span>
            </DialogTitle>
            {subtitle && (
              <p className="text-xs font-mono font-semibold text-primary/80 tracking-wide">{subtitle}</p>
            )}
            <DialogDescription className="sr-only">{subtitle ? `${title} ${subtitle}` : title}</DialogDescription>
          </DialogHeader>
          {hero && accent && (
            <div className="mt-4 flex items-center gap-3">
              {hero.logo && (
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0", accent.logoRing)}>
                  <img src={hero.logo} alt={hero.network} className="w-8 h-8 rounded-xl object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-foreground leading-tight truncate">{hero.heading}</p>
                {hero.caption && <p className="text-xs text-muted-foreground mt-0.5 truncate">{hero.caption}</p>}
              </div>
              <div className="text-right shrink-0 space-y-1">
                {hero.amount && <p className={cn("text-lg font-extrabold leading-none", accent.totalText)}>{hero.amount}</p>}
                {hero.status}
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="px-5 pb-5 pt-1 space-y-4">
          {/* Fields card */}
          <div className={cn("rounded-2xl border bg-card dark:bg-card/50 overflow-hidden shadow-sm", accent ? accent.summaryBox : "border-border/40")}>
            {fields.map((f, i) => (
              <div key={i}>
                {f.dividerBefore && (
                  <div className="mx-4 border-t-[1.5px] border-border/40 dark:border-border/30" />
                )}
                <div className={cn(
                  "flex justify-between items-center gap-4 px-4",
                  f.emphasized ? "py-3.5" : "py-2.5",
                  i > 0 && !f.dividerBefore && "border-t border-border/20 dark:border-border/15",
                  f.className,
                )}>
                  <span className={cn(
                    "text-[12.5px] shrink-0 tracking-wide",
                    f.emphasized ? "font-semibold text-foreground/80 uppercase text-[11px]" : "text-muted-foreground",
                  )}>{f.label}</span>
                  <div className={cn(
                    "text-right min-w-0",
                    f.emphasized
                      ? "text-lg font-bold text-primary"
                      : "text-[13px] text-foreground font-medium",
                  )}>{f.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Report Issue Button */}
          {onReportIssue && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 h-10 text-xs font-medium text-muted-foreground/80 hover:text-foreground border-border/50 hover:border-border/80 rounded-xl transition-all"
              onClick={onReportIssue}
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              Report an Issue
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
