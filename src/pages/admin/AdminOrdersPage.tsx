import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { StatusBadge } from '@/components/StatusBadge';
import { OrderInspector } from '@/components/admin/OrderInspector';
import { formatGHS } from '@/lib/mock-data';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2, MoreHorizontal, Clock, Cog, CheckCircle, XCircle, Eye, Copy, Check, Zap, RotateCw } from 'lucide-react';
import { BuyerTypeBadge, FulfillmentModeBadge, StoreBadge } from '@/components/admin/AdminBadges';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { DateFilter, filterByDate, type DatePreset } from '@/components/DateFilter';
import { Pagination } from '@/components/Pagination';
import { MobileCard } from '@/components/MobileCard';
import { isTerminal } from '@/lib/order-metrics';
import { useIsMobile } from '@/hooks/use-mobile';
import { motion } from 'framer-motion';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

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
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 font-mono text-xs text-foreground hover:text-primary transition-colors group cursor-pointer">
      {phone}
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
    </button>
  );
};

/* BuyerTypeBadge + FulfillmentModeBadge imported from AdminBadges */

interface OrderRow {
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
  provider_name: string;
  provider_order_id: string;
  provider_reference: string;
  buyer_type: string;
  buyer_phone: string;
  buyer_email: string;
  affiliate_code: string;
  payment_method: string;
  payment_reference: string;
  store_name?: string | null;
  store_slug?: string | null;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'pending_confirmation', label: 'Pending Confirmation' },
  { value: 'pending_manual', label: 'Pending Manual' },
  { value: 'awaiting_manual_fulfillment', label: 'Awaiting Manual' },
  { value: 'processing', label: 'Processing' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'customer_cancelled', label: 'Customer Cancelled' },
  { value: 'cancelled_before_processing', label: 'Cancelled Before Processing' },
];

const BUYER_TYPE_OPTIONS = [
  { value: 'all', label: 'All Buyers' },
  { value: 'registered', label: 'Registered' },
  { value: 'guest', label: 'Guest' },
  { value: 'store', label: 'From Store' },
  { value: 'affiliate', label: 'Affiliate (any)' },
  { value: 'affiliate_guest', label: 'Affiliate Guest' },
];

const FULFILLMENT_OPTIONS = [
  { value: 'all', label: 'All Fulfillment' },
  { value: 'manual', label: 'Manual' },
  { value: 'api', label: 'API' },
];

const ROWS_PER_PAGE = 15;

