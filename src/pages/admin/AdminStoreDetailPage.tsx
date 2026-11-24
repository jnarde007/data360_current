import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Pagination } from '@/components/Pagination';
import { formatGHS } from '@/lib/utils';
import {
  ArrowLeft, Store, Loader2, ExternalLink, TrendingUp, ShoppingCart, Wallet,
  CheckCircle2, XCircle, Package, Mail, Phone, Calendar, User, RefreshCw,
  ArrowDownCircle, ArrowUpCircle, Search, Download,
} from 'lucide-react';
import { format } from 'date-fns';
import { exportRowsToCSV, csvTimestamp } from '@/lib/csv-export';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 25;

export default function AdminStoreDetailPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (show = true) => {
    if (!storeId) return;
    if (show) setLoading(true);
    const { data } = await supabase.rpc('admin_store_detail' as any, { p_store_id: storeId });
    setDetail(data);
    if (show) setLoading(false);
  }, [storeId]);

  useEffect(() => { load(true); }, [load]);

  useEffect(() => {
    if (!storeId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(false), 500); };
    const channel = supabase
      .channel(`admin-store-detail-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders', filter: `store_id=eq.${storeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores', filter: `id=eq.${storeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_wallets' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_withdrawals' }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [storeId, load]);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      </AdminLayout>
    );
  }

  if (!detail?.store) {
    return (
      <AdminLayout>
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">Store not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/admin/stores')}>Back</Button>
        </Card>
      </AdminLayout>
    );
  }

  const s = detail.store;
  const o = detail.owner || {};
  const m = detail.metrics || {};
  const w = detail.wallet || {};
  const wd = detail.withdrawals || {};

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/stores')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Store Management
          </Button>
        </div>

        {/* Hero / Profile */}
        <Card className="p-5 sm:p-6 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row gap-5 items-start">
            <div className="flex-shrink-0">
              {s.logo_url ? (
                <img src={s.logo_url} alt={s.name} className="w-20 h-20 rounded-2xl object-cover border-2 border-border/50 shadow-sm" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center border-2 border-border/50">
                  <Store className="w-9 h-9 text-primary" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold truncate">{s.name}</h1>
                <StatusBadge status={s.status} />
              </div>
              {s.description && (
                <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{s.description}</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-muted-foreground">
                <a href={`/store/${s.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  /store/{s.slug} <ExternalLink className="w-3 h-3" />
                </a>
                <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />Registered {format(new Date(s.created_at), 'MMM d, yyyy')}</span>
                {m.last_activity_at && (
                  <span className="inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" />Last activity {format(new Date(m.last_activity_at), 'MMM d, yyyy · h:mm a')}</span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1 text-right">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Wallet (Available)</span>
              <span className="text-2xl font-bold text-success tabular-nums">{formatGHS(Number(w.available_balance || 0))}</span>
              <span className="text-[11px] text-muted-foreground">Pending {formatGHS(Number(w.pending_balance || 0))}</span>
            </div>
          </div>
        </Card>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi icon={TrendingUp} label="Total Revenue" value={formatGHS(Number(m.total_revenue || 0))} tone="primary" />
          <Kpi icon={ShoppingCart} label="Total Orders" value={String(m.total_orders || 0)} tone="info" />
          <Kpi icon={CheckCircle2} label="Successful" value={String(m.successful_orders || 0)} tone="success" />
          <Kpi icon={XCircle} label="Failed / Refunded" value={String(m.failed_orders || 0)} tone="danger" />
          <Kpi icon={TrendingUp} label="Avg Order Value" value={formatGHS(Number(m.avg_order_value || 0))} tone="purple" />
          <Kpi icon={Wallet} label="Available Balance" value={formatGHS(Number(w.available_balance || 0))} tone="success" />
          <Kpi icon={Wallet} label="Pending Settlement" value={formatGHS(Number(w.pending_balance || 0))} tone="warning" />
          <Kpi icon={ArrowDownCircle} label="Refund Amount" value={formatGHS(Number(m.refund_amount || 0))} tone="danger" />
          <Kpi icon={Package} label="Total Products" value={String(m.total_products || 0)} tone="info" />
          <Kpi icon={ArrowUpCircle} label="Pending Withdrawals" value={formatGHS(Number(wd.pending_amount || 0))} tone="warning" subtitle={`${wd.pending_count || 0} request${(wd.pending_count || 0) === 1 ? '' : 's'}`} />
        </div>

        {/* Owner Info */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <User className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Store Owner</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <Field label="Full Name" value={o.full_name || '—'} />
            <Field label="Username" value={o.username || '—'} />
            <Field label="Email" value={o.email || '—'} icon={Mail} />
            <Field label="Phone" value={o.phone || '—'} icon={Phone} />
            <Field label="Account Status" value={<StatusBadge status={o.status || 'active'} />} />
            <Field label="Email Verified" value={o.email_verified ? <span className="text-success">Yes</span> : <span className="text-destructive">No</span>} />
            <Field label="Registered" value={o.created_at ? format(new Date(o.created_at), 'MMM d, yyyy') : '—'} />
            <Field label="Customer ID" value={
              o.id ? (
                <Link to={`/admin/customers/${o.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                  View customer <ExternalLink className="w-3 h-3" />
                </Link>
              ) : '—'
            } />
          </div>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="transactions">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="ledger">Financial Ledger</TabsTrigger>
            <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
          </TabsList>
          <TabsContent value="transactions"><TransactionsTab storeId={s.id} /></TabsContent>
          <TabsContent value="ledger"><LedgerTab storeId={s.id} ownerId={s.owner_id} wallet={w} /></TabsContent>
          <TabsContent value="withdrawals"><WithdrawalsTab ownerId={s.owner_id} /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

// ───────── Helpers ─────────

function Field({ label, value, icon: Icon }: { label: string; value: any; icon?: any }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80 mb-1">{label}</div>
      <div className="text-sm font-medium flex items-center gap-1.5 break-words">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        <span className="break-all">{value}</span>
      </div>
    </div>
  );
}

const TONES = {
  primary: { bg: 'bg-primary/10', text: 'text-primary' },
  success: { bg: 'bg-success/10', text: 'text-success' },
  danger:  { bg: 'bg-destructive/10', text: 'text-destructive' },
  warning: { bg: 'bg-amber/10', text: 'text-amber' },
  info:    { bg: 'bg-info/10', text: 'text-info' },
  purple:  { bg: 'bg-purple/10', text: 'text-purple' },
} as const;

function Kpi({ icon: Icon, label, value, tone, subtitle }: { icon: any; label: string; value: string; tone: keyof typeof TONES; subtitle?: string }) {
  const t = TONES[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{label}</span>
        <div className={`w-7 h-7 rounded-lg ${t.bg} flex items-center justify-center`}>
          <Icon className={`w-3.5 h-3.5 ${t.text}`} />
        </div>
      </div>
      <p className="text-lg font-bold tabular-nums leading-tight">{value}</p>
      {subtitle && <p className="text-[10px] text-muted-foreground mt-1">{subtitle}</p>}
    </Card>
  );
}

// ───────── Transactions Tab ─────────

function TransactionsTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('store_orders' as any)
      .select(`
        id, created_at, amount_paid, profit, status, kind, buyer_phone, order_id,
        orders!store_orders_order_id_fkey(short_id, total_amount, payment_method, customer_id, customers(full_name, email, phone))
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(1000);
    setRows(((data as any) || []));
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const channel = supabase
      .channel(`store-tx-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders', filter: `store_id=eq.${storeId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId, load]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!ql) return true;
      const o = r.orders;
      return (
        r.buyer_phone?.toLowerCase().includes(ql) ||
        o?.short_id?.toLowerCase().includes(ql) ||
        o?.customers?.full_name?.toLowerCase().includes(ql) ||
        o?.customers?.email?.toLowerCase().includes(ql)
      );
    });
  }, [rows, q, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="p-4 border-b border-border/50 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search order, customer, phone…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
        <Button size="sm" variant="outline" disabled={!filtered.length} onClick={() => {
          exportRowsToCSV(`store-transactions-${storeId.slice(0,8)}-${csvTimestamp()}.csv`, filtered.map(r => ({
            date: new Date(r.created_at).toISOString(),
            order_id: r.orders?.short_id || '',
            customer: r.orders?.customers?.full_name || 'Guest',
            email: r.orders?.customers?.email || '',
            buyer_phone: r.buyer_phone || '',
            kind: r.kind,
            amount_paid: Number(r.amount_paid || 0).toFixed(2),
            platform_cut: (Number(r.amount_paid || 0) - Number(r.profit || 0)).toFixed(2),
            store_earnings: Number(r.profit || 0).toFixed(2),
            status: r.status,
          })), [
            { key: 'date', label: 'Date' },
            { key: 'order_id', label: 'Order ID' },
            { key: 'customer', label: 'Customer' },
            { key: 'email', label: 'Email' },
            { key: 'buyer_phone', label: 'Buyer Phone' },
            { key: 'kind', label: 'Type' },
            { key: 'amount_paid', label: 'Amount Paid (GHS)' },
            { key: 'platform_cut', label: 'Platform Cut (GHS)' },
            { key: 'store_earnings', label: 'Store Earnings (GHS)' },
            { key: 'status', label: 'Status' },
          ]);
        }}>
          <Download className="w-4 h-4 mr-2" />Export
        </Button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">{filtered.length} transaction{filtered.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Platform</TableHead>
              <TableHead className="text-right">Store Earnings</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">No transactions match these filters.</TableCell></TableRow>
            )}
            {pageRows.map(r => {
              const o = r.orders;
              const platformCut = Number(r.amount_paid || 0) - Number(r.profit || 0);
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), 'MMM d · h:mm a')}</TableCell>
                  <TableCell className="text-xs font-mono">{o?.short_id || '—'}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{o?.customers?.full_name || 'Guest'}</div>
                    <div className="text-muted-foreground">{r.buyer_phone}</div>
                  </TableCell>
                  <TableCell className="text-xs capitalize">{r.kind}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatGHS(Number(r.amount_paid))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatGHS(platformCut)}</TableCell>
                  <TableCell className="text-right tabular-nums text-success font-semibold">{formatGHS(Number(r.profit))}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={filtered.length} label="transactions" />
    </Card>
  );
}

