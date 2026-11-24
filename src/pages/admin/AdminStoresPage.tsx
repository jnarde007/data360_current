import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import { Store, Loader2, Pause, Play, Check, X, ExternalLink, TrendingUp, Eye, MousePointerClick, ShoppingCart, Trash2, Search, ArrowUpDown } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { AdminLayout } from '@/components/AdminLayout';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Pagination } from '@/components/Pagination';
import { format } from 'date-fns';

const PAGE_SIZE = 20;

export default function AdminStoresPage() {
  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Store className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Store Management</h1>
            <p className="text-xs text-muted-foreground">Vendor stores, transactions, withdrawals and SMS templates.</p>
          </div>
        </div>
        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="top">Top Stores</TabsTrigger>
            <TabsTrigger value="stores">All Stores</TabsTrigger>
            <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
            <TabsTrigger value="sms">SMS Templates</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><GlobalOverview /></TabsContent>
          <TabsContent value="top"><TopStores /></TabsContent>
          <TabsContent value="stores"><StoresList /></TabsContent>
          <TabsContent value="withdrawals"><WithdrawalsList /></TabsContent>
          <TabsContent value="sms"><SmsTemplates /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}


function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d.toISOString();
}

function GlobalOverview() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const { data } = await supabase.rpc('admin_global_store_metrics' as any, {
      p_from: daysAgo(30), p_to: new Date().toISOString(),
    });
    setData(data); if (showSpinner) setLoading(false);
  }, []);
  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(false), 500); };
    const channel = supabase
      .channel('admin-store-overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_visits' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_product_clicks' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_checkout_initiations' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_withdrawals' }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [load]);

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;
  const d = data || {};
  const conv = Number(d.total_visits || 0) > 0 ? ((Number(d.total_orders || 0) / Number(d.total_visits)) * 100).toFixed(1) : '0';
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
      <MetricCard label="Total Stores" value={String(d.total_stores || 0)} icon={Store} accent="blue" />
      <MetricCard label="Active Stores" value={String(d.active_stores || 0)} icon={Store} accent="green" />
      <MetricCard label="Visits (30d)" value={String(d.total_visits || 0)} icon={Eye} accent="teal" />
      <MetricCard label="Clicks (30d)" value={String(d.total_clicks || 0)} icon={MousePointerClick} accent="purple" />
      <MetricCard label="Checkouts (30d)" value={String(d.total_checkouts || 0)} icon={ShoppingCart} accent="amber" />
      <MetricCard label="Orders (30d)" value={String(d.total_orders || 0)} icon={TrendingUp} accent="blue" />
      <MetricCard label="Gross Revenue (30d)" value={formatGHS(Number(d.gross_revenue || 0))} icon={TrendingUp} accent="green" />
      <MetricCard label="Owner Profit (30d)" value={formatGHS(Number(d.total_owner_profit || 0))} icon={TrendingUp} accent="teal" />
      <MetricCard label="Conversion" value={`${conv}%`} icon={TrendingUp} accent="purple" />
      <MetricCard label="Pending Withdrawals" value={formatGHS(Number(d.pending_withdrawals || 0))} icon={ShoppingCart} accent="amber" />
    </div>
  );
}

const ACCENTS: Record<string, { icon: string; ring: string; value: string; bar: string }> = {
  blue:   { icon: 'icon-box-primary',     ring: 'border-l-[3px] border-l-primary/60',     value: 'text-primary',     bar: 'from-primary/[0.06]' },
  green:  { icon: 'icon-box-success',     ring: 'border-l-[3px] border-l-success/60',     value: 'text-success',     bar: 'from-success/[0.06]' },
  teal:   { icon: 'icon-box-teal',        ring: 'border-l-[3px] border-l-teal/60',        value: 'text-teal',        bar: 'from-teal/[0.06]' },
  purple: { icon: 'icon-box-purple',      ring: 'border-l-[3px] border-l-purple/60',      value: 'text-purple',      bar: 'from-purple/[0.06]' },
  amber:  { icon: 'icon-box-amber',       ring: 'border-l-[3px] border-l-amber/60',       value: 'text-amber',       bar: 'from-amber/[0.06]' },
  red:    { icon: 'icon-box-destructive', ring: 'border-l-[3px] border-l-destructive/60', value: 'text-destructive', bar: 'from-destructive/[0.06]' },
};

