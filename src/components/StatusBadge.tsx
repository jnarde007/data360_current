import { Badge } from '@/components/ui/badge';
import { RefreshCw, Clock } from 'lucide-react';

type StatusConfigEntry = {
  bg: string;
  text: string;
  border: string;
  label: string;
  icon?: 'pending' | 'processing';
};

const statusConfig: Record<string, StatusConfigEntry> = {
  // Order statuses
  pending:                      { bg: '#0072F5', text: '#FFFFFF', border: '#0072F5', label: 'Pending', icon: 'pending' },
  pending_confirmation:         { bg: '#0072F5', text: '#FFFFFF', border: '#0072F5', label: 'Awaiting Processing', icon: 'pending' },
  pending_manual:               { bg: '#0072F5', text: '#FFFFFF', border: '#0072F5', label: 'Pending', icon: 'pending' },
  processing:                   { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B', label: 'Processing', icon: 'processing' },
  awaiting_manual_fulfillment:  { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B', label: 'Processing', icon: 'processing' },
  delivered:                    { bg: '#DCFCE7', text: '#166534', border: '#22C55E', label: 'Delivered' },
  approved:                     { bg: '#DCFCE7', text: '#166534', border: '#22C55E', label: 'Approved' },
  failed:                       { bg: '#FEE2E2', text: '#991B1B', border: '#EF4444', label: 'Failed' },
  // Derived customer-facing statuses (see src/lib/order-resolution.ts)
  being_resolved:               { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B', label: 'Order Being Resolved', icon: 'processing' },
  refund_processing:            { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B', label: 'Refund Processing', icon: 'processing' },
  failed_refunded:              { bg: '#FFF0EE', text: '#C23B22', border: '#FF7F7F', label: 'Failed — Refunded' },
  rejected:                     { bg: '#FFF0EE', text: '#C23B22', border: '#FF7F7F', label: 'Refunded' },
  refunded:                     { bg: '#FFF0EE', text: '#C23B22', border: '#FF7F7F', label: 'Refunded' },
  cancelled:                    { bg: '#F1F5F9', text: '#334155', border: '#64748B', label: 'Cancelled' },
  customer_cancelled:           { bg: '#F1F5F9', text: '#334155', border: '#64748B', label: 'Cancelled' },
  cancelled_before_processing:  { bg: '#F1F5F9', text: '#334155', border: '#64748B', label: 'Cancelled' },
  // Customer / ticket statuses
  active:    { bg: '#DCFCE7', text: '#166534', border: '#22C55E', label: 'Active' },
  suspended: { bg: '#FEE2E2', text: '#991B1B', border: '#EF4444', label: 'Suspended' },
  submitted: { bg: '#EDE9FE', text: '#5B21B6', border: '#8B5CF6', label: 'Submitted' },
  open:      { bg: 'hsl(var(--primary))', text: 'hsl(var(--primary-foreground))', border: 'hsl(var(--primary))', label: 'Open' },
  resolved:  { bg: '#DCFCE7', text: '#166534', border: '#22C55E', label: 'Resolved' },
  closed:    { bg: '#F1F5F9', text: '#334155', border: '#64748B', label: 'Closed' },
};

const fallback: StatusConfigEntry = { bg: '#F1F5F9', text: '#334155', border: '#64748B', label: '' };

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { ...fallback, label: status };

  const renderIndicator = () => {
    if (config.icon === 'pending') {
      return <Clock className="w-3 h-3 animate-spin" style={{ animationDuration: '2s' }} />;
    }
    if (config.icon === 'processing') {
      return <RefreshCw className="w-3 h-3 animate-spin" style={{ animationDuration: '2s' }} />;
    }
    return <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.border }} />;
  };

  return (
    <Badge
      variant="outline"
      className="capitalize text-[10px] font-semibold gap-1.5 px-2 py-0.5"
      style={{ background: config.bg, color: config.text, borderColor: config.border }}
    >
      {renderIndicator()}
      {config.label}
    </Badge>
  );
}
