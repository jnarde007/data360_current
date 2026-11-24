import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatGHS } from '@/lib/mock-data';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertTriangle, CheckCircle2, Clock, CreditCard, Loader2, RefreshCw,
  Search, ShieldAlert, Wallet, ShoppingCart, Eye, Flag, XCircle, Sparkles
} from 'lucide-react';
import { format, subHours, subDays } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileCard } from '@/components/MobileCard';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';
import { WalletDiagnosticDrawer } from '@/components/admin/WalletDiagnosticDrawer';
import { diagnoseWalletVariance, type DiagnosticResult } from '@/lib/reconciliation-diagnostics';
type ReconciliationStatus = 'matched' | 'unresolved' | 'review_needed' | 'resolved' | 'ignored';

interface PaymentIssue {
  id: string; date: string; customerName: string; reference: string;
  requestedAmount: number; walletCreditAmount: number | null;
  paymentStatus: string; topupStatus: string;
  reconciliationStatus: ReconciliationStatus; issue: string;
}

interface OrderIssue {
  id: string; date: string; customerName: string; recipientPhone: string;
  network: string; provider: string; localStatus: string; amountDebited: number;
  shortId: string; deliveryMode: string;
  reconciliationStatus: ReconciliationStatus; issue: string;
}

interface WalletIssue {
  customerId: string; customerName: string; email: string;
  currentBalance: number; computedBalance: number; variance: number;
  lastTxDate: string | null;
  reconciliationStatus: ReconciliationStatus; issue: string;
  diagnosis: DiagnosticResult | null;
}

interface ManualAdjustment {
  id: string; date: string; customerName: string; amount: number;
  type: string; adminName: string | null; description: string; reference: string;
  reconciliationStatus: ReconciliationStatus; issue: string;
}

interface StaleItem {
  id: string; type: 'order' | 'topup'; shortId: string; customerName: string;
  status: string; amount: number; createdAt: string; hoursAgo: number;
  deliveryMode?: string;
}

const STALE_HOURS_ORDER = 2;
const STALE_HOURS_TOPUP = 4;
const ACTIVE_ORDER_STATUSES = ['pending', 'processing', 'pending_manual', 'awaiting_manual_fulfillment', 'submitted'];
const PENDING_TOPUP_STATUSES = ['pending'];