function MetricCard({ label, value, icon: Icon, accent = 'blue' }: any) {
  const a = ACCENTS[accent] || ACCENTS.blue;
  return (
    <Card className={`relative overflow-hidden p-4 ${a.ring} transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${a.bar} to-transparent pointer-events-none`} />
      <div className="relative flex items-start justify-between gap-2 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 leading-tight">{label}</span>
        <div className={`icon-box icon-box-sm ${a.icon}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <p className={`relative text-xl font-bold tabular-nums tracking-tight ${a.value}`}>{value}</p>
    </Card>
  );
}

function TopStores() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const { data } = await supabase.rpc('admin_top_stores' as any, {
      p_from: daysAgo(30), p_to: new Date().toISOString(), p_limit: 25,
    });
    setRows(((data as any) || []).filter((r: any) => r.status !== 'deleted'));
    if (showSpinner) setLoading(false);
  }, []);
  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(false), 500); };
    const channel = supabase
      .channel('admin-top-stores')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [load]);
  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;
  return (
    <Card className="p-4 mt-4">
      <h3 className="text-sm font-semibold mb-3">Top stores by revenue (last 30 days)</h3>
      <Table>
        <TableHeader><TableRow><TableHead>Store</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead><TableHead>Orders</TableHead><TableHead>Revenue</TableHead><TableHead>Profit</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No store sales in this period.</TableCell></TableRow>}
          {rows.map((r: any) => (
            <TableRow key={r.store_id}>
              <TableCell>
                <a href={`/store/${r.slug}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">{r.name}<ExternalLink className="w-3 h-3" /></a>
              </TableCell>
              <TableCell className="text-xs">{r.owner_name || '—'}</TableCell>
              <TableCell><StatusBadge status={r.status} /></TableCell>
              <TableCell>{r.orders}</TableCell>
              <TableCell>{formatGHS(Number(r.revenue))}</TableCell>
              <TableCell className="text-primary font-semibold">{formatGHS(Number(r.profit))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}


type SortKey = 'created_at' | 'name' | 'total_revenue' | 'total_orders' | 'wallet_available' | 'last_activity_at';

function StoresList() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [storeToDelete, setStoreToDelete] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [storeToApprove, setStoreToApprove] = useState<any | null>(null);
  const [approveLoading, setApproveLoading] = useState(false);

  const load = useCallback(async (show = true) => {
    if (show) setLoading(true);
    const { data } = await supabase.rpc('admin_store_management_list' as any);
    setRows((data as any) || []);
    if (show) setLoading(false);
  }, []);

  useEffect(() => { load(true); }, [load]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(false), 600); };
    const channel = supabase
      .channel('admin-store-mgmt-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_wallets' }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [load]);

  const toggleStatus = async (s: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = s.status === 'active' ? 'suspended' : 'active';
    let reason = '';
    if (newStatus === 'suspended') {
      reason = (prompt('Reason for suspension (sent to the store owner via SMS, optional):') || '').trim();
    }
    const { error } = await supabase.rpc('admin_set_store_status' as any, { p_store_id: s.store_id, p_status: newStatus });
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    if (newStatus === 'suspended') {
      supabase.functions.invoke('store-owner-notify', {
        body: { event: 'store_suspended', store_id: s.store_id, reason },
      }).catch(() => {});
    }
    toast({ title: `Store ${newStatus}` });
    load(false);
  };


  const openDeleteDialog = (s: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setStoreToDelete(s);
    setDeleteReason('');
  };

  const openApproveDialog = (s: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setStoreToApprove(s);
  };

  const doDeleteStore = async () => {
    if (!storeToDelete) return;
    if (storeToDelete.status === 'pending' && !deleteReason.trim()) {
      toast({ title: 'Reason required', description: 'Please provide a reason for rejecting this store.', variant: 'destructive' });
      return;
    }
    setDeleteLoading(true);
    const { error } = await supabase.rpc('admin_delete_store' as any, {
      p_store_id: storeToDelete.store_id,
      p_reason: deleteReason,
    });
    setDeleteLoading(false);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      const isReject = storeToDelete.status === 'pending';
      if (isReject) {
        supabase.functions.invoke('store-owner-notify', {
          body: { event: 'store_rejected', store_id: storeToDelete.store_id, reason: deleteReason },
        }).catch(() => {});
      }
      toast({ title: isReject ? 'Store rejected' : 'Store deleted', description: 'Owner can now create a new store.' });
      setStoreToDelete(null);
      load(false);
    }
  };

  const doApproveStore = async () => {
    if (!storeToApprove) return;
    setApproveLoading(true);
    const { error } = await supabase.rpc('admin_set_store_status' as any, { p_store_id: storeToApprove.store_id, p_status: 'active' });
    setApproveLoading(false);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    } else {
      supabase.functions.invoke('store-owner-notify', {
        body: { event: 'store_approved', store_id: storeToApprove.store_id },
      }).catch(() => {});
      toast({ title: 'Store approved', description: `"${storeToApprove.name}" is now live.` });
      setStoreToApprove(null);
      load(false);
    }
  };

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    let r = rows.slice();
    if (statusFilter !== 'all') r = r.filter(x => x.status === statusFilter);
    if (ql) r = r.filter(x =>
      x.name?.toLowerCase().includes(ql) ||
      x.slug?.toLowerCase().includes(ql) ||
      x.owner_name?.toLowerCase().includes(ql) ||
      x.owner_email?.toLowerCase().includes(ql) ||
      x.owner_phone?.toLowerCase().includes(ql),
    );
    r.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [rows, q, statusFilter, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [q, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const SortHeader = ({ k, children, align }: { k: SortKey; children: React.ReactNode; align?: 'right' }) => (
    <TableHead className={align === 'right' ? 'text-right' : ''}>
      <button
        onClick={() => {
          if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
          else { setSortKey(k); setSortDir('desc'); }
        }}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {children}<ArrowUpDown className="w-3 h-3 opacity-60" />
      </button>
    </TableHead>
  );

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="p-4 border-b border-border/50 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search store, owner, email, phone…"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">{filtered.length} store{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <TableRow>
              <SortHeader k="name">Store</SortHeader>
              <TableHead>Owner</TableHead>
              <TableHead>Contact</TableHead>
              <SortHeader k="total_revenue" align="right">Revenue</SortHeader>
              <SortHeader k="total_orders" align="right">Orders</SortHeader>
              <SortHeader k="wallet_available" align="right">Wallet</SortHeader>
              <TableHead>Status</TableHead>
              <SortHeader k="last_activity_at">Last Activity</SortHeader>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-12">
                <Store className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No stores match these filters.
              </TableCell></TableRow>
            )}
            {pageRows.map(s => (
              <TableRow
                key={s.store_id}
                onClick={() => navigate(`/admin/stores/${s.store_id}`)}
                className="cursor-pointer"
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    {s.logo_url ? (
                      <img src={s.logo_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-border/50" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Store className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{s.name}</div>
                      <a href={`/store/${s.slug}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                        /{s.slug}<ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium">{s.owner_name || '—'}</div>
                  {s.owner_username && <div className="text-muted-foreground">@{s.owner_username}</div>}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="truncate max-w-[180px]">{s.owner_email || '—'}</div>
                  <div className="text-muted-foreground">{s.owner_phone || '—'}</div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatGHS(Number(s.total_revenue))}</TableCell>
                <TableCell className="text-right text-xs">
                  <div className="font-semibold tabular-nums">{s.total_orders}</div>
                  <div className="text-[10px] text-muted-foreground">{s.successful_orders} ok · {s.pending_orders} pending</div>
                </TableCell>
                <TableCell className="text-right text-xs">
                  <div className="font-semibold text-success tabular-nums">{formatGHS(Number(s.wallet_available))}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">+{formatGHS(Number(s.wallet_pending))} pending</div>
                </TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {s.last_activity_at ? format(new Date(s.last_activity_at), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1 flex-wrap">
                    {s.status === 'pending' && (
                      <Button size="sm" onClick={(e) => openApproveDialog(s, e)}>
                        <Check className="w-3.5 h-3.5 mr-1" />Approve
                      </Button>
                    )}
                    {s.status !== 'pending' && (
                      <Button size="sm" variant="outline" onClick={(e) => toggleStatus(s, e)}>
                        {s.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/admin/stores/${s.store_id}`); }}>
                      View
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => openDeleteDialog(s, e)} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden p-3 space-y-3 bg-muted/20">
        {pageRows.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">No stores match these filters.</div>
        )}
        {pageRows.map(s => (
          <div
            key={s.store_id}
            className="w-full text-left rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden"
          >
            {/* Clickable header area */}
            <button
              onClick={() => navigate(`/admin/stores/${s.store_id}`)}
              className="w-full text-left flex items-center gap-3 p-3.5 pb-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
            >
              {s.logo_url ? (
                <img src={s.logo_url} alt="" className="w-11 h-11 rounded-xl object-cover border border-border/50 flex-shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Store className="w-5 h-5 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[15px] leading-tight truncate">{s.name}</div>
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {s.owner_name}{s.owner_email ? ` · ${s.owner_email}` : ''}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </button>

            {/* Stats strip */}
            <div className="grid grid-cols-3 border-t border-border/50 bg-muted/30">
              <div className="px-3 py-2.5 text-center border-r border-border/50">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium">Revenue</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{formatGHS(Number(s.total_revenue))}</div>
              </div>
              <div className="px-3 py-2.5 text-center border-r border-border/50">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium">Orders</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{s.total_orders}</div>
              </div>
              <div className="px-3 py-2.5 text-center">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium">Wallet</div>
                <div className="text-sm font-bold text-success tabular-nums mt-0.5">{formatGHS(Number(s.wallet_available))}</div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 p-2.5 border-t border-border/50">
              {s.status === 'pending' && (
                <Button size="sm" className="flex-1 h-8 text-xs" onClick={(e) => openApproveDialog(s, e)}>
                  <Check className="w-3.5 h-3.5 mr-1" />Approve
                </Button>
              )}
              {s.status !== 'pending' && (
                <Button
                  size="sm"
                  variant={s.status === 'active' ? 'outline' : 'default'}
                  className="flex-1 h-8 text-xs"
                  onClick={(e) => toggleStatus(s, e)}
                >
                  {s.status === 'active' ? (
                    <><Pause className="w-3.5 h-3.5 mr-1" />Suspend</>
                  ) : (
                    <><Play className="w-3.5 h-3.5 mr-1" />Activate</>
                  )}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs px-3"
                onClick={(e) => { e.stopPropagation(); navigate(`/admin/stores/${s.store_id}`); }}
              >
                View
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2.5 text-destructive hover:text-destructive"
                onClick={(e) => openDeleteDialog(s, e)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={filtered.length} label="stores" />

      <ConfirmDialog
        open={!!storeToDelete}
        onOpenChange={(open) => { if (!open) { setStoreToDelete(null); setDeleteReason(''); } }}
        title={storeToDelete?.status === 'pending' ? `Reject store "${storeToDelete?.name || ''}"?` : `Delete store "${storeToDelete?.name || ''}"?`}
        description={
          <div className="space-y-2">
            {storeToDelete?.status === 'pending' ? (
              <p>This will reject the store application and free the handle so the owner can create a new store.</p>
            ) : (
              <>
                <p>This will <strong>soft-delete</strong> the store, removing it from the marketplace and freeing the handle so the owner can create a new store.</p>
                <p>All historical orders, withdrawals, and analytics will remain intact.</p>
              </>
            )}
          </div>
        }
        confirmLabel={storeToDelete?.status === 'pending' ? 'Reject Store' : 'Delete Store'}
        cancelLabel="Cancel"
        destructive
        loading={deleteLoading}
        onConfirm={doDeleteStore}
      >
        <div className="mt-3">
          <label className="text-xs text-muted-foreground block mb-1">
            {storeToDelete?.status === 'pending' ? 'Reason for rejection *' : 'Optional reason'}
          </label>
          <Textarea
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder={storeToDelete?.status === 'pending' ? 'e.g. Missing business details…' : 'e.g. Violated content policy…'}
            className="min-h-[60px] text-sm"
          />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!storeToApprove}
        onOpenChange={(open) => { if (!open) setStoreToApprove(null); }}
        title={`Approve store "${storeToApprove?.name || ''}"?`}
        description={`This will publish the store to the marketplace and allow customers to start placing orders.`}
        confirmLabel="Approve Store"
        cancelLabel="Cancel"
        loading={approveLoading}
        onConfirm={doApproveStore}
      />
    </Card>
  );
}


function WithdrawalsList() {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ref, setRef] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('store_withdrawals' as any)
      .select('*, customers!store_withdrawals_owner_id_fkey(full_name, email)')
      .order('created_at', { ascending: false }).limit(200);
    setItems((data as any) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Realtime: new withdrawal requests appear instantly
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(), 400); };
    const channel = supabase
      .channel('admin-store-withdrawals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_withdrawals' }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [load]);

  const complete = async (id: string) => {
    const { error } = await supabase.rpc('admin_complete_store_withdrawal' as any, { p_id: id, p_paystack_reference: ref[id] || '' });
    if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    else {
      supabase.functions.invoke('store-owner-notify', {
        body: { event: 'store_withdrawal_paid', withdrawal_id: id },
      }).catch(() => {});
      toast({ title: 'Marked as paid' }); load();
    }
  };
  const reject = async (id: string) => {
    const reason = (prompt('Reason for rejection (sent to owner via SMS):') || '').trim();
    const { error } = await supabase.rpc('admin_reject_store_withdrawal' as any, { p_id: id, p_reason: reason });
    if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    else {
      supabase.functions.invoke('store-owner-notify', {
        body: { event: 'store_withdrawal_rejected', withdrawal_id: id, reason },
      }).catch(() => {});
      toast({ title: 'Rejected and refunded' });
      load();
    }
  };


  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;
  return (
    <Card className="p-4 mt-4">
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Owner</TableHead><TableHead>Amount</TableHead><TableHead>MoMo</TableHead><TableHead>Status</TableHead><TableHead>Paystack Ref</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {items.map(w => (
            <TableRow key={w.id}>
              <TableCell className="text-xs">{new Date(w.created_at).toLocaleString()}</TableCell>
              <TableCell className="text-xs">{w.customers?.full_name}<br /><span className="text-muted-foreground">{w.customers?.email}</span></TableCell>
              <TableCell className="font-semibold">{formatGHS(Number(w.amount))}</TableCell>
              <TableCell className="text-xs">{w.momo_number}<br /><span className="text-muted-foreground">{w.momo_name}</span></TableCell>
              <TableCell><StatusBadge status={w.status} /></TableCell>
              <TableCell>
                {w.status === 'pending' ? (
                  <Input placeholder="ref" value={ref[w.id] || ''} onChange={e => setRef({ ...ref, [w.id]: e.target.value })} className="w-32 text-xs" />
                ) : <span className="text-xs">{w.paystack_reference || '—'}</span>}
              </TableCell>
              <TableCell>
                {w.status === 'pending' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" onClick={() => complete(w.id)}><Check className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="destructive" onClick={() => reject(w.id)}><X className="w-3.5 h-3.5" /></Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No withdrawals.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}

// ── SMS Templates panel ────────────────────────────────────────────────
type SmsEvent =
  | 'store_created'
  | 'store_approved'
  | 'store_rejected'
  | 'store_new_order'
  | 'store_first_sale'
  | 'store_withdrawal_requested'
  | 'store_withdrawal_paid'
  | 'store_withdrawal_rejected'
  | 'store_payout_failed'
  | 'store_suspended'
  | 'store_profit_digest';

type SmsEventMeta = {
  key: SmsEvent;
  label: string;
  description: string;
  placeholders: string[];
  sample: Record<string, string>;
  // Whether the SMS is currently wired and firing automatically in production.
  active: boolean;
};

const SMS_EVENTS: SmsEventMeta[] = [
  {
    key: 'store_created',
    label: 'Store submitted (in-app only)',
    description: 'Deprecated as SMS. Owners now see a bell notification when they submit a store; no SMS is sent for this event.',
    placeholders: ['store_name', 'slug'],
    sample: { store_name: 'Kofi Data Hub', slug: 'kofi-data-hub' },
    active: false,
  },
  {
    key: 'store_approved',
    label: 'Store approved',
    description: 'Sent when an admin approves the store and it goes live. Includes the public storefront URL.',
    placeholders: ['store_name', 'slug'],
    sample: { store_name: 'Kofi Data Hub', slug: 'kofi-data-hub' },
    active: true,
  },
  {
    key: 'store_rejected',
    label: 'Store rejected',
    description: 'Sent when an admin rejects a pending store. The reason suffix shows when the admin provides one.',
    placeholders: ['store_name', 'slug', 'reason', 'reason_suffix'],
    sample: { store_name: 'Kofi Data Hub', slug: 'kofi-data-hub', reason: 'Missing business details', reason_suffix: ' Reason: Missing business details.' },
    active: true,
  },
  {
    key: 'store_suspended',
    label: 'Store suspended',
    description: 'Sent when an admin suspends an active store.',
    placeholders: ['store_name', 'reason', 'reason_suffix'],
    sample: { store_name: 'Kofi Data Hub', reason: 'Policy violation', reason_suffix: ' Reason: Policy violation.' },
    active: true,
  },
  {
    key: 'store_new_order',
    label: 'New order received (in-app only)',
    description: 'Deprecated as SMS. Per-order notifications are now in-app only to prevent SMS fatigue. Owners receive a daily profit digest SMS instead.',
    placeholders: ['store_name', 'short_id', 'amount', 'profit'],
    sample: { store_name: 'Kofi Data Hub', short_id: 'A1B2C3', amount: '12.00', profit: '2.50' },
    active: false,
  },
  {
    key: 'store_first_sale',
    label: 'First sale (congrats)',
    description: 'Sent automatically the very first time a store receives a paid order. This is the only per-order SMS the owner receives.',
    placeholders: ['store_name', 'short_id', 'amount'],
    sample: { store_name: 'Kofi Data Hub', short_id: 'A1B2C3', amount: '12.00' },
    active: true,
  },
  {
    key: 'store_profit_digest',
    label: 'Daily profit digest',
    description: 'Replaces the per-order "profit available" SMS. Sent once a day (19:00 Africa/Accra) summarising the day\'s unlocked profit. Per-order profit unlocks are surfaced as in-app notifications instead.',
    placeholders: ['daily_profit', 'order_count', 'available_total'],
    sample: { daily_profit: '12.40', order_count: '5', available_total: '78.20' },
    active: true,
  },
  {
    key: 'store_withdrawal_requested',
    label: 'Withdrawal requested',
    description: 'Sent when the owner submits a withdrawal request.',
    placeholders: ['amount', 'momo_number'],
    sample: { amount: '50.00', momo_number: '0241234567' },
    active: true,
  },
  {
    key: 'store_withdrawal_paid',
    label: 'Withdrawal paid',
    description: 'Sent when an admin marks the withdrawal as paid. The Ref suffix only shows when a Paystack reference exists.',
    placeholders: ['amount', 'momo_number', 'paystack_reference', 'paystack_reference_suffix'],
    sample: { amount: '50.00', momo_number: '0241234567', paystack_reference: 'TRF_xyz123', paystack_reference_suffix: 'Ref: TRF_xyz123. ' },
    active: true,
  },
  {
    key: 'store_withdrawal_rejected',
    label: 'Withdrawal rejected',
    description: 'Sent when an admin rejects a pending withdrawal. Funds are returned to the available balance automatically.',
    placeholders: ['amount', 'momo_number', 'reason', 'reason_suffix'],
    sample: { amount: '50.00', momo_number: '0241234567', reason: 'Mismatched MoMo name', reason_suffix: ' Reason: Mismatched MoMo name.' },
    active: true,
  },
  {
    key: 'store_payout_failed',
    label: 'Payout failed',
    description: 'Sent when a payout attempt to MoMo could not be completed and the owner should retry.',
    placeholders: ['amount', 'momo_number', 'reason', 'reason_suffix'],
    sample: { amount: '50.00', momo_number: '0241234567', reason: 'Invalid recipient', reason_suffix: ' Reason: Invalid recipient.' },
    active: true,
  },
];

const DEFAULT_TEMPLATES: Record<SmsEvent, string> = {
  store_created: "Store {store_name} submitted for review. Approval usually within 24h. You'll get an SMS once it's live.",
  store_approved: 'Store {store_name} is live. Share your link: buy-data360.com/s/{slug}. Manage products and orders in My Store.',
  store_rejected: "Store {store_name} wasn't approved.{reason_suffix} Update your details in My Store and resubmit for review.",
  store_suspended: 'Your store {store_name} has been temporarily suspended.{reason_suffix} Contact support or review details in My Store.',
  store_new_order: 'New sale on {store_name}. Order {short_id} - GHS {amount}. GHS {profit} profit unlocks after delivery. View in My Store.',
  store_first_sale: 'Congratulations! {store_name} just received its first sale (Order {short_id}, GHS {amount}). Keep sharing your link to grow.',
  store_profit_digest: 'Today GHS {daily_profit} profit became available from {order_count} delivered order(s). Available balance: GHS {available_total}.',
  store_withdrawal_requested: "Withdrawal of GHS {amount} to {momo_number} received. Typically paid within 24h on business days. You'll get an SMS on payout.",
  store_withdrawal_paid: 'GHS {amount} paid to MoMo {momo_number}. {paystack_reference_suffix}Check your phone for the MoMo confirmation.',
  store_withdrawal_rejected: 'Your withdrawal of GHS {amount} was not approved.{reason_suffix} Funds returned to your available balance.',
  store_payout_failed: 'We could not complete your payout of GHS {amount} to {momo_number}. Please verify your MoMo details and try again from My Store.',
};

function renderPreview(template: string, data: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k) => (data[k] ?? ''))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// GSM-7 single-segment is 160 chars; concatenated parts are 153 chars each.
// If any non-GSM character is present (rare here), switch to UCS-2: 70 / 67.
const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåÆæßÉ!"#%&'()*+,\-./:;<=>?_\n\r¡¿§ÄÖÑÜäöñüà^{}\\[\]~|€]*$/;
function smsSegments(msg: string): { segments: number; perSegment: number; encoding: 'GSM-7' | 'UCS-2' } {
  if (!msg) return { segments: 0, perSegment: 160, encoding: 'GSM-7' };
  const gsm = GSM7.test(msg);
  const perSingle = gsm ? 160 : 70;
  const perConcat = gsm ? 153 : 67;
  if (msg.length <= perSingle) return { segments: 1, perSegment: perSingle, encoding: gsm ? 'GSM-7' : 'UCS-2' };
  return { segments: Math.ceil(msg.length / perConcat), perSegment: perConcat, encoding: gsm ? 'GSM-7' : 'UCS-2' };
}

function SmsTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Record<SmsEvent, string>>({} as any);
  const [original, setOriginal] = useState<Record<SmsEvent, string>>({} as any);
  const [updatedAt, setUpdatedAt] = useState<Record<SmsEvent, string | null>>({} as any);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SmsEvent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const keys = SMS_EVENTS.map(e => `store_sms_template_${e.key}`);
    const { data } = await supabase.from('platform_settings').select('key, value, updated_at').in('key', keys);
    const map: any = {};
    const ts: any = {};
    SMS_EVENTS.forEach(e => {
      const row = data?.find(r => r.key === `store_sms_template_${e.key}`);
      map[e.key] = (row?.value as string | undefined) ?? DEFAULT_TEMPLATES[e.key];
      ts[e.key] = (row as any)?.updated_at ?? null;
    });
    setTemplates(map);
    setOriginal(map);
    setUpdatedAt(ts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (ev: SmsEvent) => {
    setSaving(ev);
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: `store_sms_template_${ev}`, value: templates[ev] }, { onConflict: 'key' });
    setSaving(null);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    setOriginal(o => ({ ...o, [ev]: templates[ev] }));
    setUpdatedAt(u => ({ ...u, [ev]: new Date().toISOString() }));
    toast({ title: 'Template saved', description: 'New wording will apply to future SMS.' });
  };

  const reset = (ev: SmsEvent) => setTemplates(t => ({ ...t, [ev]: DEFAULT_TEMPLATES[ev] }));

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  const allVariables = Array.from(new Set(SMS_EVENTS.flatMap(e => e.placeholders))).sort();

  return (
    <div className="space-y-4 mt-4">
      <Card className="p-4 bg-muted/40">
        <h3 className="text-sm font-semibold mb-1">Store owner SMS</h3>
        <p className="text-xs text-muted-foreground">
          These are the only SMS sent to store owners. Buyers in stores receive no SMS at all.
          Use <code className="px-1 rounded bg-background">{'{placeholder}'}</code> tokens — they are replaced from each event's real data at send time.
          Aim to keep messages within one segment (160 GSM-7 characters) to avoid double billing.
        </p>
      </Card>

      <Card className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Variable reference</div>
        <div className="flex flex-wrap gap-1.5">
          {allVariables.map(v => (
            <span key={v} className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
              {'{' + v + '}'}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Tip: <code className="px-1 rounded bg-muted">{'{reason_suffix}'}</code> and <code className="px-1 rounded bg-muted">{'{paystack_reference_suffix}'}</code> already include their own leading space and trailing punctuation, so write them inline without extra spaces.
        </p>
      </Card>

      {SMS_EVENTS.map(ev => {
        const value = templates[ev.key] ?? '';
        const preview = renderPreview(value, ev.sample);
        const dirty = value !== original[ev.key];
        const len = preview.length;
        const seg = smsSegments(preview);
        const overOne = seg.segments > 1;
        const segColor = seg.segments <= 1 ? 'text-muted-foreground' : seg.segments === 2 ? 'text-amber-600' : 'text-destructive';
        const lastSaved = updatedAt[ev.key];
        return (
          <Card key={ev.key} className="p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold">{ev.label}</h4>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${ev.active ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                    {ev.active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{ev.key}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{ev.description}</p>
                {lastSaved && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Last modified {format(new Date(lastSaved), 'MMM d, yyyy • HH:mm')}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {ev.placeholders.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setTemplates(t => ({ ...t, [ev.key]: (t[ev.key] || '') + `{${p}}` }))}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    {'{' + p + '}'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                  <span>Template</span>
                  <span className="font-mono">{value.length} chars</span>
                </div>
                <Textarea
                  value={value}
                  onChange={e => setTemplates(t => ({ ...t, [ev.key]: e.target.value }))}
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between gap-2">
                  <span>Live preview (sample data)</span>
                  <span className={`font-mono ${segColor}`}>
                    {len} chars • {seg.segments} segment{seg.segments === 1 ? '' : 's'} • {seg.encoding}
                  </span>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 text-sm min-h-[96px] whitespace-pre-wrap">
                  {preview || <span className="text-muted-foreground italic">Empty template</span>}
                </div>
                {overOne && (
                  <p className="text-[11px] text-amber-600">
                    Preview exceeds one SMS segment — this message will be billed as {seg.segments} parts.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => reset(ev.key)} disabled={value === DEFAULT_TEMPLATES[ev.key]}>
                Reset to default
              </Button>
              <Button size="sm" onClick={() => save(ev.key)} disabled={!dirty || saving === ev.key}>
                {saving === ev.key ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving</> : 'Save'}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

