import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { formatGHS } from '@/lib/mock-data';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Wallet, Clock, FileText, Link2, ExternalLink, RotateCcw, RefreshCw, UserX, PlayCircle, ShieldAlert } from 'lucide-react';
import { BuyerTypeBadge, AffiliateBadge, FulfillmentModeBadge } from '@/components/admin/AdminBadges';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  buildRefundEvidence, deriveProviderStatus, evaluateReprocess,
  providerFailureReason, EMPTY_REFUND_EVIDENCE, type RefundEvidence,
} from '@/lib/order-resolution';

interface OrderInspectorProps {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FullOrder {
  id: string;
  short_id: string;
  network: string;
  bundle_size: string;
  recipient_phone: string;
  quantity: number;
  total_amount: number;
  cost_price: number;
  status: string;
  delivery_mode: string;
  provider_name: string;
  provider_order_id: string;
  provider_reference: string;
  provider_response: any;
  grace_period_ends_at: string | null;
  created_at: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  // Guest fields
  buyer_type: string;
  buyer_phone: string;
  buyer_email: string;
  affiliate_code: string;
  tracking_token: string | null;
  linked_customer_id: string | null;
  payment_method: string;
  payment_reference: string;
  customer_phone: string;
  customer_balance: number;
}

interface WalletImpact {
  balanceBefore: number;
  deducted: number;
  balanceAfter: number;
  txReference: string;
  txId: string;
}

interface TimelineEvent {
  time: string;
  event: string;
  detail?: string;
}

export function OrderInspector({ orderId, open, onOpenChange }: OrderInspectorProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<FullOrder | null>(null);
  const [walletImpact, setWalletImpact] = useState<WalletImpact | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [relatedRefund, setRelatedRefund] = useState<any>(null);
  const [refundRecord, setRefundRecord] = useState<any>(null);
  const [retryingRefund, setRetryingRefund] = useState(false);
  const [evidence, setEvidence] = useState<RefundEvidence>(EMPTY_REFUND_EVIDENCE);
  const [networkAvailable, setNetworkAvailable] = useState<boolean | null>(null);
  const [reprocessLogs, setReprocessLogs] = useState<any[]>([]);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  useEffect(() => {
    if (!orderId || !open) return;
    loadOrder(orderId);
  }, [orderId, open]);

  const loadOrder = async (id: string) => {
    setLoading(true);
    try {
      const [{ data: oBase }, { data: oCost }] = await Promise.all([
        supabase.from('orders').select('*, customers(full_name, email, phone, wallet_balance)').eq('id', id).single(),
        supabase.from('orders_admin' as any).select('cost_price').eq('id', id).single(),
      ]);
      const o: any = oBase ? { ...oBase, cost_price: (oCost as any)?.cost_price ?? 0 } : null;

      if (!o) return;

      const fullOrder: FullOrder = {
        id: o.id, short_id: o.short_id, network: o.network,
        bundle_size: o.bundle_size, recipient_phone: o.recipient_phone,
        quantity: o.quantity, total_amount: Number(o.total_amount),
        cost_price: Number(o.cost_price), status: o.status,
        delivery_mode: o.delivery_mode, provider_name: o.provider_name,
        provider_order_id: o.provider_order_id, provider_reference: o.provider_reference,
        provider_response: o.provider_response,
        grace_period_ends_at: o.grace_period_ends_at, created_at: o.created_at,
        customer_id: o.customer_id,
        customer_name: (o as any).customers?.full_name || (o.buyer_type === 'guest' ? (o.buyer_phone || 'Guest') : 'Unknown'),
        customer_email: (o as any).customers?.email || o.buyer_email || '',
        buyer_type: o.buyer_type || 'registered',
        buyer_phone: o.buyer_phone || '',
        buyer_email: o.buyer_email || '',
        affiliate_code: o.affiliate_code || '',
        tracking_token: o.tracking_token || null,
        linked_customer_id: o.linked_customer_id || null,
        payment_method: o.payment_method || 'wallet',
        payment_reference: o.payment_reference || '',
        customer_phone: (o as any).customers?.phone || o.buyer_phone || '',
        customer_balance: Number((o as any).customers?.wallet_balance || 0),
      };
      setOrder(fullOrder);

      // Wallet impact (only for registered users)
      if (o.customer_id) {
        const { data: txs } = await supabase
          .from('wallet_transactions')
          .select('id, amount, type, reference, created_at')
          .eq('customer_id', o.customer_id)
          .or(`reference.eq.${o.short_id},description.ilike.%${o.short_id}%`)
          .order('created_at', { ascending: true });

        const debitTx = (txs || []).find(t => t.type === 'debit');
        const refundTx = (txs || []).find(t => t.type === 'credit');
        setRelatedRefund(refundTx || null);

        if (debitTx) {
          const currentBalance = Number((o as any).customers?.wallet_balance || 0);
          setWalletImpact({
            deducted: Number(debitTx.amount),
            balanceBefore: currentBalance + Number(debitTx.amount) - (refundTx ? Number(refundTx.amount) : 0),
            balanceAfter: currentBalance,
            txReference: debitTx.reference,
            txId: debitTx.id,
          });
        } else {
          setWalletImpact(null);
        }
      } else {
        setWalletImpact(null);
        setRelatedRefund(null);
      }

      // Load refund record from refunds table
      const { data: refundData } = await supabase
        .from('refunds')
        .select('*')
        .eq('order_id', o.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setRefundRecord(refundData || null);

      // Refund evidence: a refund only counts when the ledger confirms it.
      const { data: legacyCredit } = await supabase
        .from('wallet_transactions')
        .select('amount, created_at')
        .eq('reference', `REF-${o.short_id}`)
        .eq('type', 'credit')
        .maybeSingle();
      setEvidence(buildRefundEvidence(refundData as never, (legacyCredit as never) || null));

      // Reprocess context: network availability + prior reprocess attempts.
      const [{ data: netCfg }, { data: logs }] = await Promise.all([
        supabase.from('network_api_configs').select('available_for_purchase').eq('network', o.network).maybeSingle(),
        supabase.from('admin_activity_logs').select('id, created_at, details')
          .eq('action', 'order_reprocessed').eq('target_id', o.id)
          .order('created_at', { ascending: false }),
      ]);
      setNetworkAvailable(netCfg ? netCfg.available_for_purchase === true : null);
      setReprocessLogs(logs || []);

      // Build timeline
      const events: TimelineEvent[] = [];
      events.push({ time: o.created_at, event: 'Order Created', detail: `${o.network} ${o.bundle_size} to ${o.recipient_phone}` });

      if (o.buyer_type === 'guest') {
        events.push({ time: o.created_at, event: 'Guest Purchase', detail: `Buyer: ${o.buyer_phone}${o.buyer_email ? ` (${o.buyer_email})` : ''}` });
      }

      if (o.affiliate_code) {
        events.push({ time: o.created_at, event: 'Affiliate Attribution', detail: `Code: ${o.affiliate_code}` });
      }

      if (o.payment_method === 'paystack' && o.payment_reference) {
        events.push({ time: o.created_at, event: 'Paystack Payment', detail: `Ref: ${o.payment_reference}` });
      } else if (o.customer_id) {
        events.push({ time: o.created_at, event: 'Wallet Deducted', detail: `${formatGHS(Number(o.total_amount))} charged` });
      }

      if (o.grace_period_ends_at) {
        events.push({ time: o.created_at, event: 'Grace Period Started', detail: `Ends at ${new Date(o.grace_period_ends_at).toLocaleTimeString()}` });
      }

      if (o.delivery_mode === 'api' && o.provider_name) {
        events.push({ time: o.created_at, event: 'Sent to Provider', detail: o.provider_name });
      }

      if (o.provider_order_id) {
        events.push({ time: o.created_at, event: 'Provider Response', detail: `Order ID: ${o.provider_order_id}` });
      }

      if (o.status === 'delivered') {
        events.push({ time: o.created_at, event: 'Delivered', detail: 'Successfully completed' });
      } else if (o.status === 'failed') {
        events.push({ time: o.created_at, event: 'Failed', detail: 'Order could not be fulfilled' });
      } else if (['customer_cancelled', 'cancelled_before_processing'].includes(o.status)) {
        events.push({ time: o.created_at, event: 'Cancelled', detail: 'Order was cancelled' });
      } else if (o.status === 'rejected') {
        events.push({ time: o.created_at, event: 'Rejected & Refunded', detail: 'Admin rejected the order' });
      }

      setTimeline(events);
    } catch (err) {
      console.error('OrderInspector load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (d: string) => {
    try {
      return new Date(d).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch { return d; }
  };

  const isGuest = order?.buyer_type === 'guest';
  const providerView = order ? deriveProviderStatus(order) : null;
  const failureReason = order ? providerFailureReason(order) : '';
  const reprocess = order
    ? evaluateReprocess(order, evidence, { networkAvailable, alreadyReprocessed: reprocessLogs.length > 0 })
    : { eligible: false, reason: '' };
  const showReprocessPanel = !!order
    && (order.status === 'failed' || order.status === 'rejected' || order.status === 'refunded')
    && (order.payment_method || 'wallet').toLowerCase() === 'wallet'
    && (order.buyer_type || 'registered') === 'registered';

  const runReprocess = async () => {
    if (!order) return;
    setReprocessing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('reprocess-order', {
        body: { order_id: order.id, access_token: sess?.session?.access_token },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: 'Order reprocessed',
        description: `New order ${data.short_id} created and queued for fulfillment.`,
        variant: 'success',
      });
      setConfirmReprocess(false);
      if (orderId) loadOrder(orderId);
    } catch (err: any) {
      toast({ title: 'Reprocess failed', description: err?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Order Inspector
            {order && <span className="font-mono text-primary text-sm">{order.short_id}</span>}
            {order && isGuest && (
              <BuyerTypeBadge buyerType="guest" />
            )}
          </DialogTitle>
          <DialogDescription>Complete order investigation and audit trail</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : order ? (
          <>
          {/* Investigation Summary — order / provider / payment / refund are
              four separate concepts and must never be read as one. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            <SummaryChip label="Order Status" value={<StatusBadge status={order.status} />} />
            <SummaryChip label="Provider Status" value={
              <span className={`text-[10px] font-medium ${
                providerView?.tone === 'success' ? 'text-success'
                : providerView?.tone === 'warning' ? 'text-amber'
                : providerView?.tone === 'danger' ? 'text-destructive'
                : 'text-muted-foreground'
              }`}>{providerView?.label}</span>
            } />
            <SummaryChip label="Payment" value={
              order.payment_method?.includes('paystack')
                ? <span className="text-xs font-medium text-primary">Paystack</span>
                : <span className="text-xs font-medium text-foreground">Wallet</span>
            } />
            <SummaryChip label="Refund Status" value={
              evidence.confirmed
                ? <span className="text-[10px] font-medium text-success">Refund Confirmed{evidence.amount ? ` · ${formatGHS(evidence.amount)}` : ''}</span>
                : evidence.inFlight
                  ? <span className="text-[10px] font-medium text-amber">Refund In Progress</span>
                  : evidence.status === 'refund_failed'
                    ? <span className="text-[10px] font-medium text-destructive">Refund Failed</span>
                    : <span className="text-[10px] font-medium text-muted-foreground">Not Refunded</span>
            } />
            <SummaryChip label="Buyer Type" value={
              <BuyerTypeBadge buyerType={order.buyer_type} />
            } />
            <SummaryChip
              label={isGuest ? 'Paystack Ref' : 'Wallet'}
              value={isGuest
                ? (order.payment_reference
                    ? <span className="text-[10px] font-mono text-foreground truncate max-w-[100px] block">{order.payment_reference}</span>
                    : <span className="text-[10px] text-muted-foreground italic">—</span>)
                : (walletImpact
                    ? <span className="text-xs font-semibold text-destructive">-{formatGHS(walletImpact.deducted)}</span>
                    : <span className="text-[10px] text-muted-foreground italic">No deduction</span>)
              }
            />
            {order.affiliate_code ? (
              <SummaryChip label="Affiliate" value={
                <AffiliateBadge code={order.affiliate_code} />
              } />
            ) : (
              <SummaryChip label="Grace Period" value={
                order.grace_period_ends_at
                  ? <span className="text-[10px] font-medium">{new Date(order.grace_period_ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  : <span className="text-[10px] text-muted-foreground italic">N/A</span>
              } />
            )}
          </div>

          {/* Resolution banner — makes FAILED+NOT REFUNDED vs FAILED+REFUNDED unmistakable */}
          {(order.status === 'failed' || order.status === 'rejected' || order.status === 'refunded') && (
            <div className={`mb-3 rounded-2xl p-3 border ${
              evidence.confirmed
                ? 'bg-destructive/10 border-destructive/25'
                : 'bg-amber/10 border-amber/25'
            }`}>
              <div className="flex items-start gap-2">
                <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${evidence.confirmed ? 'text-destructive' : 'text-amber'}`} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    {evidence.confirmed ? 'FAILED — REFUNDED' : evidence.inFlight ? 'FAILED — REFUND IN PROGRESS' : 'FAILED — NOT REFUNDED'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    {evidence.confirmed
                      ? `${formatGHS(evidence.amount || order.total_amount)} returned to ${evidence.method === 'paystack' ? 'the original payment method' : 'the customer wallet'}${evidence.at ? ` on ${fmtDate(evidence.at)}` : ''}.`
                      : evidence.inFlight
                        ? 'A refund is recorded but not yet confirmed. Do not reprocess until it completes.'
                        : 'No confirmed refund exists for this order. The customer has not been paid back.'}
                  </p>
                  {failureReason && (
                    <p className="text-[11px] text-muted-foreground mt-1">Provider reason: <span className="text-foreground">{failureReason}</span></p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Reprocess (wallet orders with a confirmed refund only) */}
          {showReprocessPanel && (
            <div className="mb-3 rounded-2xl p-3 border border-border/60 bg-muted/30">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">Reprocess Order</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    {reprocess.eligible
                      ? 'Eligible. This will debit the customer wallet again and send a fresh fulfillment request.'
                      : `Reprocess unavailable — ${reprocess.reason}`}
                  </p>
                  {reprocessLogs.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">Previously reprocessed {reprocessLogs.length} time{reprocessLogs.length !== 1 ? 's' : ''}.</p>
                  )}
                </div>
                <Button size="sm" disabled={!reprocess.eligible || reprocessing}
                  onClick={() => setConfirmReprocess(true)} className="gap-1.5 shrink-0">
                  <PlayCircle className="w-3.5 h-3.5" /> Reprocess
                </Button>
              </div>
            </div>
          )}

          <Tabs defaultValue="details" className="mt-0">
            <TabsList className="w-full">
              <TabsTrigger value="details" className="flex-1 gap-1.5 text-xs"><FileText className="w-3.5 h-3.5" /> Details</TabsTrigger>
              {isGuest ? (
                <TabsTrigger value="buyer" className="flex-1 gap-1.5 text-xs"><UserX className="w-3.5 h-3.5" /> Buyer</TabsTrigger>
              ) : (
                <TabsTrigger value="wallet" className="flex-1 gap-1.5 text-xs"><Wallet className="w-3.5 h-3.5" /> Wallet</TabsTrigger>
              )}
              <TabsTrigger value="timeline" className="flex-1 gap-1.5 text-xs"><Clock className="w-3.5 h-3.5" /> Timeline</TabsTrigger>
              <TabsTrigger value="context" className="flex-1 gap-1.5 text-xs"><Link2 className="w-3.5 h-3.5" /> Context</TabsTrigger>
              {refundRecord && (
                <TabsTrigger value="refund" className="flex-1 gap-1.5 text-xs"><RotateCcw className="w-3.5 h-3.5" /> Refund</TabsTrigger>
              )}
            </TabsList>

            {/* Details Tab */}
            <TabsContent value="details" className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Order ID" value={<span className="font-mono text-primary">{order.short_id}</span>} />
                <Field label="Status" value={<StatusBadge status={order.status} />} />
                <Field label="Customer" value={order.customer_name} />
                <Field label="Email" value={<span className="text-xs">{order.customer_email || '—'}</span>} />
                <Field label="Network" value={order.network} />
                <Field label="Bundle" value={order.bundle_size} />
                <Field label="Recipient" value={<span className="font-mono">{order.recipient_phone}</span>} />
                <Field label="Quantity" value={String(order.quantity)} />
                <Field label="Amount" value={<span className="font-semibold">{formatGHS(order.total_amount)}</span>} />
                <Field label="Cost Price" value={formatGHS(order.cost_price)} />
                <Field label="Mode" value={<FulfillmentModeBadge mode={order.delivery_mode} />} />
                <Field label="Created" value={<span className="text-xs">{fmtDate(order.created_at)}</span>} />
              </div>
            </TabsContent>

            {/* Guest Buyer Tab */}
            {isGuest && (
              <TabsContent value="buyer" className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Buyer Type" value={<BuyerTypeBadge buyerType="guest" />} />
                  <Field label="Buyer Phone" value={<span className="font-mono text-xs">{order.buyer_phone || '—'}</span>} />
                  <Field label="Buyer Email" value={<span className="text-xs">{order.buyer_email || '—'}</span>} />
                  <Field label="Payment Method" value={order.payment_method === 'paystack' ? 'Paystack' : 'Wallet'} />
                  {order.payment_reference && (
                    <Field label="Payment Ref" value={<span className="font-mono text-xs break-all">{order.payment_reference}</span>} />
                  )}
                  {order.affiliate_code && (
                    <Field label="Affiliate Code" value={<AffiliateBadge code={order.affiliate_code} />} />
                  )}
                  {order.tracking_token && (
                    <Field label="Tracking Token" value={<span className="font-mono text-[10px] break-all">{order.tracking_token.substring(0, 16)}…</span>} />
                  )}
                  {order.linked_customer_id && (
                    <Field label="Linked Account" value={<span className="font-mono text-xs text-primary">{order.linked_customer_id.substring(0, 8)}…</span>} />
                  )}
                </div>
              </TabsContent>
            )}

            {/* Wallet Tab (registered only) */}
            {!isGuest && (
              <TabsContent value="wallet" className="space-y-3 py-2">
                {walletImpact ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-muted/50 rounded-xl p-4 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Before</p>
                        <p className="text-lg font-bold text-foreground tabular-nums">{formatGHS(walletImpact.balanceBefore)}</p>
                      </div>
                      <div className="bg-destructive/10 rounded-xl p-4 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-destructive mb-1">Deducted</p>
                        <p className="text-lg font-bold text-destructive tabular-nums">-{formatGHS(walletImpact.deducted)}</p>
                      </div>
                      <div className="bg-muted/50 rounded-xl p-4 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Current</p>
                        <p className="text-lg font-bold text-foreground tabular-nums">{formatGHS(walletImpact.balanceAfter)}</p>
                      </div>
                    </div>
                    <Field label="Transaction Ref" value={<span className="font-mono text-xs">{walletImpact.txReference}</span>} />
                    {relatedRefund && (
                      <div className="bg-success/10 border border-success/20 rounded-xl p-3">
                        <p className="text-xs font-medium text-success mb-1">Refund Issued</p>
                        <p className="text-sm font-semibold text-foreground">{formatGHS(Number(relatedRefund.amount))}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{fmtDate(relatedRefund.created_at)}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Wallet className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No wallet transaction linked to this order</p>
                  </div>
                )}
              </TabsContent>
            )}

            {/* Timeline Tab */}
            <TabsContent value="timeline" className="py-2">
              <div className="relative pl-6 space-y-0">
                {timeline.map((e, i) => (
                  <div key={i} className="relative pb-6 last:pb-0">
                    {i < timeline.length - 1 && (
                      <div className="absolute left-[-16px] top-3 w-px h-full bg-border" />
                    )}
                    <div className={`absolute left-[-20px] top-1 w-2 h-2 rounded-full ${
                      e.event.includes('Delivered') ? 'bg-success' :
                      e.event.includes('Failed') || e.event.includes('Rejected') ? 'bg-destructive' :
                      e.event.includes('Cancel') ? 'bg-muted-foreground' :
                      e.event.includes('Guest') || e.event.includes('Affiliate') ? 'bg-warning' :
                      'bg-primary'
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{e.event}</p>
                      {e.detail && <p className="text-xs text-muted-foreground mt-0.5">{e.detail}</p>}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtDate(e.time)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Context Tab */}
            <TabsContent value="context" className="space-y-3 py-2">
              <Field label="Fulfillment Method" value={<FulfillmentModeBadge mode={order.delivery_mode} />} />
              {order.delivery_mode === 'api' ? (
                <>
                  <Field label="Provider" value={order.provider_name || <span className="text-xs text-muted-foreground italic">Pending Provider Response</span>} />
                  <Field label="Provider Order ID" value={order.provider_order_id
                    ? <span className="font-mono text-xs">{order.provider_order_id}</span>
                    : <span className="text-xs text-muted-foreground italic">Pending Provider Response</span>
                  } />
                  <Field label="Provider Reference" value={order.provider_reference
                    ? <span className="font-mono text-xs">{order.provider_reference}</span>
                    : <span className="text-xs text-muted-foreground italic">Pending Provider Response</span>
                  } />
                </>
              ) : (
                <Field label="Provider" value={<span className="text-xs text-muted-foreground italic">Not Applicable — Manual Fulfillment</span>} />
              )}
              <Field label="Grace Period Ends" value={order.grace_period_ends_at ? fmtDate(order.grace_period_ends_at) : <span className="text-xs text-muted-foreground italic">Not Applicable</span>} />
              {order.payment_reference && (
                <Field label="Payment Reference" value={<span className="font-mono text-xs break-all">{order.payment_reference}</span>} />
              )}
              {order.provider_response && Object.keys(order.provider_response).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Provider Response</p>
                  <pre className="text-[11px] bg-muted/50 rounded-lg p-3 overflow-x-auto text-muted-foreground max-h-40">
                    {JSON.stringify(order.provider_response, null, 2)}
                  </pre>
                </div>
              )}
              {relatedRefund && (
                <div className="bg-success/5 border border-success/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-success">Refund Record</p>
                  <p className="text-sm mt-1">{formatGHS(Number(relatedRefund.amount))} — {fmtDate(relatedRefund.created_at)}</p>
                </div>
              )}
            </TabsContent>

            {/* Refund Tab */}
            {refundRecord && (
              <TabsContent value="refund" className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Refund Method" value={
                    <Badge variant="outline" className={`text-xs ${refundRecord.refund_method === 'paystack' ? 'border-primary/40 text-primary bg-primary/10' : 'border-success/40 text-success bg-success/10'}`}>
                      {refundRecord.refund_method === 'paystack' ? 'Paystack' : 'Wallet'}
                    </Badge>
                  } />
                  <Field label="Status" value={
                    <Badge variant="outline" className={`text-xs ${
                      refundRecord.status === 'refunded' ? 'border-success/40 text-success bg-success/10' :
                      refundRecord.status === 'refund_failed' ? 'border-destructive/40 text-destructive bg-destructive/10' :
                      refundRecord.status === 'refund_pending' ? 'border-warning/40 text-warning bg-warning/10' :
                      'border-muted-foreground/40 text-muted-foreground'
                    }`}>
                      {refundRecord.status.replace('_', ' ')}
                    </Badge>
                  } />
                  <Field label="Amount Paid" value={<span className="font-semibold">{formatGHS(Number(refundRecord.amount_paid))}</span>} />
                  <Field label="Refund Amount" value={<span className="font-semibold text-success">{formatGHS(Number(refundRecord.refund_amount))}</span>} />
                  <Field label="Total Refunded" value={formatGHS(Number(refundRecord.total_refunded))} />
                  <Field label="Buyer Type" value={refundRecord.buyer_type} />
                  {refundRecord.is_full_override && (
                    <Field label="Override" value={<Badge variant="outline" className="text-xs border-warning/40 text-warning bg-warning/10">Full Override</Badge>} />
                  )}
                  <Field label="Reason" value={<span className="text-xs">{refundRecord.refund_reason || '—'}</span>} />
                  <Field label="Initiated By" value={<span className="text-xs">{refundRecord.initiated_by}</span>} />
                  {refundRecord.paystack_refund_id && (
                    <Field label="Paystack Refund ID" value={<span className="font-mono text-xs">{refundRecord.paystack_refund_id}</span>} />
                  )}
                  {refundRecord.paystack_transaction_id && (
                    <Field label="Paystack Tx ID" value={<span className="font-mono text-xs">{refundRecord.paystack_transaction_id}</span>} />
                  )}
                  <Field label="Created" value={<span className="text-xs">{fmtDate(refundRecord.created_at)}</span>} />
                </div>
                {refundRecord.error_message && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-destructive mb-1">Error</p>
                    <p className="text-xs text-foreground">{refundRecord.error_message}</p>
                  </div>
                )}
                {refundRecord.status === 'refund_failed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-2"
                    disabled={retryingRefund}
                    onClick={async () => {
                      setRetryingRefund(true);
                      try {
                        const { data, error } = await supabase.functions.invoke('reject-order', {
                          body: { order_id: order!.id },
                        });
                        if (error) throw error;
                        if (data?.error) throw new Error(data.error);
                        toast({ title: 'Refund retried', description: 'Refund has been re-initiated.', variant: 'success' });
                        if (orderId) loadOrder(orderId);
                      } catch (err: any) {
                        toast({ title: 'Retry failed', description: err?.message, variant: 'destructive' });
                      } finally {
                        setRetryingRefund(false);
                      }
                    }}
                  >
                    {retryingRefund ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Retry Refund
                  </Button>
                )}
                {refundRecord.paystack_response && Object.keys(refundRecord.paystack_response).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Paystack Response</p>
                    <pre className="text-[11px] bg-muted/50 rounded-lg p-3 overflow-x-auto text-muted-foreground max-h-40">
                      {JSON.stringify(refundRecord.paystack_response, null, 2)}
                    </pre>
                  </div>
                )}
              </TabsContent>
            )}

          </Tabs>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">Order not found</div>
        )}
      </DialogContent>

      <AlertDialog open={confirmReprocess} onOpenChange={setConfirmReprocess}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reprocess {order?.short_id}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-1 text-xs text-foreground">
                  <p><span className="text-muted-foreground">Customer:</span> {order?.customer_name}{order?.customer_phone ? ` · ${order.customer_phone}` : ''}</p>
                  <p><span className="text-muted-foreground">Network / Bundle:</span> {order?.network} · {order?.bundle_size}</p>
                  <p><span className="text-muted-foreground">Recipient:</span> {order?.recipient_phone}</p>
                  <p><span className="text-muted-foreground">Original amount:</span> {order ? formatGHS(Number(order.total_amount)) : ''}</p>
                  <p><span className="text-muted-foreground">Current wallet balance:</span> {order ? formatGHS(order.customer_balance) : ''}</p>
                  <p><span className="text-muted-foreground">Payment method:</span> Wallet</p>
                  <p><span className="text-muted-foreground">Provider:</span> {order?.provider_name || 'Manual'}</p>
                  <p><span className="text-muted-foreground">Previous failure:</span> {failureReason || '—'}</p>
                  <p><span className="text-muted-foreground">Refund:</span> Confirmed · {formatGHS(evidence.amount || Number(order?.total_amount || 0))}</p>
                  <p><span className="text-muted-foreground">Previous reprocess count:</span> {reprocessLogs.length}</p>
                </div>
                <p className="text-xs text-muted-foreground">The original payment was refunded. Reprocessing will use the customer's current wallet balance.</p>
                <p className="text-xs text-muted-foreground">This will debit the customer's wallet again. If fulfillment fails again, the amount will be refunded.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reprocessing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); runReprocess(); }} disabled={reprocessing}>
              {reprocessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Reprocess'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function SummaryChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <div>{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-border/40 last:border-b-0 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</span>
      <div className="text-sm text-foreground break-words min-w-0">{value}</div>
    </div>
  );
}