// ───────── Ledger Tab ─────────

function LedgerTab({ storeId, ownerId, wallet }: { storeId: string; ownerId: string; wallet: any }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const [orders, withdrawals] = await Promise.all([
      supabase.from('store_orders' as any)
        .select('id, created_at, amount_paid, profit, status, orders!store_orders_order_id_fkey(short_id)')
        .eq('store_id', storeId)
        .in('status', ['delivered', 'refunded'])
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('store_withdrawals' as any)
        .select('id, created_at, updated_at, amount, status, paystack_reference, momo_number')
        .eq('owner_id', ownerId)
        .in('status', ['paid', 'pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const list: any[] = [];
    ((orders.data as any) || []).forEach((o: any) => {
      if (o.status === 'delivered') {
        list.push({
          date: o.created_at, kind: 'credit', amount: Number(o.profit || 0),
          description: `Sale earnings · Order ${o.orders?.short_id || ''}`.trim(),
          reference: o.id.slice(0, 8).toUpperCase(),
        });
      } else if (o.status === 'refunded') {
        list.push({
          date: o.created_at, kind: 'debit', amount: Number(o.profit || 0),
          description: `Refund reversal · Order ${o.orders?.short_id || ''}`.trim(),
          reference: o.id.slice(0, 8).toUpperCase(),
        });
      }
    });
    ((withdrawals.data as any) || []).forEach((w: any) => {
      list.push({
        date: w.status === 'paid' ? (w.updated_at || w.created_at) : w.created_at,
        kind: 'debit',
        amount: Number(w.amount || 0),
        description: `Withdrawal to ${w.momo_number} (${w.status})`,
        reference: w.paystack_reference || w.id.slice(0, 8).toUpperCase(),
        pending: w.status !== 'paid',
      });
    });

    list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // running balance forward
    let bal = 0;
    list.forEach(e => {
      bal += e.kind === 'credit' ? e.amount : -e.amount;
      e.running = bal;
    });
    list.reverse(); // show newest first

    setEntries(list);
    setLoading(false);
  }, [storeId, ownerId]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const pageRows = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="p-4 border-b border-border/50 flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Available</div>
          <div className="text-lg font-bold text-success tabular-nums">{formatGHS(Number(wallet?.available_balance || 0))}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pending</div>
          <div className="text-lg font-bold text-amber tabular-nums">{formatGHS(Number(wallet?.pending_balance || 0))}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Withdrawn (lifetime)</div>
          <div className="text-lg font-bold text-muted-foreground tabular-nums">{formatGHS(Number(wallet?.withdrawn_balance || 0))}</div>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" disabled={!entries.length} onClick={() => {
          // Export in chronological order with running balance
          const chronological = [...entries].reverse();
          exportRowsToCSV(`store-ledger-${storeId.slice(0,8)}-${csvTimestamp()}.csv`, chronological.map(e => ({
            date: new Date(e.date).toISOString(),
            description: e.description,
            reference: e.reference,
            credit: e.kind === 'credit' ? Number(e.amount).toFixed(2) : '',
            debit: e.kind === 'debit' ? Number(e.amount).toFixed(2) : '',
            running_balance: Number(e.running).toFixed(2),
          })), [
            { key: 'date', label: 'Date' },
            { key: 'description', label: 'Description' },
            { key: 'reference', label: 'Reference' },
            { key: 'credit', label: 'Credit (GHS)' },
            { key: 'debit', label: 'Debit (GHS)' },
            { key: 'running_balance', label: 'Running Balance (GHS)' },
          ]);
        }}>
          <Download className="w-4 h-4 mr-2" />Export
        </Button>
        <span className="text-xs text-muted-foreground">Bank-statement view · newest first</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Running Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">No ledger entries yet.</TableCell></TableRow>
            )}
            {pageRows.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs whitespace-nowrap">{format(new Date(e.date), 'MMM d · h:mm a')}</TableCell>
                <TableCell className="text-xs">{e.description}{e.pending && <span className="ml-1 text-amber">·pending</span>}</TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">{e.reference}</TableCell>
                <TableCell className="text-right tabular-nums text-success font-medium">{e.kind === 'credit' ? formatGHS(e.amount) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-destructive font-medium">{e.kind === 'debit' ? formatGHS(e.amount) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{formatGHS(e.running)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={entries.length} label="entries" />
    </Card>
  );
}

