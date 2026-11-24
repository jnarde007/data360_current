import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, CheckCircle2, XCircle, Wrench, Eye, ExternalLink,
  Wallet, ShoppingCart, CreditCard, Users, Activity, Info,
  ArrowRight, Search, ClipboardCheck, Ban, RotateCcw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// ── Types (shared with parent) ──────────────────────────────

export type Severity = 'passed' | 'warning' | 'error' | 'auto-fixed' | 'review_needed' | 'in_review' | 'resolved' | 'ignored';
export type Category = 'wallet' | 'order' | 'topup' | 'user' | 'grace_period';

export interface HealthIssue {
  id: string;
  category: Category;
  type: string;
  severity: Severity;
  summary: string;
  reference?: string;
  customerId?: string;
  customerName?: string;
  detectedAt: string;
  amount?: number;
  orderStatus?: string;
  topupStatus?: string;
  orderId?: string;
}

export const SEVERITY_CONFIG: Record<Severity, { label: string; variant: string; icon: React.ElementType }> = {
  passed: { label: 'Passed', variant: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  warning: { label: 'Warning', variant: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', icon: AlertTriangle },
  error: { label: 'Error', variant: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
  'auto-fixed': { label: 'Auto-Fixed', variant: 'bg-primary text-primary-foreground border-primary', icon: Wrench },
  review_needed: { label: 'Review Needed', variant: 'bg-orange-500/15 text-orange-400 border-orange-500/30', icon: Eye },
  in_review: { label: 'In Review', variant: 'bg-purple-500/15 text-purple-400 border-purple-500/30', icon: Search },
  resolved: { label: 'Resolved', variant: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  ignored: { label: 'Ignored', variant: 'bg-muted text-muted-foreground border-border', icon: Ban },
};

export const CATEGORY_ICONS: Record<Category, React.ElementType> = {
  wallet: Wallet,
  order: ShoppingCart,
  topup: CreditCard,
  user: Users,
  grace_period: Activity,
};

// ── Diagnostic knowledge base ───────────────────────────────

const ISSUE_KNOWLEDGE: Record<string, {
  explanation: string;
  detectionRule: string;
  recommendedAction: string[];
}> = {
  'Wallet / Ledger Variance': {
    explanation: 'The customer\'s displayed wallet balance does not match the sum of all their wallet transactions (credits minus debits). This could indicate a missing transaction record, a duplicate credit/debit, or a direct balance edit that bypassed the ledger.',
    detectionRule: 'Compares the customer\'s wallet_balance field against the calculated sum of all wallet_transactions for that customer. Flags when the difference exceeds GHS 0.01.',
    recommendedAction: [
      'Open the Wallet Ledger for this customer and review all transactions',
      'Check for any manual balance adjustments that may not have a matching ledger entry',
      'If a transaction is missing, create a corrective wallet transaction to align the balance',
      'If the balance field is wrong, update it via the customer management page',
    ],
  },
  'Duplicate Wallet Credit': {
    explanation: 'The same reference ID was used to credit a customer\'s wallet more than once. This usually happens when a payment webhook fires multiple times or a manual credit was accidentally applied twice.',
    detectionRule: 'Groups all credit-type wallet transactions by customer + reference, and flags any combination that appears more than once.',
    recommendedAction: [
      'Open the Wallet Ledger and search for the duplicate reference',
      'Verify with the payment provider whether the payment was actually received multiple times',
      'If the duplicate credit is confirmed, create a corrective debit transaction to reverse the extra amount',
      'Check the customer\'s current balance to confirm it reflects the correct amount',
    ],
  },
  'Stuck Grace-Period Order': {
    explanation: 'This order is still in "pending_confirmation" status but its grace period expired more than 5 minutes ago. The automated processing system (which runs every minute) should have moved it to the fulfillment queue, but it remains stuck.',
    detectionRule: 'Finds orders with status "pending_confirmation" where grace_period_ends_at is more than 5 minutes in the past. This buffer avoids flagging orders that are still being processed by the automated system.',
    recommendedAction: [
      'Use the "Auto-Fix Safe" button to trigger reprocessing of stuck grace-period orders',
      'If auto-fix doesn\'t resolve it, open the Order Inspector to check the order details',
      'Manually update the order status if needed (deliver, reject, or cancel)',
      'Check if the customer was charged — if so, ensure the order is fulfilled or refunded',
    ],
  },
  'Missing Refund for Cancelled/Rejected Order': {
    explanation: 'This order was cancelled or rejected (a refund-eligible terminal state) and the customer\'s wallet was debited, but no matching refund/credit transaction was found. The customer may have lost money. Note: delivered orders are NOT checked by this rule since they do not require refunds.',
    detectionRule: 'Checks orders with refund-eligible statuses only (customer_cancelled, cancelled_before_processing, rejected, refunded) and looks for a matching credit wallet transaction referencing the order\'s short_id or REF-short_id. Delivered orders are explicitly excluded.',
    recommendedAction: [
      'Open the Order Inspector to confirm the order status and amount charged',
      'Verify the original wallet debit exists in the Wallet Ledger',
      'Check if a refund was issued under a different reference (e.g. REF-ORD-xxxx or ADMIN-xxxx)',
      'If no refund exists, manually credit the customer\'s wallet with the order amount',
      'Document the correction in the admin activity log',
    ],
  },
  'Missing Refund for Terminal Order': {
    explanation: 'This is a legacy issue type. The system now only checks refund-eligible statuses (cancelled, rejected) — not delivered orders. If you see this, re-run the health check for updated results.',
    detectionRule: 'This rule has been replaced by "Missing Refund for Cancelled/Rejected Order" which excludes delivered orders.',
    recommendedAction: [
      'Re-run the health check to get updated results with the refined detection logic',
      'If the order was delivered, this was a false positive — mark as Ignored',
    ],
  },
  'Approved Topup Without Credit': {
    explanation: 'A wallet top-up was marked as "approved" (payment confirmed) but no corresponding wallet credit transaction could be found using any of the three matching strategies. This check only applies to topups older than 2 minutes, allowing time for webhook processing and wallet crediting to complete. Paystack topups use PSK-prefixed references that differ from the topup short_id, so the system uses additional matching methods to avoid false positives.',
    detectionRule: 'Finds approved topups older than 2 minutes and attempts to match a wallet credit in three steps: (1) Direct match — looks for the topup short_id (e.g. TOP-1019) in the wallet transaction reference or description. (2) Paystack-specific — for Paystack topups, searches for PSK-prefixed credits matching the same customer and amount within a time window (1 minute before to 5 minutes after the topup). (3) Proximity fallback — for any method, matches by same customer + same amount within the same time window. The issue is only flagged if all three strategies fail.',
    recommendedAction: [
      'Verify the payment was actually received by checking the payment provider',
      'Open the Wallet Ledger to check if a credit exists under a PSK- reference or different description',
      'If the topup is very recent (under 5 minutes), re-run the scan — the credit may still be processing',
      'If payment is confirmed but no credit exists, manually credit the customer\'s wallet with the topup amount',
      'If the payment was not actually received, update the topup status to "rejected"',
    ],
  },
  'Orphaned Topup': {
    explanation: 'An approved top-up record exists but has no associated customer. This could happen if the customer was deleted after the topup was created, or if the payment webhook could not identify the customer.',
    detectionRule: 'Finds approved topups where the customer_id is null.',
    recommendedAction: [
      'Check if the customer was recently deleted or archived',
      'If the customer exists elsewhere, re-link the topup to the correct customer ID',
      'If the topup is invalid, update its status to reflect the actual state',
    ],
  },
  'Topup Needs Review': {
    explanation: 'This top-up has been flagged with a "review_needed" status, indicating the payment verification returned an ambiguous result or requires manual confirmation.',
    detectionRule: 'Finds topups with status "review_needed".',
    recommendedAction: [
      'Check the payment provider for the actual transaction status',
      'If payment was received, approve the topup and credit the wallet',
      'If payment was not received or failed, reject the topup',
    ],
  },
  'Possible Duplicate Order': {
    explanation: 'Two or more active orders were placed for the same phone number, bundle size, and network within a 10-minute window. This may be intentional but could also be an accidental double-submit.',
    detectionRule: 'Groups recent non-terminal orders by recipient phone + bundle size + network and flags pairs created within 10 minutes of each other.',
    recommendedAction: [
      'Open both orders in the Order Inspector to compare details',
      'Contact the customer to confirm whether both orders are intentional',
      'If one is a duplicate, cancel it and process a refund',
      'Check if the data bundles were actually delivered for both orders',
    ],
  },
  'Deleted User With Auth Link': {
    explanation: 'A customer account marked as "deleted" still has an active auth_user_id link. This means the authentication record still exists and could prevent the user from re-registering with the same email address.',
    detectionRule: 'Finds customers with status "deleted" where auth_user_id is not null.',
    recommendedAction: [
      'Open the Customer management page and review the deleted user',
      'Use the "Repair Signup Blockers" function to clear the auth link',
      'Verify the user can now re-register if needed',
    ],
  },
};

// ── Component ───────────────────────────────────────────────

interface HealthIssueDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: HealthIssue | null;
  onStatusChange: (issueId: string, newStatus: Severity) => void;
}

export function HealthIssueDetailDialog({ open, onOpenChange, issue, onStatusChange }: HealthIssueDetailDialogProps) {
  const navigate = useNavigate();

  if (!issue) return null;

  const sevCfg = SEVERITY_CONFIG[issue.severity];
  const SevIcon = sevCfg.icon;
  const CatIcon = CATEGORY_ICONS[issue.category];
  const knowledge = ISSUE_KNOWLEDGE[issue.type];

  const handleNavigate = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const quickLinks: { label: string; icon: React.ElementType; path: string }[] = [];

  if (issue.reference?.startsWith('ORD-')) {
    quickLinks.push({ label: 'View Order', icon: ShoppingCart, path: `/admin/orders?search=${issue.reference}` });
  }
  if (issue.reference?.startsWith('TOP-')) {
    quickLinks.push({ label: 'View Topup', icon: CreditCard, path: `/admin/topups?search=${issue.reference}` });
  }
  if (issue.customerId) {
    quickLinks.push({ label: 'View Customer', icon: Users, path: `/admin/customers?search=${issue.customerName || issue.customerId}` });
    quickLinks.push({ label: 'Wallet Ledger', icon: Wallet, path: `/admin/wallet-ledger?customer=${issue.customerId}` });
  }
  quickLinks.push({ label: 'Reconciliation', icon: ClipboardCheck, path: '/admin/reconciliation' });

  const isActionable = !['passed', 'auto-fixed', 'resolved', 'ignored'].includes(issue.severity);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0 max-h-[90vh] overflow-y-auto [&>button]:h-8 [&>button]:w-8 [&>button]:top-4 [&>button]:right-4 [&>button]:rounded-[10px] [&>button]:border [&>button]:border-border/50 [&>button]:bg-muted/30 [&>button:hover]:bg-muted/80 [&>button]:transition-all [&>button]:duration-150 [&>button_svg]:h-4 [&>button_svg]:w-4 [&>button]:opacity-80 [&>button:hover]:opacity-100">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border/60 bg-muted/20">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2.5 text-base font-bold tracking-tight pr-8">
              <CatIcon className="w-5 h-5 text-primary shrink-0" />
              <span>{issue.type}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">{issue.summary}</DialogDescription>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border', sevCfg.variant)}>
                <SevIcon className="w-3 h-3" />{sevCfg.label}
              </span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {issue.category.replace('_', ' ')}
              </Badge>
              {issue.reference && (
                <span className="font-mono text-xs text-primary bg-primary/5 px-2 py-0.5 rounded">{issue.reference}</span>
              )}
            </div>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Summary */}
          <div className="rounded-xl bg-muted/30 border border-border/60 p-4">
            <p className="text-sm text-foreground leading-relaxed">{issue.summary}</p>
          </div>

          {/* What this means */}
          {knowledge && (
            <Section title="What This Means" icon={Info}>
              <p className="text-sm text-muted-foreground leading-relaxed">{knowledge.explanation}</p>
            </Section>
          )}

          {/* Affected Record */}
          <Section title="Affected Record" icon={Search}>
            <div className="rounded-lg bg-muted/30 border border-border/60 overflow-hidden">
              {issue.reference && (
                <DetailRow label="Reference" value={<span className="font-mono text-primary">{issue.reference}</span>} />
              )}
              {issue.customerName && (
                <DetailRow label="Customer" value={issue.customerName} />
              )}
              {issue.customerId && (
                <DetailRow label="Customer ID" value={<span className="font-mono text-xs">{issue.customerId.slice(0, 8)}…</span>} />
              )}
              {issue.amount !== undefined && (
                <DetailRow label="Amount" value={<span className="font-semibold">GHS {issue.amount.toFixed(2)}</span>} />
              )}
              {issue.orderStatus && (
                <DetailRow label="Order Status" value={<span className="capitalize">{issue.orderStatus}</span>} />
              )}
              {issue.topupStatus && (
                <DetailRow label="Topup Status" value={<span className="capitalize">{issue.topupStatus}</span>} />
              )}
              <DetailRow label="Detected At" value={new Date(issue.detectedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} />
            </div>
          </Section>

          {/* Detection Rule */}
          {knowledge && (
            <Section title="Why This Was Flagged" icon={AlertTriangle}>
              <p className="text-sm text-muted-foreground leading-relaxed">{knowledge.detectionRule}</p>
            </Section>
          )}

          {/* Recommended Actions */}
          {knowledge && (
            <Section title="Recommended Actions" icon={ClipboardCheck}>
              <ol className="space-y-2">
                {knowledge.recommendedAction.map((step, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="text-primary font-semibold shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* Quick Links */}
          {quickLinks.length > 0 && (
            <Section title="Quick Links" icon={ExternalLink}>
              <div className="flex flex-wrap gap-2">
                {quickLinks.map((link, i) => {
                  const LinkIcon = link.icon;
                  return (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs h-8"
                      onClick={() => handleNavigate(link.path)}
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                      {link.label}
                      <ArrowRight className="w-3 h-3 ml-0.5" />
                    </Button>
                  );
                })}
              </div>
            </Section>
          )}

          <Separator />

          {/* Workflow Actions */}
          {isActionable && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => onStatusChange(issue.id, 'in_review')}
              >
                <Search className="w-3.5 h-3.5" />
                Mark In Review
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => onStatusChange(issue.id, 'resolved')}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mark Resolved
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground"
                onClick={() => onStatusChange(issue.id, 'ignored')}
              >
                <Ban className="w-3.5 h-3.5" />
                Ignore
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ──────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </h4>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-4 px-4 py-2.5 border-t border-border/30 first:border-t-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="text-sm text-foreground text-right font-medium">{value}</div>
    </div>
  );
}
