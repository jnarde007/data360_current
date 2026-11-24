import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { StatusBadge } from '@/components/StatusBadge';
import { OrderInspector } from '@/components/admin/OrderInspector';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatGHS } from '@/lib/mock-data';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Search, Loader2, Eye, Copy, Check,
  Clock, Cog, CheckCircle, XCircle, AlertTriangle, Timer, MoreHorizontal, Zap
} from 'lucide-react';
import { BuyerTypeBadge, FulfillmentModeBadge } from '@/components/admin/AdminBadges';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Pagination } from '@/components/Pagination';
import { MobileCard } from '@/components/MobileCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

// Actionable (non-terminal) statuses that belong in the fulfillment queue
const QUEUE_STATUSES = [
  'pending', 'pending_confirmation', 'pending_manual',
  'awaiting_manual_fulfillment', 'processing', 'submitted', 'failed',
];

const QUEUE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Actionable' },
  { value: 'awaiting_manual_fulfillment', label: 'Awaiting Manual' },
  { value: 'pending_manual', label: 'Pending Manual' },
  { value: 'pending', label: 'Pending' },
  { value: 'pending_confirmation', label: 'Pending Confirmation' },
  { value: 'processing', label: 'Processing' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'failed', label: 'Failed' },
];

const BUYER_TYPE_OPTIONS = [
  { value: 'all', label: 'All Buyers' },
  { value: 'registered', label: 'Registered' },
  { value: 'guest', label: 'Guest' },
  { value: 'affiliate', label: 'Affiliate' },
];

const FULFILLMENT_OPTIONS = [
  { value: 'all', label: 'All Modes' },
  { value: 'manual', label: 'Manual' },
  { value: 'api', label: 'API' },
];

interface QueueOrder {
  id: string;
  short_id: string;
  customer_name: string;
  customer_id: string | null;
  network: string;
  bundle_size: string;
  recipient_phone: string;
  quantity: number;
  total_amount: number;
  status: string;
  created_at: string;
  delivery_mode: string;
  buyer_type: string;
  buyer_phone: string;
  buyer_email: string;
  affiliate_code: string;
  payment_method: string;
}

type AgeBucket = 'fresh' | 'aging' | 'overdue';

function getAgeBucket(createdAt: string): AgeBucket {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const mins = ageMs / 60000;
  if (mins < 10) return 'fresh';
  if (mins < 30) return 'aging';
  return 'overdue';
}