// ───────── Withdrawals Tab ─────────

function WithdrawalsTab({ ownerId }: { ownerId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ amount: '', momoNumber: '', momoName: '', network: 'MTN', note: '' });
  const [wallet, setWallet] = useState<{ available_balance: number; locked_balance: number } | null>(null);

  const load = async () => {
    setLoading(true);
    const [payouts, legacy, w] = await Promise.all([
      supabase.from('payouts')
        .select('id, short_id, amount, status, created_at, completed_at, momo_number, momo_name, network, paystack_transfer_code, paystack_transfer_reference, admin_note, failure_reason, rail')
        .eq('payout_type', 'store')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('store_withdrawals' as any).select('*').eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(200),
      supabase.from('store_wallets' as any).select('available_balance, locked_balance').eq('owner_id', ownerId).maybeSingle(),
    ]);
    setWallet((w.data as any) || { available_balance: 0, locked_balance: 0 });

    const merged = [
      ...((payouts.data as any[]) || []).map((p: any) => ({
        kind: 'payout' as const,
        id: p.id,
        short_id: p.short_id,
        amount: p.amount,
        status: p.status,
        created_at: p.created_at,
        momo_number: p.momo_number,
        momo_name: p.momo_name,
        network: p.network,
        paystack_reference: p.paystack_transfer_reference,
        rail: p.rail,
        admin_notes: p.admin_note,
        failure_reason: p.failure_reason,
      })),
      ...((legacy.data as any[]) || []).map((l: any) => ({
        kind: 'legacy' as const,
        id: l.id,
        amount: l.amount,
        status: l.status,
        created_at: l.created_at,
        momo_number: l.momo_number,
        momo_name: l.momo_name,
        paystack_reference: l.paystack_reference,
        admin_notes: l.admin_notes,
      })),
    ].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setItems(merged);
    setLoading(false);
  };

  useEffect(() => {
    let live = true;
    load();
    const channel = supabase
      .channel(`store-wd-${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_withdrawals', filter: `owner_id=eq.${ownerId}` }, () => { if (live) load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payouts', filter: `owner_id=eq.${ownerId}` }, () => { if (live) load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_wallets', filter: `owner_id=eq.${ownerId}` }, () => { if (live) load(); })
      .subscribe();
    return () => { live = false; supabase.removeChannel(channel); };
  }, [ownerId]);

  const submitPayout = async () => {
    const amt = parseFloat(form.amount);
    if (!amt || amt < 20) { toast({ title: 'Minimum payout is GHS 20', variant: 'destructive' }); return; }
    if (!form.momoNumber || !form.momoName) { toast({ title: 'MoMo number and name required', variant: 'destructive' }); return; }
    setSubmitting(true);
    const idem = `store-${ownerId}-${Date.now()}`;
    const { data, error } = await supabase.rpc('admin_create_store_payout', {
      p_owner_id: ownerId,
      p_amount: amt,
      p_momo_number: form.momoNumber,
      p_momo_name: form.momoName,
      p_network: form.network,
      p_admin_note: form.note,
      p_idempotency_key: idem,
    });
    setSubmitting(false);
    const r = data as any;
    if (error || r?.error) {
      toast({ title: 'Failed to create payout', description: error?.message || r?.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Payout created', description: 'Funds locked. Approve & send from the Payouts page.' });
    setCreateOpen(false);
    setForm({ amount: '', momoNumber: '', momoName: '', network: 'MTN', note: '' });
    load();
  };

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="p-4 border-b border-border/50 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Available</div>
            <div className="text-base font-bold text-success tabular-nums">{formatGHS(Number(wallet?.available_balance || 0))}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Locked</div>
            <div className="text-base font-bold text-amber tabular-nums">{formatGHS(Number(wallet?.locked_balance || 0))}</div>
          </div>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums ml-auto">{items.length} record{items.length === 1 ? '' : 's'}</span>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!Number(wallet?.available_balance || 0)}>
          <ArrowUpCircle className="w-4 h-4 mr-2" />Create Payout
        </Button>
        <Button size="sm" variant="outline" disabled={!items.length} onClick={() => {
          exportRowsToCSV(`store-payouts-${ownerId.slice(0,8)}-${csvTimestamp()}.csv`, items.map((w: any) => ({
            date: new Date(w.created_at).toISOString(),
            kind: w.kind,
            short_id: w.short_id || '',
            amount: Number(w.amount).toFixed(2),
            momo_number: w.momo_number,
            momo_name: w.momo_name,
            network: w.network || '',
            status: w.status,
            paystack_reference: w.paystack_reference || '',
            rail: w.rail || '',
            failure_reason: w.failure_reason || '',
            notes: w.admin_notes || '',
          })), [
            { key: 'date', label: 'Date' },
            { key: 'kind', label: 'Source' },
            { key: 'short_id', label: 'Payout ID' },
            { key: 'amount', label: 'Amount (GHS)' },
            { key: 'momo_number', label: 'MoMo Number' },
            { key: 'momo_name', label: 'MoMo Name' },
            { key: 'network', label: 'Network' },
            { key: 'status', label: 'Status' },
            { key: 'paystack_reference', label: 'Paystack Ref' },
            { key: 'rail', label: 'Rail' },
            { key: 'failure_reason', label: 'Failure Reason' },
            { key: 'notes', label: 'Notes' },
          ]);
        }}>
          <Download className="w-4 h-4 mr-2" />Export
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>ID / Source</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>MoMo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Paystack Ref</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">No payouts.</TableCell></TableRow>}
            {items.map((w: any) => (
              <TableRow key={`${w.kind}-${w.id}`}>
                <TableCell className="text-xs whitespace-nowrap">{format(new Date(w.created_at), 'MMM d, yyyy · h:mm a')}</TableCell>
                <TableCell className="text-xs font-mono">
                  {w.short_id || w.id.slice(0,8).toUpperCase()}
                  <div className="text-[10px] text-muted-foreground">{w.kind === 'payout' ? 'Paystack' : 'Legacy'}</div>
                </TableCell>
                <TableCell className="font-semibold tabular-nums">{formatGHS(Number(w.amount))}</TableCell>
                <TableCell className="text-xs">{w.momo_number}{w.network && <span className="text-muted-foreground"> ({w.network})</span>}<br /><span className="text-muted-foreground">{w.momo_name}</span></TableCell>
                <TableCell><StatusBadge status={w.status} /></TableCell>
                <TableCell className="text-xs font-mono">{w.paystack_reference || '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{w.failure_reason || w.admin_notes || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Store Payout</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Available: <span className="font-semibold text-foreground">{formatGHS(Number(wallet?.available_balance || 0))}</span> · Funds will be locked at request and sent via Paystack after approval.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount (GHS)</Label><Input type="number" min="20" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div>
                <Label>Network</Label>
                <select className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={form.network} onChange={e => setForm(f => ({ ...f, network: e.target.value }))}>
                  <option value="MTN">MTN</option>
                  <option value="VOD">Telecel (Vodafone)</option>
                  <option value="ATL">AirtelTigo</option>
                </select>
              </div>
              <div><Label>MoMo Number</Label><Input value={form.momoNumber} onChange={e => setForm(f => ({ ...f, momoNumber: e.target.value }))} placeholder="0244..." /></div>
              <div><Label>MoMo Name</Label><Input value={form.momoName} onChange={e => setForm(f => ({ ...f, momoName: e.target.value }))} placeholder="Full name on MoMo" /></div>
            </div>
            <div><Label>Note (optional)</Label><Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={submitPayout} disabled={submitting}>{submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Create Payout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