export default function AdminOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || 'all';

  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDate, setCustomDate] = useState<Date>();
  const [networkFilter, setNetworkFilter] = useState('all');
  const [buyerTypeFilter, setBuyerTypeFilter] = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [inspectOrderId, setInspectOrderId] = useState<string | null>(null);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const deepLinkedRef = useRef(false);

  const loadOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, short_id, customer_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, delivery_mode, provider_name, provider_order_id, provider_reference, buyer_type, buyer_phone, buyer_email, affiliate_code, payment_method, payment_reference, customers(full_name), store_orders!order_id(store_id, stores(name, slug))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setOrders((data || []).map((o: any) => {
        const so = Array.isArray(o.store_orders) ? o.store_orders[0] : o.store_orders;
        const store = so?.stores;
        return ({
        id: o.id, short_id: o.short_id || o.id.slice(0, 8),
        customer_id: o.customer_id || null,
        customer_name: o.customers?.full_name || (o.buyer_type === 'guest' ? (o.buyer_phone || 'Guest') : 'Unknown'),
        network: o.network,
        bundle_size: o.bundle_size, recipient_phone: o.recipient_phone,
        quantity: o.quantity, total_amount: Number(o.total_amount),
        status: o.status, created_at: o.created_at,
        delivery_mode: o.delivery_mode || 'manual',
        provider_name: o.provider_name || '', provider_order_id: o.provider_order_id || '',
        provider_reference: o.provider_reference || '',
        buyer_type: o.buyer_type || 'registered',
        buyer_phone: o.buyer_phone || '',
        buyer_email: o.buyer_email || '',
        affiliate_code: o.affiliate_code || '',
        payment_method: o.payment_method || 'wallet',
        payment_reference: o.payment_reference || '',
        store_name: store?.name || null,
        store_slug: store?.slug || null,
      });
      }));
    } catch {
      toast({ title: 'Unable to load orders', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { setCurrentPage(1); }, [search, datePreset, customDate, statusFilter, networkFilter, buyerTypeFilter, fulfillmentFilter]);

  useRealtimeRefresh(['orders'], loadOrders, 'admin-orders-live');

  // Deep-link: auto-open order inspector from ?order= param
  useEffect(() => {
    if (deepLinkedRef.current || loading || orders.length === 0) return;
    const orderParam = searchParams.get('order');
    if (!orderParam) return;
    const match = orders.find(o => o.id === orderParam || o.short_id === orderParam);
    if (match) {
      deepLinkedRef.current = true;
      setInspectOrderId(match.id);
      setDatePreset('all');
      setSearchParams({}, { replace: true });
    }
  }, [orders, loading, searchParams]);

  const updateStatus = async (id: string, status: string) => {
    try {
      const previousOrder = orders.find(o => o.id === id);
      const { error } = await supabase.from('orders').update({ status }).eq('id', id);
      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
      toast({ title: 'Order status updated', description: `Order has been marked as ${status}.`, variant: 'success' });

      if (status === 'delivered' && previousOrder?.status !== 'delivered') {
        supabase.functions.invoke('order-webhook', {
          body: { event: 'delivered', status: 'delivered', localOrderId: previousOrder.id, reference: previousOrder.provider_reference || undefined, orderId: previousOrder.provider_order_id || undefined, previousStatus: previousOrder.status },
        }).catch(() => {});
      }
    } catch {
      toast({ title: 'Status update failed', description: 'Could not update the order status. Please try again.', variant: 'destructive' });
    }
  };

  const rejectOrder = async (id: string) => {
    try {
      const targetOrder = orders.find(o => o.id === id);
      const { data, error } = await supabase.functions.invoke('reject-order', {
        body: { order_id: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'rejected' } : o));
      const isGuest = targetOrder?.buyer_type === 'guest';
      toast({
        title: 'Order rejected',
        description: isGuest
          ? `Order rejected. Paystack refund ${data?.refund_method === 'paystack' ? 'initiated' : 'processed'} for guest buyer.`
          : 'The order has been rejected and the customer\'s wallet has been refunded.',
        variant: 'success',
      });
    } catch (err: any) {
      toast({ title: 'Rejection failed', description: err?.message || 'Could not reject this order. Please try again.', variant: 'destructive' });
    }
  };

  const sendToApi = async (id: string) => {
    const order = orders.find(o => o.id === id);
    toast({ title: 'Sending to API…', description: `Submitting ${order?.short_id || 'order'} to provider` });
    try {
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

  const filtered = filterByDate(
    orders.filter(o => {
      const q = search.toLowerCase();
      const matchesSearch = !q ||
        o.short_id.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.recipient_phone.includes(q) ||
        o.network.toLowerCase().includes(q) ||
        o.buyer_phone.toLowerCase().includes(q) ||
        o.buyer_email.toLowerCase().includes(q) ||
        o.affiliate_code.toLowerCase().includes(q) ||
        o.payment_reference.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
      const matchesNetwork = networkFilter === 'all' || o.network.toLowerCase() === networkFilter.toLowerCase();
      const matchesBuyerType =
        buyerTypeFilter === 'all' ||
        (buyerTypeFilter === 'registered' && o.buyer_type === 'registered') ||
        (buyerTypeFilter === 'guest' && o.buyer_type === 'guest') ||
        (buyerTypeFilter === 'store' && !!o.store_slug) ||
        (buyerTypeFilter === 'affiliate' && o.affiliate_code !== '') ||
        (buyerTypeFilter === 'affiliate_guest' && o.buyer_type === 'guest' && o.affiliate_code !== '');
      const matchesFulfillment = fulfillmentFilter === 'all' || o.delivery_mode === fulfillmentFilter;
      return matchesSearch && matchesStatus && matchesNetwork && matchesBuyerType && matchesFulfillment;
    }),
    o => o.created_at, datePreset, customDate
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  const hasActiveFilters = statusFilter !== 'all' || networkFilter !== 'all' || buyerTypeFilter !== 'all' || fulfillmentFilter !== 'all';

  const StatusActions = ({ o }: { o: OrderRow }) => {
    if (isTerminal(o.status)) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-7"><MoreHorizontal className="w-4 h-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {o.delivery_mode === 'manual' && o.status !== 'failed' && (
            <>
              <DropdownMenuItem onClick={() => sendToApi(o.id)}>
                <Zap className="w-4 h-4 mr-2 text-primary" /> Send to API now
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {o.status === 'failed' && (
            <>
              <DropdownMenuItem onClick={() => sendToApi(o.id)}>
                <RotateCw className="w-4 h-4 mr-2 text-primary" /> Retry send to API
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {o.status !== 'pending' && (
            <DropdownMenuItem onClick={() => updateStatus(o.id, 'pending')}>
              <Clock className="w-4 h-4 mr-2" /> Pending
            </DropdownMenuItem>
          )}
          {o.status !== 'processing' && (
            <DropdownMenuItem onClick={() => updateStatus(o.id, 'processing')}>
              <Cog className="w-4 h-4 mr-2" /> Processing
            </DropdownMenuItem>
          )}
          {o.status !== 'delivered' && (
            <DropdownMenuItem onClick={() => updateStatus(o.id, 'delivered')}>
              <CheckCircle className="w-4 h-4 mr-2" /> Delivered
            </DropdownMenuItem>
          )}
          {o.status !== 'failed' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => updateStatus(o.id, 'failed')}>
                <XCircle className="w-4 h-4 mr-2" /> Failed
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => rejectOrder(o.id)}>
            <XCircle className="w-4 h-4 mr-2" /> Reject & Refund
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

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
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and track all customer orders</p>
        </motion.div>

        {/* Filters */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Filters</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="glass-card p-3 sm:p-4 space-y-3 card-shine">
            <DateFilter datePreset={datePreset} customDate={customDate} onPresetChange={setDatePreset} onCustomDateChange={setCustomDate} />
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="ID, customer, phone, email, ref, affiliate..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={networkFilter} onValueChange={setNetworkFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="All Networks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Networks</SelectItem>
                  <SelectItem value="MTN">MTN</SelectItem>
                  <SelectItem value="AirtelTigo">AirtelTigo</SelectItem>
                  <SelectItem value="Telecel">Telecel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={buyerTypeFilter} onValueChange={setBuyerTypeFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All Buyers" />
                </SelectTrigger>
                <SelectContent>
                  {BUYER_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={fulfillmentFilter} onValueChange={setFulfillmentFilter}>
                <SelectTrigger className="w-full sm:w-[170px]">
                  <SelectValue placeholder="All Fulfillment" />
                </SelectTrigger>
                <SelectContent>
                  {FULFILLMENT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('all'); setNetworkFilter('all'); setBuyerTypeFilter('all'); setFulfillmentFilter('all'); }} className="text-xs">
                  Reset Filters
                </Button>
              )}
            </div>
          </motion.div>
        </section>

        {/* Content */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}>
          <div className="px-1 pb-2">
            <p className="text-sm text-primary font-medium">Showing {filtered.length} order{filtered.length !== 1 ? 's' : ''}</p>
          </div>

          {isMobile ? (
            <div className="space-y-2">
              {paginated.length === 0 && <p className="text-center text-muted-foreground py-8">No orders found</p>}
              {paginated.map(o => (
                <MobileCard
                  key={o.id}
                  fields={[
                     { label: 'Order ID', value: <button onClick={() => setInspectOrderId(o.id)} className="font-mono text-xs text-primary hover:underline">{o.short_id}</button> },
                     { label: 'Customer', value: <span className="font-medium">{o.customer_name}</span> },
                     { label: 'Buyer', value: <BuyerTypeBadge buyerType={o.buyer_type} affiliateCode={o.affiliate_code} storeSlug={o.store_slug} storeName={o.store_name} /> },
                     { label: 'Recipient', value: <CopyablePhone phone={o.recipient_phone} /> },
                     { label: 'Bundle', value: `${o.network} · ${o.bundle_size}` },
                     { label: 'Amount', value: <span className="font-semibold">{formatGHS(o.total_amount)}</span> },
                     { label: 'Status', value: <StatusBadge status={o.status} /> },
                     { label: 'Date', value: (
                       <div className="leading-tight">
                         <span className="text-xs text-foreground whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                         <br />
                         <span className="text-[10px] text-muted-foreground">{new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                       </div>
                     ) },
                  ]}
                  action={
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs flex-1" onClick={() => setInspectOrderId(o.id)}>
                        <Eye className="w-3.5 h-3.5" /> Inspect
                      </Button>
                      <StatusActions o={o} />
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
                      <th className="p-4 font-medium text-muted-foreground">ID</th>
                      <th className="p-4 font-medium text-muted-foreground">Date</th>
                      <th className="p-4 font-medium text-muted-foreground">Customer</th>
                      <th className="p-4 font-medium text-muted-foreground">Buyer</th>
                      <th className="p-4 font-medium text-muted-foreground">Recipient</th>
                      <th className="p-4 font-medium text-muted-foreground">Bundle</th>
                      <th className="p-4 font-medium text-muted-foreground">Total</th>
                      <th className="p-4 font-medium text-muted-foreground">Status</th>
                      <th className="p-4 font-medium text-muted-foreground">Mode</th>
                      <th className="p-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(o => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-4">
                          <button onClick={() => setInspectOrderId(o.id)} className="font-mono text-xs text-primary hover:underline cursor-pointer">
                            {o.short_id}
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="leading-tight">
                            <span className="text-foreground whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                            <br />
                            <span className="text-muted-foreground text-xs">{new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="font-medium text-foreground">{o.customer_name}</div>
                          {o.buyer_type === 'guest' && o.buyer_email && (
                            <div className="text-[10px] text-muted-foreground">{o.buyer_email}</div>
                          )}
                        </td>
                        <td className="p-4">
                          <BuyerTypeBadge buyerType={o.buyer_type} affiliateCode={o.affiliate_code} storeSlug={o.store_slug} storeName={o.store_name} />
                        </td>
                        <td className="p-4"><CopyablePhone phone={o.recipient_phone} /></td>
                        <td className="p-4 text-foreground">{o.network} · {o.bundle_size}</td>
                        <td className="p-4 font-semibold text-foreground whitespace-nowrap">{formatGHS(o.total_amount)}</td>
                        <td className="p-4"><StatusBadge status={o.status} /></td>
                        <td className="p-4">
                          <FulfillmentModeBadge mode={o.delivery_mode} />
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInspectOrderId(o.id)}>
                              <Eye className="w-4 h-4 text-muted-foreground" />
                            </Button>
                            <StatusActions o={o} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">No orders found</p>}
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
    </AdminLayout>
  );
}