function reconciliationBadge(status: ReconciliationStatus) {
  const map: Record<ReconciliationStatus, { className: string; dot: string }> = {
    matched: { className: 'bg-success/10 text-success border-success/20', dot: 'bg-success' },
    resolved: { className: 'bg-success/10 text-success border-success/20', dot: 'bg-success' },
    unresolved: { className: 'bg-destructive/10 text-destructive border-destructive/20', dot: 'bg-destructive' },
    review_needed: { className: 'bg-warning/10 text-warning border-warning/20', dot: 'bg-warning' },
    ignored: { className: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
  };
  const c = map[status];
  return (
    <Badge variant="outline" className={`capitalize text-xs font-medium gap-1.5 ${c.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {status.replace('_', ' ')}
    </Badge>
  );
}

export default function AdminReconciliationPage() {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [paymentIssues, setPaymentIssues] = useState<PaymentIssue[]>([]);
  const [orderIssues, setOrderIssues] = useState<OrderIssue[]>([]);
  const [walletIssues, setWalletIssues] = useState<WalletIssue[]>([]);
  const [manualAdjustments, setManualAdjustments] = useState<ManualAdjustment[]>([]);
  const [staleItems, setStaleItems] = useState<StaleItem[]>([]);

  // Detail states
  const [detailPayment, setDetailPayment] = useState<PaymentIssue | null>(null);
  const [detailOrder, setDetailOrder] = useState<OrderIssue | null>(null);
  const [detailWallet, setDetailWallet] = useState<WalletIssue | null>(null);
  const [detailManual, setDetailManual] = useState<ManualAdjustment | null>(null);
  const [detailStale, setDetailStale] = useState<StaleItem | null>(null);

  const loadReconciliation = useCallback(async () => {
    setLoading(true);
    try {
      const [topupsRes, walletTxRes, ordersRes, customersRes, adminUsersRes] = await Promise.all([
        supabase.from('topups').select('*, customers(full_name, email)').order('created_at', { ascending: false }),
        supabase.from('wallet_transactions').select('*, customers(full_name, email, wallet_balance)').order('created_at', { ascending: false }),
        supabase.from('orders').select('id, short_id, customer_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, delivery_mode, provider_name, provider_reference, buyer_type, buyer_phone, payment_method, payment_reference, customers(full_name, email)').order('created_at', { ascending: false }),
        supabase.from('customers').select('id, full_name, email, wallet_balance'),
        supabase.from('admin_users').select('id, name'),
      ]);

      const topups = topupsRes.data || [];
      const walletTx = walletTxRes.data || [];
      const orders = ordersRes.data || [];
      const customers = customersRes.data || [];
      const adminUsers = adminUsersRes.data || [];
      const adminMap = Object.fromEntries(adminUsers.map((a: any) => [a.id, a.name]));

      // === PAYMENT RECONCILIATION ===
      const pIssues: PaymentIssue[] = [];
      const creditTxs = walletTx.filter((t: any) => t.type === 'credit');
      const refCounts = new Map<string, number>();
      creditTxs.forEach((t: any) => { refCounts.set(t.reference, (refCounts.get(t.reference) || 0) + 1); });

      const findMatchingCredit = (topup: any) => {
        const byRef = creditTxs.find((t: any) => t.reference === topup.short_id);
        if (byRef) return byRef;
        if (!topup.customer_id) return null;
        const topupTime = new Date(topup.created_at).getTime();
        return creditTxs.find((t: any) =>
          t.customer_id === topup.customer_id &&
          Math.abs(Number(t.amount) - Number(topup.amount)) < 0.01 &&
          Math.abs(new Date(t.created_at).getTime() - topupTime) < 10 * 60 * 1000
        ) || null;
      };

      for (const topup of topups) {
        const cName = (topup as any).customers?.full_name || 'Unknown';
        const ref = topup.short_id;
        const matchedCredit = findMatchingCredit(topup);
        let status: ReconciliationStatus = 'matched';
        let issue = '';
        if (topup.status === 'pending') continue;
        if (topup.status === 'approved' && !matchedCredit) {
          if (!topup.customer_id) { status = 'review_needed'; issue = 'Orphaned payment — no customer linked'; }
          else { status = 'unresolved'; issue = 'Approved topup but no wallet credit found'; }
        } else if (topup.status === 'rejected' && matchedCredit) {
          status = 'review_needed'; issue = 'Rejected topup but wallet credit exists';
        } else if (matchedCredit && (refCounts.get(matchedCredit.reference) || 0) > 1) {
          status = 'review_needed'; issue = 'Duplicate wallet credit for same reference';
        }
        if (status !== 'matched') {
          pIssues.push({ id: topup.id, date: topup.created_at, customerName: cName, reference: ref,
            requestedAmount: topup.amount, walletCreditAmount: matchedCredit ? matchedCredit.amount : null,
            paymentStatus: topup.method === 'paystack' ? 'online' : 'momo', topupStatus: topup.status,
            reconciliationStatus: status, issue });
        }
      }
      setPaymentIssues(pIssues);

      // === ORDER RECONCILIATION ===
      const oIssues: OrderIssue[] = [];
      const now = new Date();
      for (const order of orders) {
        const cName = (order as any).customers?.full_name || 'Unknown';
        let status: ReconciliationStatus = 'matched';
        let issue = '';
        const ageHours = (now.getTime() - new Date(order.created_at).getTime()) / (1000 * 60 * 60);
        if (order.status === 'failed') {
          const refund = walletTx.find((t: any) => t.type === 'credit' && t.customer_id === order.customer_id &&
            (t.description?.toLowerCase().includes('refund') || t.reference === order.short_id));
          if (!refund) { status = 'unresolved'; issue = 'Failed order — no refund issued'; }
        } else if (ACTIVE_ORDER_STATUSES.includes(order.status) && ageHours > STALE_HOURS_ORDER) {
          status = 'review_needed'; issue = `Order pending for ${Math.round(ageHours)}h`;
        } else if (order.delivery_mode === 'api' && order.status === 'pending') {
          status = 'review_needed'; issue = 'API order still in pending (expected processing)';
        }
        if (status !== 'matched') {
          oIssues.push({ id: order.id, date: order.created_at, customerName: cName, recipientPhone: order.recipient_phone,
            network: order.network, provider: order.provider_name || '-', localStatus: order.status,
            amountDebited: order.total_amount, shortId: order.short_id, deliveryMode: order.delivery_mode,
            reconciliationStatus: status, issue });
        }
      }
      setOrderIssues(oIssues);

      // === WALLET RECONCILIATION ===
      const wIssues: WalletIssue[] = [];
      for (const customer of customers) {
        const txs = walletTx.filter((t: any) => t.customer_id === customer.id);
        let computed = 0;
        for (const tx of txs) { if (tx.type === 'credit') computed += Number(tx.amount); else computed -= Number(tx.amount); }
        const variance = Number(customer.wallet_balance) - computed;
        const lastTx = txs.length > 0 ? txs[0].created_at : null;
        if (Math.abs(variance) > 0.01) {
          const diagnosis = diagnoseWalletVariance(
            Number(customer.wallet_balance), computed,
            txs.map((t: any) => ({
              id: t.id, type: t.type, amount: Number(t.amount),
              description: t.description, reference: t.reference,
              created_at: t.created_at, admin_id: t.admin_id,
              balance_before: t.balance_before, balance_after: t.balance_after,
            }))
          );
          wIssues.push({ customerId: customer.id, customerName: customer.full_name, email: customer.email,
            currentBalance: Number(customer.wallet_balance), computedBalance: computed, variance,
            lastTxDate: lastTx,
            reconciliationStatus: Math.abs(variance) > 5 ? 'unresolved' : 'review_needed',
            issue: `Variance of ${formatGHS(Math.abs(variance))}`,
            diagnosis });
        }
      }
      setWalletIssues(wIssues);

      // === MANUAL ADJUSTMENTS ===
      const mAdj: ManualAdjustment[] = [];
      const manualTxs = walletTx.filter((t: any) => t.description?.toLowerCase().includes('manual') || t.description?.toLowerCase().includes('admin') || t.admin_id);
      for (const tx of manualTxs) {
        const cName = (tx as any).customers?.full_name || 'Unknown';
        let status: ReconciliationStatus = 'matched';
        let issue = '';
        if (!tx.admin_id) { status = 'review_needed'; issue = 'Manual action without admin identity'; }
        else if (!tx.description || tx.description.trim().length < 3) { status = 'review_needed'; issue = 'Missing reason/note'; }
        else if (Number(tx.amount) > 500) { status = 'review_needed'; issue = 'Large manual adjustment (>GHS 500)'; }
        mAdj.push({ id: tx.id, date: tx.created_at, customerName: cName, amount: Number(tx.amount), type: tx.type,
          adminName: tx.admin_id ? (adminMap[tx.admin_id] || 'Unknown Admin') : null, description: tx.description,
          reference: tx.reference, reconciliationStatus: status, issue });
      }
      setManualAdjustments(mAdj);

      // === STALE ITEMS ===
      const sItems: StaleItem[] = [];
      for (const order of orders) {
        if (!ACTIVE_ORDER_STATUSES.includes(order.status)) continue;
        const ageH = (now.getTime() - new Date(order.created_at).getTime()) / (1000 * 60 * 60);
        if (ageH > STALE_HOURS_ORDER) {
          sItems.push({ id: order.id, type: 'order', shortId: order.short_id,
            customerName: (order as any).customers?.full_name || 'Unknown', status: order.status,
            amount: order.total_amount, createdAt: order.created_at, hoursAgo: Math.round(ageH),
            deliveryMode: order.delivery_mode });
        }
      }
      for (const topup of topups) {
        if (!PENDING_TOPUP_STATUSES.includes(topup.status)) continue;
        const ageH = (now.getTime() - new Date(topup.created_at).getTime()) / (1000 * 60 * 60);
        if (ageH > STALE_HOURS_TOPUP) {
          sItems.push({ id: topup.id, type: 'topup', shortId: topup.short_id,
            customerName: (topup as any).customers?.full_name || 'Unknown', status: topup.status,
            amount: topup.amount, createdAt: topup.created_at, hoursAgo: Math.round(ageH) });
        }
      }
      sItems.sort((a, b) => b.hoursAgo - a.hoursAgo);
      setStaleItems(sItems);
      setLastScanTime(new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('Reconciliation load error:', err);
      toast({ title: 'Unable to load reconciliation data', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadReconciliation(); }, [loadReconciliation]);

  const totalUnresolved = paymentIssues.filter(i => i.reconciliationStatus === 'unresolved').length
    + orderIssues.filter(i => i.reconciliationStatus === 'unresolved').length
    + walletIssues.filter(i => i.reconciliationStatus === 'unresolved').length;

  const totalReview = paymentIssues.filter(i => i.reconciliationStatus === 'review_needed').length
    + orderIssues.filter(i => i.reconciliationStatus === 'review_needed').length
    + walletIssues.filter(i => i.reconciliationStatus === 'review_needed').length
    + manualAdjustments.filter(i => i.reconciliationStatus === 'review_needed').length;

  const fmtDate = (d: string) => { try { return format(new Date(d), 'dd MMM, HH:mm'); } catch { return d; } };

  function filterItems<T extends { reconciliationStatus: ReconciliationStatus }>(items: T[], searchFields: (keyof T)[]): T[] {
    let filtered = items;
    if (statusFilter !== 'all') filtered = filtered.filter(i => i.reconciliationStatus === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(i => searchFields.some(f => String(i[f]).toLowerCase().includes(q)));
    }
    return filtered;
  }

  // Detail field generators
  const getPaymentDetailFields = (i: PaymentIssue): DetailField[] => [
    { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
    { label: 'Reference', value: <span className="font-mono text-xs">{i.reference}</span> },
    { label: 'Requested', value: <span className="font-semibold">{formatGHS(i.requestedAmount)}</span> },
    { label: 'Credited', value: i.walletCreditAmount !== null ? formatGHS(i.walletCreditAmount) : '—' },
    { label: 'Topup Status', value: <StatusBadge status={i.topupStatus} /> },
    { label: 'Recon Status', value: reconciliationBadge(i.reconciliationStatus) },
    { label: 'Issue', value: i.issue },
    { label: 'Date', value: fmtDate(i.date) },
  ];

  const getOrderDetailFields = (i: OrderIssue): DetailField[] => [
    { label: 'Order ID', value: <span className="font-mono text-xs">{i.shortId}</span> },
    { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
    { label: 'Recipient', value: <span className="font-mono text-xs">{i.recipientPhone}</span> },
    { label: 'Network', value: i.network },
    { label: 'Amount', value: <span className="font-semibold">{formatGHS(i.amountDebited)}</span> },
    { label: 'Mode', value: <span className="capitalize">{i.deliveryMode}</span> },
    { label: 'Local Status', value: <StatusBadge status={i.localStatus} /> },
    { label: 'Recon Status', value: reconciliationBadge(i.reconciliationStatus) },
    { label: 'Issue', value: i.issue },
    { label: 'Date', value: fmtDate(i.date) },
  ];

  const getWalletDetailFields = (i: WalletIssue): DetailField[] => [
    { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
    { label: 'Email', value: i.email },
    { label: 'Current Balance', value: <span className="font-semibold">{formatGHS(i.currentBalance)}</span> },
    { label: 'Computed Balance', value: formatGHS(i.computedBalance) },
    { label: 'Variance', value: <span className={`font-semibold ${i.variance > 0 ? 'text-success' : 'text-destructive'}`}>{i.variance > 0 ? '+' : ''}{formatGHS(i.variance)}</span> },
    { label: 'Status', value: reconciliationBadge(i.reconciliationStatus) },
    { label: 'Issue', value: i.issue },
    { label: 'Last Tx', value: i.lastTxDate ? fmtDate(i.lastTxDate) : '—' },
  ];

  const getManualDetailFields = (i: ManualAdjustment): DetailField[] => [
    { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
    { label: 'Type', value: <Badge variant={i.type === 'credit' ? 'default' : 'destructive'} className="text-xs capitalize">{i.type}</Badge> },
    { label: 'Amount', value: <span className="font-semibold">{formatGHS(i.amount)}</span> },
    { label: 'Processed By', value: i.adminName || <span className="text-destructive">Unknown</span> },
    { label: 'Reason', value: i.description || '—' },
    { label: 'Reference', value: <span className="font-mono text-xs">{i.reference || '—'}</span> },
    { label: 'Status', value: reconciliationBadge(i.reconciliationStatus) },
    { label: 'Issue', value: i.issue },
    { label: 'Date', value: fmtDate(i.date) },
  ];

  const getStaleDetailFields = (i: StaleItem): DetailField[] => [
    { label: 'Type', value: <Badge variant={i.type === 'order' ? 'default' : 'secondary'} className="text-xs capitalize">{i.type}</Badge> },
    { label: 'ID', value: <span className="font-mono text-xs">{i.shortId}</span> },
    { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
    { label: 'Amount', value: <span className="font-semibold">{formatGHS(i.amount)}</span> },
    { label: 'Status', value: <StatusBadge status={i.status} /> },
    { label: 'Mode', value: <span className="capitalize">{i.deliveryMode || '-'}</span> },
    { label: 'Age', value: <span className="font-semibold text-warning">{i.hoursAgo}h ago</span> },
    { label: 'Created', value: fmtDate(i.createdAt) },
  ];

  const overallHealthy = totalUnresolved === 0 && totalReview === 0 && staleItems.length === 0;

  return (
    <AdminLayout>
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">Reconciliation Center</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Daily finance and operations review
              {lastScanTime && <span className="text-muted-foreground/60"> · Last updated: {lastScanTime}</span>}
            </p>
          </div>
          <Button onClick={loadReconciliation} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>

        {/* Overall Status Banner */}
        {!loading && (
          <div className={`rounded-xl p-3 border flex items-center gap-3 ${
            overallHealthy
              ? 'bg-success/5 border-success/20 text-success'
              : totalUnresolved > 0
                ? 'bg-destructive/5 border-destructive/20 text-destructive'
                : 'bg-warning/5 border-warning/20 text-warning'
          }`}>
            {overallHealthy ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : totalUnresolved > 0 ? <XCircle className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
            <span className="text-sm font-medium">
              {overallHealthy
                ? 'All systems healthy — no reconciliation issues detected'
                : totalUnresolved > 0
                  ? `${totalUnresolved} unresolved issue${totalUnresolved !== 1 ? 's' : ''} require immediate attention`
                  : `${totalReview} item${totalReview !== 1 ? 's' : ''} need review`
              }
            </span>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Unresolved Issues" value={String(totalUnresolved)} icon={<XCircle className="w-5 h-5" />}
            accent={totalUnresolved > 0 ? 'red' : 'green'} subtitle={totalUnresolved === 0 ? 'All clear' : 'Needs action'} />
          <StatCard title="Review Needed" value={String(totalReview)} icon={<AlertTriangle className="w-5 h-5" />}
            accent={totalReview > 0 ? 'amber' : 'green'} subtitle={totalReview === 0 ? 'All clear' : 'Requires admin review'} />
          <StatCard title="Failed Without Refund" value={String(orderIssues.filter(i => i.issue.includes('no refund')).length)} icon={<ShoppingCart className="w-5 h-5" />}
            accent={orderIssues.filter(i => i.issue.includes('no refund')).length > 0 ? 'red' : 'green'} subtitle="Orders needing refund" />
          <StatCard title="Stale / Stuck" value={String(staleItems.length)} icon={<Clock className="w-5 h-5" />}
            accent={staleItems.length > 0 ? 'amber' : 'green'} subtitle="Pending too long" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Payment Mismatches" value={String(paymentIssues.length)} icon={<CreditCard className="w-5 h-5" />}
            accent={paymentIssues.length > 0 ? 'amber' : 'green'} />
          <StatCard title="Order Issues" value={String(orderIssues.length)} icon={<ShoppingCart className="w-5 h-5" />}
            accent={orderIssues.length > 0 ? 'amber' : 'green'} />
          <StatCard title="Wallet Variances" value={String(walletIssues.length)} icon={<Wallet className="w-5 h-5" />}
            accent={walletIssues.length > 0 ? 'red' : 'green'} />
          <StatCard title="Manual Adj. Reviews" value={String(manualAdjustments.filter(i => i.reconciliationStatus !== 'matched').length)} icon={<ShieldAlert className="w-5 h-5" />}
            accent={manualAdjustments.filter(i => i.reconciliationStatus !== 'matched').length > 0 ? 'amber' : 'green'} />
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search customer, reference, phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Status filter" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="unresolved">Unresolved</SelectItem>
                  <SelectItem value="review_needed">Review Needed</SelectItem>
                  <SelectItem value="matched">Matched</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="ignored">Ignored</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <Tabs defaultValue="payments" className="space-y-4">
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="payments">Payments ({paymentIssues.length})</TabsTrigger>
              <TabsTrigger value="orders">Orders ({orderIssues.length})</TabsTrigger>
              <TabsTrigger value="wallets">Wallets ({walletIssues.length})</TabsTrigger>
              <TabsTrigger value="manual">Manual ({manualAdjustments.filter(i => i.reconciliationStatus !== 'matched').length})</TabsTrigger>
              <TabsTrigger value="stale">Stale ({staleItems.length})</TabsTrigger>
            </TabsList>

            {/* PAYMENTS TAB */}
            <TabsContent value="payments">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Payment Reconciliation</CardTitle>
                  <CardDescription>Mismatches between topup payments and wallet credits</CardDescription>
                </CardHeader>
                <CardContent>
                  {filterItems(paymentIssues, ['customerName', 'reference']).length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-success" /><p>No payment mismatches found</p>
                    </div>
                  ) : isMobile ? (
                    <div className="space-y-3">
                      {filterItems(paymentIssues, ['customerName', 'reference']).map(i => (
                        <MobileCard key={i.id} fields={[
                          { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
                          { label: 'Amount', value: <span className="font-semibold">{formatGHS(i.requestedAmount)}</span> },
                          { label: 'Status', value: reconciliationBadge(i.reconciliationStatus) },
                          { label: 'Issue', value: <span className="text-xs text-muted-foreground">{i.issue}</span> },
                        ]} action={
                          <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailPayment(i)}>
                            <Eye className="w-3.5 h-3.5" /> View Details
                          </Button>
                        } />
                      ))}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Reference</TableHead>
                          <TableHead>Requested</TableHead><TableHead>Credited</TableHead><TableHead>Topup Status</TableHead>
                          <TableHead>Status</TableHead><TableHead>Issue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filterItems(paymentIssues, ['customerName', 'reference']).map(i => (
                          <TableRow key={i.id}>
                            <TableCell className="text-xs whitespace-nowrap">{fmtDate(i.date)}</TableCell>
                            <TableCell className="font-medium text-sm">{i.customerName}</TableCell>
                            <TableCell className="text-xs font-mono">{i.reference}</TableCell>
                            <TableCell>{formatGHS(i.requestedAmount)}</TableCell>
                            <TableCell>{i.walletCreditAmount !== null ? formatGHS(i.walletCreditAmount) : '—'}</TableCell>
                            <TableCell><StatusBadge status={i.topupStatus} /></TableCell>
                            <TableCell>{reconciliationBadge(i.reconciliationStatus)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{i.issue}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ORDERS TAB */}
            <TabsContent value="orders">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Order Reconciliation</CardTitle>
                  <CardDescription>Failed orders needing refunds, status mismatches, and stuck orders</CardDescription>
                </CardHeader>
                <CardContent>
                  {filterItems(orderIssues, ['customerName', 'recipientPhone', 'shortId']).length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-success" /><p>No order issues found</p>
                    </div>
                  ) : isMobile ? (
                    <div className="space-y-3">
                      {filterItems(orderIssues, ['customerName', 'recipientPhone', 'shortId']).map(i => (
                        <MobileCard key={i.id} fields={[
                          { label: 'Order', value: <span className="font-mono text-xs text-primary">{i.shortId}</span> },
                          { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
                          { label: 'Amount', value: <span className="font-semibold">{formatGHS(i.amountDebited)}</span> },
                          { label: 'Status', value: reconciliationBadge(i.reconciliationStatus) },
                        ]} action={
                          <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailOrder(i)}>
                            <Eye className="w-3.5 h-3.5" /> View Details
                          </Button>
                        } />
                      ))}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead><TableHead>Order</TableHead><TableHead>Customer</TableHead>
                          <TableHead>Recipient</TableHead><TableHead>Network</TableHead><TableHead>Amount</TableHead>
                          <TableHead>Mode</TableHead><TableHead>Local Status</TableHead><TableHead>Status</TableHead>
                          <TableHead>Issue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filterItems(orderIssues, ['customerName', 'recipientPhone', 'shortId']).map(i => (
                          <TableRow key={i.id}>
                            <TableCell className="text-xs whitespace-nowrap">{fmtDate(i.date)}</TableCell>
                            <TableCell className="text-xs font-mono">{i.shortId}</TableCell>
                            <TableCell className="font-medium text-sm">{i.customerName}</TableCell>
                            <TableCell className="text-xs font-mono">{i.recipientPhone}</TableCell>
                            <TableCell className="text-xs uppercase">{i.network}</TableCell>
                            <TableCell>{formatGHS(i.amountDebited)}</TableCell>
                            <TableCell className="text-xs capitalize">{i.deliveryMode}</TableCell>
                            <TableCell><StatusBadge status={i.localStatus} /></TableCell>
                            <TableCell>{reconciliationBadge(i.reconciliationStatus)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{i.issue}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* WALLETS TAB */}
            <TabsContent value="wallets">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Wallet Balance Reconciliation
                  </CardTitle>
                  <CardDescription>Customers whose wallet balance doesn't match computed transaction history. Click a row to investigate.</CardDescription>
                </CardHeader>
                <CardContent>
                  {filterItems(walletIssues, ['customerName', 'email']).length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-success" /><p>All wallet balances match transaction history</p>
                    </div>
                  ) : isMobile ? (
                    <div className="space-y-3">
                      {filterItems(walletIssues, ['customerName', 'email']).map(i => (
                        <MobileCard key={i.customerId} fields={[
                          { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
                          { label: 'Variance', value: <span className={`font-semibold ${i.variance > 0 ? 'text-success' : 'text-destructive'}`}>{i.variance > 0 ? '+' : ''}{formatGHS(i.variance)}</span> },
                          { label: 'Balance', value: formatGHS(i.currentBalance) },
                          { label: 'Confidence', value: i.diagnosis ? (
                            <Badge variant="outline" className={`text-[9px] ${
                              i.diagnosis.confidence === 'likely' ? 'text-destructive border-destructive/20' :
                              i.diagnosis.confidence === 'possible' ? 'text-warning border-warning/20' :
                              'text-muted-foreground border-border'
                            }`}>{i.diagnosis.confidence === 'likely' ? 'Likely' : i.diagnosis.confidence === 'possible' ? 'Possible' : 'Review'}</Badge>
                          ) : '—' },
                          { label: 'Likely Cause', value: <span className="text-xs text-muted-foreground line-clamp-2">{i.diagnosis?.likelyCause || i.issue}</span> },
                        ]} action={
                          <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailWallet(i)}>
                            <Sparkles className="w-3.5 h-3.5" /> Investigate
                          </Button>
                        } />
                      ))}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead><TableHead>Email</TableHead>
                          <TableHead className="text-right">Current</TableHead>
                          <TableHead className="text-right">Computed</TableHead>
                          <TableHead className="text-right">Variance</TableHead>
                          <TableHead>Last Tx</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Confidence</TableHead>
                          <TableHead>Likely Cause</TableHead>
                          <TableHead>Suggested Fix</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filterItems(walletIssues, ['customerName', 'email']).map(i => (
                          <TableRow key={i.customerId} className="cursor-pointer hover:bg-muted/40 transition-colors" onClick={() => setDetailWallet(i)}>
                            <TableCell className="font-medium text-sm">{i.customerName}</TableCell>
                            <TableCell className="text-xs">{i.email}</TableCell>
                            <TableCell className="text-right">{formatGHS(i.currentBalance)}</TableCell>
                            <TableCell className="text-right">{formatGHS(i.computedBalance)}</TableCell>
                            <TableCell className={`text-right font-semibold ${i.variance > 0 ? 'text-success' : 'text-destructive'}`}>
                              {i.variance > 0 ? '+' : ''}{formatGHS(i.variance)}
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{i.lastTxDate ? fmtDate(i.lastTxDate) : '—'}</TableCell>
                            <TableCell>{reconciliationBadge(i.reconciliationStatus)}</TableCell>
                            <TableCell>
                              {i.diagnosis && (
                                <Badge variant="outline" className={`text-[9px] whitespace-nowrap ${
                                  i.diagnosis.confidence === 'likely' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                                  i.diagnosis.confidence === 'possible' ? 'bg-warning/10 text-warning border-warning/20' :
                                  'bg-muted text-muted-foreground border-border'
                                }`}>
                                  {i.diagnosis.confidence === 'likely' ? '● Likely' : i.diagnosis.confidence === 'possible' ? '● Possible' : '● Review'}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                              <span className="line-clamp-2">{i.diagnosis?.likelyCause || i.issue}</span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[180px]">
                              <span className="line-clamp-2">{i.diagnosis?.suggestedFix || '—'}</span>
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); setDetailWallet(i); }}>
                                <Sparkles className="w-3 h-3" /> Investigate
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* MANUAL TAB */}
            <TabsContent value="manual">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Manual Adjustment Review</CardTitle>
                  <CardDescription>Admin manual credits and debits audit trail</CardDescription>
                </CardHeader>
                <CardContent>
                  {filterItems(manualAdjustments, ['customerName', 'description', 'reference']).filter(i => i.reconciliationStatus !== 'matched').length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-success" /><p>All manual adjustments properly recorded</p>
                    </div>
                  ) : isMobile ? (
                    <div className="space-y-3">
                      {filterItems(manualAdjustments, ['customerName', 'description', 'reference']).filter(i => i.reconciliationStatus !== 'matched').map(i => (
                        <MobileCard key={i.id} fields={[
                          { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
                          { label: 'Amount', value: <span className="font-semibold">{formatGHS(i.amount)}</span> },
                          { label: 'Type', value: <Badge variant={i.type === 'credit' ? 'default' : 'destructive'} className="text-[10px] capitalize">{i.type}</Badge> },
                          { label: 'Status', value: reconciliationBadge(i.reconciliationStatus) },
                        ]} action={
                          <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailManual(i)}>
                            <Eye className="w-3.5 h-3.5" /> View Details
                          </Button>
                        } />
                      ))}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Type</TableHead>
                          <TableHead>Amount</TableHead><TableHead>Processed By</TableHead><TableHead>Reason</TableHead>
                          <TableHead>Reference</TableHead><TableHead>Status</TableHead><TableHead>Issue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filterItems(manualAdjustments, ['customerName', 'description', 'reference']).filter(i => i.reconciliationStatus !== 'matched').map(i => (
                          <TableRow key={i.id}>
                            <TableCell className="text-xs whitespace-nowrap">{fmtDate(i.date)}</TableCell>
                            <TableCell className="font-medium text-sm">{i.customerName}</TableCell>
                            <TableCell><Badge variant={i.type === 'credit' ? 'default' : 'destructive'} className="text-xs capitalize">{i.type}</Badge></TableCell>
                            <TableCell>{formatGHS(i.amount)}</TableCell>
                            <TableCell className="text-xs">{i.adminName || <span className="text-destructive">Unknown</span>}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{i.description || '—'}</TableCell>
                            <TableCell className="text-xs font-mono">{i.reference || '—'}</TableCell>
                            <TableCell>{reconciliationBadge(i.reconciliationStatus)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{i.issue}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* STALE TAB */}
            <TabsContent value="stale">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Stale / Stuck Items</CardTitle>
                  <CardDescription>Orders pending &gt;{STALE_HOURS_ORDER}h and topups pending &gt;{STALE_HOURS_TOPUP}h</CardDescription>
                </CardHeader>
                <CardContent>
                  {staleItems.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-success" /><p>No stale items</p>
                    </div>
                  ) : isMobile ? (
                    <div className="space-y-3">
                      {staleItems.map(i => (
                        <MobileCard key={i.id} fields={[
                          { label: 'Type', value: <Badge variant={i.type === 'order' ? 'default' : 'secondary'} className="text-[10px] capitalize">{i.type}</Badge> },
                          { label: 'Customer', value: <span className="font-medium">{i.customerName}</span> },
                          { label: 'Amount', value: <span className="font-semibold">{formatGHS(i.amount)}</span> },
                          { label: 'Age', value: <span className="font-semibold text-warning">{i.hoursAgo}h ago</span> },
                        ]} action={
                          <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailStale(i)}>
                            <Eye className="w-3.5 h-3.5" /> View Details
                          </Button>
                        } />
                      ))}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead><TableHead>ID</TableHead><TableHead>Customer</TableHead>
                          <TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Mode</TableHead>
                          <TableHead>Age</TableHead><TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {staleItems.map(i => (
                          <TableRow key={i.id}>
                            <TableCell><Badge variant={i.type === 'order' ? 'default' : 'secondary'} className="text-xs capitalize">{i.type}</Badge></TableCell>
                            <TableCell className="text-xs font-mono">{i.shortId}</TableCell>
                            <TableCell className="font-medium text-sm">{i.customerName}</TableCell>
                            <TableCell>{formatGHS(i.amount)}</TableCell>
                            <TableCell><StatusBadge status={i.status} /></TableCell>
                            <TableCell className="text-xs capitalize">{i.deliveryMode || '-'}</TableCell>
                            <TableCell className="text-xs font-semibold text-warning">{i.hoursAgo}h ago</TableCell>
                            <TableCell className="text-xs">{fmtDate(i.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Detail Dialogs */}
      <DetailViewDialog open={!!detailPayment} onOpenChange={o => { if (!o) setDetailPayment(null); }} title="Payment Issue Details" fields={detailPayment ? getPaymentDetailFields(detailPayment) : []} />
      <DetailViewDialog open={!!detailOrder} onOpenChange={o => { if (!o) setDetailOrder(null); }} title="Order Issue Details" fields={detailOrder ? getOrderDetailFields(detailOrder) : []} />
      <WalletDiagnosticDrawer open={!!detailWallet} onOpenChange={o => { if (!o) setDetailWallet(null); }} issue={detailWallet} onStatusChange={loadReconciliation} />
      <DetailViewDialog open={!!detailManual} onOpenChange={o => { if (!o) setDetailManual(null); }} title="Manual Adjustment Details" fields={detailManual ? getManualDetailFields(detailManual) : []} />
      <DetailViewDialog open={!!detailStale} onOpenChange={o => { if (!o) setDetailStale(null); }} title="Stale Item Details" fields={detailStale ? getStaleDetailFields(detailStale) : []} />
    </AdminLayout>
  );
}
