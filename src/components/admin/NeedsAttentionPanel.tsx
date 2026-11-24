import { useNavigate } from 'react-router-dom';
import { AlertTriangle, XCircle, Clock, CreditCard, ShoppingCart, Scale, ChevronRight } from 'lucide-react';

interface AttentionItem {
  label: string;
  count: number;
  severity: 'error' | 'warning' | 'info';
  href: string;
  icon: React.ReactNode;
}

interface NeedsAttentionPanelProps {
  failedOrdersToday: number;
  pendingOrdersStale: number;
  unresolvedReconciliation: number;
  staleItems: number;
}

export function NeedsAttentionPanel({
  failedOrdersToday,
  pendingOrdersStale,
  unresolvedReconciliation,
  staleItems,
}: NeedsAttentionPanelProps) {
  const navigate = useNavigate();

  const items: AttentionItem[] = [
    { label: 'Failed Orders Today', count: failedOrdersToday, severity: 'error' as const, href: '/admin/orders?status=failed', icon: <XCircle className="w-4 h-4" /> },
    { label: 'Pending Orders >5 min', count: pendingOrdersStale, severity: 'warning' as const, href: '/admin/orders?status=pending', icon: <Clock className="w-4 h-4" /> },
    { label: 'Unresolved Reconciliation', count: unresolvedReconciliation, severity: 'error' as const, href: '/admin/reconciliation', icon: <Scale className="w-4 h-4" /> },
    { label: 'Stale / Stuck Items', count: staleItems, severity: 'warning' as const, href: '/admin/reconciliation', icon: <CreditCard className="w-4 h-4" /> },
  ].filter(i => i.count > 0);

  if (items.length === 0) {
    return (
      <div className="glass-card p-4 lg:p-5 card-shine border-t-2 border-t-success/40">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-success" />
          Operations Status
        </h3>
        <div className="flex items-center gap-2 text-success text-sm py-4 justify-center">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-medium">All clear — no issues require attention</span>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 lg:p-5 card-shine border-t-2 border-t-warning/40">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        Needs Attention
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-warning/10 text-warning font-bold">{items.length}</span>
      </h3>
      <div className="space-y-1">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => navigate(item.href)}
            className="flex items-center justify-between w-full py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors group text-left"
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                item.severity === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
              }`}>
                {item.icon}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold tabular-nums ${
                item.severity === 'error' ? 'text-destructive' : 'text-warning'
              }`}>{item.count}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