function formatAge(createdAt: string): string {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

const ageBucketConfig: Record<AgeBucket, { label: string; className: string; icon: typeof Clock }> = {
  fresh: { label: 'Fresh', className: 'text-success bg-success/10 border-success/20', icon: Clock },
  aging: { label: 'Aging', className: 'text-warning bg-warning/10 border-warning/20', icon: Timer },
  overdue: { label: 'Overdue', className: 'text-destructive bg-destructive/10 border-destructive/20', icon: AlertTriangle },
};

const AgeBadge = ({ createdAt }: { createdAt: string }) => {
  const bucket = getAgeBucket(createdAt);
  const config = ageBucketConfig[bucket];
  const Icon = config.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-[9px] gap-0.5 ${config.className}`}>
          <Icon className="w-2.5 h-2.5" /> {formatAge(createdAt)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {config.label} — created {new Date(createdAt).toLocaleString()}
      </TooltipContent>
    </Tooltip>
  );
};

const CopyablePhone = ({ phone }: { phone: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  if (!phone) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 font-mono text-xs text-foreground hover:text-primary transition-colors group cursor-pointer">
      {phone}
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
    </button>
  );
};

/* BuyerTypeBadge imported from AdminBadges */

const ROWS_PER_PAGE = 20;

export default function AdminFulfillmentQueuePage() {
  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [buyerTypeFilter, setBuyerTypeFilter] = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [inspectOrderId, setInspectOrderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const loadOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, short_id, customer_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, delivery_mode, buyer_type, buyer_phone, buyer_email, affiliate_code, payment_method, customers(full_name)')
        .in('status', QUEUE_STATUSES)
        .order('created_at', { ascending: true }); // oldest first for queue priority
      if (error) throw error;
      setOrders((data || []).map((o: any) => ({
        id: o.id,
        short_id: o.short_id || o.id.slice(0, 8),
        customer_id: o.customer_id || null,
        customer_name: o.customers?.full_name || (o.buyer_type === 'guest' ? (o.buyer_phone || 'Guest') : 'Unknown'),
        network: o.network,
        bundle_size: o.bundle_size,
        recipient_phone: o.recipient_phone,
        quantity: o.quantity,
        total_amount: Number(o.total_amount),
        status: o.status,
        created_at: o.created_at,
        delivery_mode: o.delivery_mode || 'manual',
        buyer_type: o.buyer_type || 'registered',
        buyer_phone: o.buyer_phone || '',
        buyer_email: o.buyer_email || '',
        affiliate_code: o.affiliate_code || '',
        payment_method: o.payment_method || 'wallet',
      })));
    } catch {
      toast({ title: 'Unable to load queue', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, buyerTypeFilter, fulfillmentFilter]);
  useRealtimeRefresh(['orders'], loadOrders, 'admin-queue-live');

  const updateStatus = async (id: string, status: string) => {
    try {
      const previousOrder = orders.find(o => o.id === id);
      const { error } = await supabase.from('orders').update({ status }).eq('id', id);
      if (error) throw error;
      // Remove from queue if terminal
      if (['delivered', 'rejected', 'refunded', 'cancelled', 'customer_cancelled', 'cancelled_before_processing'].includes(status)) {
        setOrders(prev => prev.filter(o => o.id !== id));
      } else {
        setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
      }
      toast({ title: 'Status updated', description: `Marked as ${status}`, variant: 'success' });
      if (status === 'delivered' && previousOrder?.status !== 'delivered') {
        supabase.functions.invoke('order-webhook', {
          body: { event: 'delivered', status: 'delivered', localOrderId: previousOrder.id, previousStatus: previousOrder.status },
        }).catch(() => {});
      }
    } catch {
      toast({ title: 'Update failed', variant: 'destructive' });
    }
  };

  const rejectOrder = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('reject-order', { body: { order_id: id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setOrders(prev => prev.filter(o => o.id !== id));
      const refundMethod = data?.refund_method === 'paystack' ? 'Paystack refund initiated' : 'wallet refunded';
      toast({ title: 'Order rejected', description: `Order rejected & ${refundMethod}.`, variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Rejection failed', description: err?.message, variant: 'destructive' });
    }
  };

  const sendToApi = async (id: string) => {
    const order = orders.find(o => o.id === id);
    toast({ title: 'Sending to API…', description: `Submitting ${order?.short_id || 'order'} to provider` });
    try {
      // Reset to a claimable status so deliver-order can pick it up
      if (order && order.status !== 'pending' && order.status !== 'pending_confirmation') {
        await supabase.from('orders').update({ status: 'pending' }).eq('id', id);
      }
      const { data, error } = await supabase.functions.invoke('deliver-order', { body: { order_id: id, admin_send: true } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.mode === 'manual') {
        toast({
          title: 'API not enabled',
          description: `${order?.network} API is currently disabled — order stayed manual.`,
          variant: 'destructive',
        });
      } else if (data?.success === false) {
        toast({ title: 'Provider rejected', description: data?.error || 'API error', variant: 'destructive' });
      } else {
        toast({ title: 'Sent to API', description: `Provider: ${data?.provider || 'OK'}`, variant: 'success' });
      }
      loadOrders();
    } catch (err: any) {
      toast({ title: 'Send to API failed', description: err?.message, variant: 'destructive' });
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmBulkSend = () => {
    if (selected.size === 0) return;
    setConfirmBulkOpen(true);
  };

  const executeBulkSend = async () => {
    setConfirmBulkOpen(false);
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkRunning(true);
    toast({ title: `Sending ${ids.length} order${ids.length > 1 ? 's' : ''} to API…`, description: 'Submitting in parallel' });
    let ok = 0, manual = 0, failed = 0;
    // Concurrency cap to avoid hammering provider
    const CONCURRENCY = 4;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const order = orders.find(o => o.id === id);
        try {
          if (order && order.status !== 'pending' && order.status !== 'pending_confirmation') {
            await supabase.from('orders').update({ status: 'pending' }).eq('id', id);
          }
          const { data, error } = await supabase.functions.invoke('deliver-order', { body: { order_id: id, admin_send: true } });
          if (error || data?.error) { failed++; continue; }
          if (data?.mode === 'manual') manual++;
          else if (data?.success === false) failed++;
          else ok++;
        } catch { failed++; }
      }
    });
    await Promise.all(workers);
    setSelected(new Set());
    setBulkRunning(false);
    loadOrders();
    toast({
      title: 'Bulk send complete',
      description: `Sent: ${ok} · API disabled: ${manual} · Failed: ${failed}`,
      variant: failed > 0 ? 'destructive' : 'success',
    });
  };

  const filtered = orders.filter(o => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      o.short_id.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q) ||
      o.recipient_phone.includes(q) ||
      o.buyer_phone.includes(q) ||
      o.buyer_email.toLowerCase().includes(q) ||
      o.affiliate_code.toLowerCase().includes(q) ||
      o.network.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchesBuyer =
      buyerTypeFilter === 'all' ||
      (buyerTypeFilter === 'registered' && o.buyer_type === 'registered') ||
      (buyerTypeFilter === 'guest' && o.buyer_type === 'guest') ||
      (buyerTypeFilter === 'affiliate' && o.affiliate_code !== '');
    const matchesFulfillment = fulfillmentFilter === 'all' || o.delivery_mode === fulfillmentFilter;
    return matchesSearch && matchesStatus && matchesBuyer && matchesFulfillment;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  // Summary stats
  const manualCount = orders.filter(o => o.delivery_mode === 'manual').length;
  const guestCount = orders.filter(o => o.buyer_type === 'guest').length;
  const overdueCount = orders.filter(o => getAgeBucket(o.created_at) === 'overdue').length;
  const failedCount = orders.filter(o => o.status === 'failed').length;

  const StatPill = ({ label, count, active, onClick }: { label: string; count: number; active?: boolean; onClick?: () => void }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
        active
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-muted/50 text-muted-foreground border-border/50 hover:bg-muted'
      }`}
    >
      {label} <span className="font-bold ml-1">{count}</span>
    </button>
  );

  const QuickActions = ({ o }: { o: QueueOrder }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setInspectOrderId(o.id)}>
          <Eye className="w-4 h-4 mr-2" /> Inspect
        </DropdownMenuItem>
        {o.delivery_mode === 'manual' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => sendToApi(o.id)}>
              <Zap className="w-4 h-4 mr-2 text-primary" /> Send to API now
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {o.status !== 'processing' && (
          <DropdownMenuItem onClick={() => updateStatus(o.id, 'processing')}>
            <Cog className="w-4 h-4 mr-2" /> Mark Processing
          </DropdownMenuItem>
        )}
        {o.status !== 'delivered' && (
          <DropdownMenuItem onClick={() => updateStatus(o.id, 'delivered')}>
            <CheckCircle className="w-4 h-4 mr-2" /> Mark Delivered
          </DropdownMenuItem>
        )}
        {o.status !== 'failed' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => updateStatus(o.id, 'failed')}>
              <XCircle className="w-4 h-4 mr-2" /> Mark Failed
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => rejectOrder(o.id)}>
          <XCircle className="w-4 h-4 mr-2" /> Reject & Refund
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(`/admin/payment-recovery`)}>
          Payment Recovery
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Fulfillment Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Orders needing action — sorted oldest first</p>
        </motion.div>

        {/* Summary pills */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.03 }}
          className="flex flex-wrap gap-2">
          <StatPill label="Total" count={orders.length} />
          <StatPill label="Manual" count={manualCount} active={fulfillmentFilter === 'manual'} onClick={() => setFulfillmentFilter(f => f === 'manual' ? 'all' : 'manual')} />
          <StatPill label="Guest" count={guestCount} active={buyerTypeFilter === 'guest'} onClick={() => setBuyerTypeFilter(f => f === 'guest' ? 'all' : 'guest')} />
          <StatPill label="Overdue" count={overdueCount} />
          <StatPill label="Failed" count={failedCount} active={statusFilter === 'failed'} onClick={() => setStatusFilter(f => f === 'failed' ? 'all' : 'failed')} />
        </motion.div>

        {/* Filters */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
          className="glass-card p-3 sm:p-4 space-y-3 card-shine">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="ID, phone, email, affiliate..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUEUE_FILTER_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={buyerTypeFilter} onValueChange={setBuyerTypeFilter}>
              <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUYER_TYPE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fulfillmentFilter} onValueChange={setFulfillmentFilter}>
              <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FULFILLMENT_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* Queue content */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}>
          {(() => {
            const manualOnPage = paginated.filter(o => o.delivery_mode === 'manual');
            const allManualSelected = manualOnPage.length > 0 && manualOnPage.every(o => selected.has(o.id));
            const someManualSelected = manualOnPage.some(o => selected.has(o.id)) && !allManualSelected;
            const toggleAllOnPage = () => {
              setSelected(prev => {
                const next = new Set(prev);
                if (allManualSelected) manualOnPage.forEach(o => next.delete(o.id));
                else manualOnPage.forEach(o => next.add(o.id));
                return next;
              });
            };
            return (
              <div className="flex items-center justify-between gap-3 px-1 pb-2 flex-wrap">
                <p className="text-sm text-primary font-medium">{filtered.length} order{filtered.length !== 1 ? 's' : ''} in queue</p>
                <div className="flex items-center gap-2">
                  {manualOnPage.length > 0 && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                      <Checkbox
                        checked={allManualSelected ? true : (someManualSelected ? 'indeterminate' : false)}
                        onCheckedChange={toggleAllOnPage}
                      />
                      Select all manual on page
                    </label>
                  )}
                  {selected.size > 0 && (
                    <>
                      <Badge variant="outline" className="text-xs">{selected.size} selected</Badge>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())} disabled={bulkRunning}>
                        Clear
                      </Button>
                      <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={confirmBulkSend} disabled={bulkRunning}>
                        {bulkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        Send {selected.size} to API
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {isMobile ? (
            <div className="space-y-2">
              {paginated.length === 0 && <p className="text-center text-muted-foreground py-8">Queue is empty 🎉</p>}
              {paginated.map(o => (
                <MobileCard
                  key={o.id}
                  fields={[
                    { label: 'Order', value: <button onClick={() => setInspectOrderId(o.id)} className="font-mono text-xs text-primary hover:underline">{o.short_id}</button> },
                    { label: 'Placed', value: <span className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> },
                    { label: 'Age', value: <AgeBadge createdAt={o.created_at} /> },
                    { label: 'Buyer', value: <BuyerTypeBadge buyerType={o.buyer_type} affiliateCode={o.affiliate_code} /> },
                    { label: 'Recipient', value: <CopyablePhone phone={o.recipient_phone} /> },
                    { label: 'Bundle', value: `${o.network} · ${o.bundle_size}` },
                    { label: 'Amount', value: <span className="font-semibold">{formatGHS(o.total_amount)}</span> },
                    { label: 'Status', value: <StatusBadge status={o.status} /> },
                    { label: 'Mode', value: <FulfillmentModeBadge mode={o.delivery_mode} /> },
                  ]}
                  action={
                    <div className="flex items-center gap-2">
                      {o.delivery_mode === 'manual' && (
                        <Checkbox
                          checked={selected.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          aria-label="Select for bulk API send"
                        />
                      )}
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs flex-1" onClick={() => setInspectOrderId(o.id)}>
                        <Eye className="w-3.5 h-3.5" /> Inspect
                      </Button>
                      <QuickActions o={o} />
                    </div>
                  }
                />
              ))}
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="orders" />
            </div>
          ) : (
            <div className="glass-card glow-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-3 w-8"></th>
                      <th className="p-3 font-medium text-muted-foreground">Age</th>
                      <th className="p-3 font-medium text-muted-foreground">Placed</th>
                      <th className="p-3 font-medium text-muted-foreground">ID</th>
                      <th className="p-3 font-medium text-muted-foreground">Buyer</th>
                      <th className="p-3 font-medium text-muted-foreground">Recipient</th>
                      <th className="p-3 font-medium text-muted-foreground">Bundle</th>
                      <th className="p-3 font-medium text-muted-foreground">Amount</th>
                      <th className="p-3 font-medium text-muted-foreground">Pay</th>
                      <th className="p-3 font-medium text-muted-foreground">Mode</th>
                      <th className="p-3 font-medium text-muted-foreground">Status</th>
                      <th className="p-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(o => {
                      const bucket = getAgeBucket(o.created_at);
                      const rowHighlight = bucket === 'overdue' ? 'bg-destructive/[0.03]' : bucket === 'aging' ? 'bg-warning/[0.02]' : '';
                      return (
                        <tr key={o.id} className={`border-b border-border/50 hover:bg-muted/40 transition-colors ${rowHighlight}`}>
                          <td className="p-3">
                            {o.delivery_mode === 'manual' ? (
                              <Checkbox
                                checked={selected.has(o.id)}
                                onCheckedChange={() => toggleSelect(o.id)}
                                aria-label="Select for bulk API send"
                              />
                            ) : null}
                          </td>
                          <td className="p-3"><AgeBadge createdAt={o.created_at} /></td>
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                            <div className="leading-tight">
                              <span>{new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                              <br />
                              <span className="text-muted-foreground/70">{new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <button onClick={() => setInspectOrderId(o.id)} className="font-mono text-xs text-primary hover:underline cursor-pointer">
                              {o.short_id}
                            </button>
                          </td>
                          <td className="p-3">
                            <div className="space-y-0.5">
                              <BuyerTypeBadge buyerType={o.buyer_type} affiliateCode={o.affiliate_code} />
                              <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                                {o.customer_name}
                              </div>
                            </div>
                          </td>
                          <td className="p-3"><CopyablePhone phone={o.recipient_phone} /></td>
                          <td className="p-3 text-foreground whitespace-nowrap">{o.network} · {o.bundle_size}</td>
                          <td className="p-3 font-semibold text-foreground whitespace-nowrap">{formatGHS(o.total_amount)}</td>
                          <td className="p-3 text-xs text-muted-foreground capitalize">{o.payment_method}</td>
                          <td className="p-3">
                            <FulfillmentModeBadge mode={o.delivery_mode} />
                          </td>
                          <td className="p-3"><StatusBadge status={o.status} /></td>
                          <td className="p-3">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInspectOrderId(o.id)}>
                                <Eye className="w-4 h-4 text-muted-foreground" />
                              </Button>
                              <QuickActions o={o} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircle className="w-8 h-8 text-success mx-auto mb-2" />
                  <p className="text-muted-foreground">Queue is empty — all caught up!</p>
                </div>
              )}
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="orders" />
            </div>
          )}
        </motion.div>
      </div>

      <OrderInspector
        orderId={inspectOrderId}
        open={!!inspectOrderId}
        onOpenChange={open => { if (!open) setInspectOrderId(null); }}
      />

      <ConfirmDialog
        open={confirmBulkOpen}
        onOpenChange={setConfirmBulkOpen}
        title={`Send ${selected.size} order${selected.size !== 1 ? 's' : ''} to API?`}
        description={
          <span>
            You are about to submit {selected.size} manual order{selected.size !== 1 ? 's' : ''} to the provider API immediately.
            <br /><br />
            This will process them in parallel. Are you sure?
          </span>
        }
        confirmLabel="Send to API"
        onConfirm={executeBulkSend}
        loading={bulkRunning}
      />
    </AdminLayout>
  );
}
