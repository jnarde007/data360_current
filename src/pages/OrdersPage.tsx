import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { StatusBadge } from '@/components/StatusBadge';
import { OrderCountdown } from '@/components/OrderCountdown';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { formatGHS } from '@/lib/mock-data';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ShoppingCart, Search, Loader2, Wallet2, LifeBuoy } from 'lucide-react';
import { DetailViewDialog } from '@/components/DetailViewDialog';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DateFilter, filterByDate, type DatePreset } from '@/components/DateFilter';
import { Pagination } from '@/components/Pagination';
import { MobileCard } from '@/components/MobileCard';
import { getNetworkAccent, getNetworkStripe, formatPhoneSpaced } from '@/lib/network-colors';
import mtnLogo from '@/assets/mtn-logo.png';
import atLogo from '@/assets/at-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';

const networkLogos: Record<string, string> = { MTN: mtnLogo, AirtelTigo: atLogo, Telecel: telecelLogo };
import { useIsMobile } from '@/hooks/use-mobile';
import { countOperationalOrders, countDeliveredOrders, totalSpent as calcTotalSpent, isFailed } from '@/lib/order-metrics';
import { CheckCircle, Clock, AlertTriangle, BarChart3 } from 'lucide-react';
import { buildRefundEvidence, deriveCustomerStatus, EMPTY_REFUND_EVIDENCE, type RefundEvidence } from '@/lib/order-resolution';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

interface OrderRow {
  id: string; short_id: string; network: string; bundle_size: string;
  recipient_phone: string; quantity: number; total_amount: number;
  status: string; created_at: string; grace_period_ends_at: string | null;
  payment_method: string;
  provider_name: string;
}

export default function OrdersPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [networkFilter, setNetworkFilter] = useState('all');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDate, setCustomDate] = useState<Date>();
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null);
  const [refundEvidence, setRefundEvidence] = useState<Record<string, RefundEvidence>>({});
  const [reportIssueOrder, setReportIssueOrder] = useState<OrderRow | null>(null);
  const deepLinkedRef = useRef(false);

  const loadOrders = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.from('orders').select('id, short_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, grace_period_ends_at, delivery_mode, provider_name, provider_order_id, provider_reference, buyer_type, buyer_phone, buyer_email, payment_method, payment_reference, customer_id, affiliate_code, tracking_token, payment_verified_at, linked_customer_id').eq('customer_id', user.id).order('created_at', { ascending: false });
      if (error) throw error;
      const rows = ((data || []) as unknown) as OrderRow[];
      setOrders(rows);

      // Refund evidence — a "failed" order is only "Refunded" when the refund
      // ledger (or a legacy wallet credit) actually confirms the money returned.
      const [{ data: refunds }, { data: credits }] = await Promise.all([
        supabase.from('refunds')
          .select('order_id, status, refund_method, refund_amount, total_refunded, completed_at, created_at')
          .eq('customer_id', user.id),
        supabase.from('wallet_transactions')
          .select('amount, reference, created_at')
          .eq('customer_id', user.id).eq('type', 'credit'),
      ]);
      const refundByOrder = new Map((refunds || []).map(r => [r.order_id as string, r]));
      const creditByRef = new Map((credits || [])
        .filter(c => (c.reference || '').startsWith('REF-'))
        .map(c => [c.reference as string, c]));
      const map: Record<string, RefundEvidence> = {};
      for (const o of rows) {
        map[o.id] = buildRefundEvidence(
          refundByOrder.get(o.id) as never,
          (creditByRef.get(`REF-${o.short_id}`) as never) || null,
        );
      }
      setRefundEvidence(map);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [user?.id]);

  const statusViewFor = useCallback(
    (o: { id: string; status: string }) => deriveCustomerStatus(o, refundEvidence[o.id] || EMPTY_REFUND_EVIDENCE),
    [refundEvidence],
  );

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useRealtimeRefresh(['orders'], loadOrders, 'customer-orders-live');

  // Deep-link: auto-open order detail from ?order= param
  useEffect(() => {
    if (deepLinkedRef.current || loading || orders.length === 0) return;
    const orderParam = searchParams.get('order');
    if (!orderParam) return;
    const match = orders.find(o => o.id === orderParam || o.short_id === orderParam);
    if (match) {
      deepLinkedRef.current = true;
      setDetailOrder(match);
      setDatePreset('all');
      setSearchParams({}, { replace: true });
    }
  }, [orders, loading, searchParams]);

  const filtered = useMemo(() => {
    return filterByDate(
      orders.filter(o => {
        const matchStatus = statusFilter === 'all' || o.status === statusFilter;
        const q = search.toLowerCase();
        const matchSearch = !q || o.short_id.toLowerCase().includes(q) || o.recipient_phone.includes(q) || o.network.toLowerCase().includes(q);
        const matchNetwork = networkFilter === 'all' || o.network.toLowerCase() === networkFilter.toLowerCase();
        return matchStatus && matchSearch && matchNetwork;
      }),
      o => o.created_at, datePreset, customDate
    );
  }, [orders, statusFilter, networkFilter, search, datePreset, customDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleReset = () => {
    setSearch(''); setStatusFilter('all'); setNetworkFilter('all'); setRowsPerPage(10); setCurrentPage(1); setDatePreset('all'); setCustomDate(undefined);
  };

  const handleCancelled = async () => { await refreshUser(); await loadOrders(); };

  if (loading) {
    return <CustomerLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></CustomerLayout>;
  }

  return (
    <CustomerLayout>
      <div className="space-y-6 sm:space-y-8 pb-24 lg:pb-0">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">My Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Track all your data bundle orders</p>
        </motion.div>

        {/* Stats */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Summary</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
            {[
              { label: 'Total Orders', value: countOperationalOrders(orders), icon: <BarChart3 className="w-4 h-4" />, accent: 'icon-box-primary', border: 'border-t-primary/40' },
              { label: 'Delivered', value: countDeliveredOrders(orders), icon: <CheckCircle className="w-4 h-4" />, accent: 'icon-box-success', border: 'border-t-success/40' },
              { label: 'Pending', value: orders.filter(o => ['pending','pending_confirmation','processing','pending_manual','submitted','awaiting_manual_fulfillment'].includes(o.status)).length, icon: <Clock className="w-4 h-4" />, accent: 'icon-box-amber', border: 'border-t-amber/40' },
              { label: 'Failed', value: orders.filter(o => isFailed(o.status)).length, icon: <AlertTriangle className="w-4 h-4" />, accent: 'icon-box-destructive', border: 'border-t-destructive/40' },
              { label: 'Total Spent', value: formatGHS(calcTotalSpent(orders)), icon: <Wallet2 className="w-4 h-4" />, accent: 'icon-box-teal', border: 'border-t-teal/40' },
            ].map(s => (
              <div key={s.label} className={`glass-card p-3.5 sm:p-4 card-hover card-shine border-l-[3px] ${s.border.replace('border-t-', 'border-l-')}`}>
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground/70">{s.label}</p>
                  <div className={`icon-box icon-box-sm ${s.accent}`}>{s.icon}</div>
                </div>
                <p className="text-xl sm:text-2xl font-display font-bold text-foreground whitespace-nowrap">{s.value}</p>
              </div>
            ))}
          </motion.div>
        </section>

        {orders.length === 0 ? (
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}
            className="glass-card glow-border p-12 text-center max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-5">
              <ShoppingCart className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-display font-semibold text-foreground mb-2">No orders yet</h3>
            <p className="text-sm text-muted-foreground mb-5">When you purchase a data bundle, your orders will appear here.</p>
            <Button onClick={() => navigate('/buy-data')} className="gradient-primary text-primary-foreground border-0">Buy Data Now</Button>
          </motion.div>
        ) : (
          <>
            {/* Filters */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Order History</h2>
                <div className="flex-1 h-px bg-border/60" />
              </div>
              <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}
                className="glass-card p-3 sm:p-4 space-y-3 card-shine">
              <DateFilter datePreset={datePreset} customDate={customDate} onPresetChange={p => { setDatePreset(p); setCurrentPage(1); }} onCustomDateChange={d => { setCustomDate(d); setCurrentPage(1); }} />
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search by ID or phone..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="pl-10" />
                </div>
                <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
                  <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}>
                    <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending_confirmation">Awaiting</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="delivered">Delivered</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="customer_cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={networkFilter} onValueChange={v => { setNetworkFilter(v); setCurrentPage(1); }}>
                    <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Networks</SelectItem>
                      <SelectItem value="MTN">MTN</SelectItem>
                      <SelectItem value="AirtelTigo">AirtelTigo</SelectItem>
                      <SelectItem value="Telecel">Telecel</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={String(rowsPerPage)} onValueChange={v => { setRowsPerPage(Number(v)); setCurrentPage(1); }}>
                    <SelectTrigger className="w-full sm:w-[90px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 / page</SelectItem>
                      <SelectItem value="10">10 / page</SelectItem>
                      <SelectItem value="20">20 / page</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={handleReset} className="shrink-0 h-10">Reset</Button>
                </div>
              </div>
              </motion.div>

            {/* Content */}
            <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.15 }}
              className="mt-4 sm:mt-5 space-y-2.5">
              <p className="text-sm text-muted-foreground px-1">Showing {filtered.length} order{filtered.length !== 1 ? 's' : ''}</p>

              {isMobile ? (
                <div className="space-y-2">
                  {paginated.length === 0 && <p className="text-center text-muted-foreground py-12">No orders match your filters</p>}
                  {paginated.map(o => (
                    <div key={o.id} className={`relative overflow-hidden py-3 pl-4 pr-3 rounded-2xl border border-border/60 bg-card shadow-sm cursor-pointer transition-all hover:-translate-y-[1px] hover:shadow-md active:scale-[0.99] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${getNetworkStripe(o.network)}`} onClick={() => setDetailOrder(o)}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl ${getNetworkAccent(o.network).iconBg} flex items-center justify-center shrink-0`}>
                          {networkLogos[o.network]
                            ? <img src={networkLogos[o.network]} alt={o.network} className="w-6 h-6 rounded-lg object-cover" />
                            : <ShoppingCart className="w-4 h-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-semibold text-foreground truncate">{o.network} · {o.bundle_size}</p>
                          <p className="text-xs font-mono tracking-wide text-muted-foreground">{formatPhoneSpaced(o.recipient_phone)}</p>
                          <p className="text-[10px] text-muted-foreground/70">
                            {o.short_id} · {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="text-right shrink-0 space-y-1 flex flex-col items-end">
                          <p className="text-sm font-display font-bold text-foreground tabular-nums">{formatGHS(Number(o.total_amount))}</p>
                          <StatusBadge status={statusViewFor(o).badgeStatus} />
                          <button type="button" aria-label="Report an issue" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); setReportIssueOrder(o); }}>
                            <LifeBuoy className="w-3 h-3" /> Report
                          </button>
                        </div>
                      </div>
                       {statusViewFor(o).key === 'being_resolved' && (
                         <div className="mt-2 rounded-xl bg-amber/10 border border-amber/25 p-2.5">
                           <p className="text-[11px] leading-relaxed text-foreground">{statusViewFor(o).message}</p>
                         </div>
                       )}
                       {o.status === 'pending_confirmation' && o.grace_period_ends_at && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <OrderCountdown orderId={o.id} customerId={user!.id} gracePeriodEndsAt={o.grace_period_ends_at} shortId={o.short_id} onCancelled={handleCancelled} showHelper allowProceedNow onProceeded={handleCancelled} />
                        </div>
                      )}
                    </div>
                  ))}
                  <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="orders" />
                </div>
              ) : (
                <div className="glass-card glow-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Date</TableHead>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Order ID</TableHead>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Network</TableHead>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Bundle</TableHead>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Phone</TableHead>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Amount</TableHead>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Status</TableHead>
                          <TableHead className="text-muted-foreground font-medium whitespace-nowrap">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginated.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-12">No orders match your filters</TableCell></TableRow>
                        ) : (
                          paginated.map(o => (
                            <TableRow key={o.id} className="hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => setDetailOrder(o)}>
                              <TableCell className="text-foreground">
                                <div className="leading-tight">
                                  <span className="whitespace-nowrap">{new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                  <br />
                                  <span className="text-muted-foreground text-xs">{new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                </div>
                              </TableCell>
                              <TableCell><span className="font-mono text-xs text-foreground">{o.short_id}</span></TableCell>
                              <TableCell className="text-foreground">
                                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                  {networkLogos[o.network] && <img src={networkLogos[o.network]} alt="" className="w-5 h-5 rounded-md object-cover" />}
                                  {o.network}
                                </span>
                              </TableCell>
                              <TableCell className="text-foreground">{o.bundle_size}</TableCell>
                              <TableCell className="font-mono text-sm tracking-wide text-foreground whitespace-nowrap">{formatPhoneSpaced(o.recipient_phone)}</TableCell>
                              <TableCell className="text-foreground font-semibold whitespace-nowrap">{formatGHS(Number(o.total_amount))}</TableCell>
                              <TableCell><StatusBadge status={statusViewFor(o).badgeStatus} /></TableCell>
                              <TableCell onClick={e => e.stopPropagation()}>
                                {o.status === 'pending_confirmation' && o.grace_period_ends_at ? (
                                  <OrderCountdown orderId={o.id} customerId={user!.id} gracePeriodEndsAt={o.grace_period_ends_at} shortId={o.short_id} onCancelled={handleCancelled} allowProceedNow onProceeded={handleCancelled} />
                                ) : (
                                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setReportIssueOrder(o)}>
                                    <LifeBuoy className="w-3.5 h-3.5" />
                                    Report
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="orders" />
                </div>
              )}
            </motion.div>
            </section>
          </>
        )}
        {/* Detail Dialog */}
        <DetailViewDialog
          open={!!detailOrder}
          onOpenChange={() => setDetailOrder(null)}
          title="Order Details"
          subtitle={detailOrder?.short_id}
          hero={detailOrder ? {
            network: detailOrder.network,
            logo: networkLogos[detailOrder.network],
            heading: `${detailOrder.network} ${detailOrder.bundle_size}`,
            caption: formatPhoneSpaced(detailOrder.recipient_phone),
            amount: formatGHS(Number(detailOrder.total_amount)),
            status: <StatusBadge status={statusViewFor(detailOrder).badgeStatus} />,
          } : undefined}
          fields={detailOrder ? [
            { label: 'Date', value: new Date(detailOrder.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' • ' + new Date(detailOrder.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
            { label: 'Bundle', value: detailOrder.bundle_size },
            ...(detailOrder.quantity > 1 ? [{ label: 'Quantity', value: String(detailOrder.quantity) }] : []),
            { label: 'Recipient', value: <span className="font-mono tracking-wide">{formatPhoneSpaced(detailOrder.recipient_phone)}</span> },
            { label: 'Payment', value: detailOrder.payment_method?.includes('paystack')
                ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success/15 text-success">Paystack</span>
                : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary/15 text-primary">Wallet</span> },
            ...(statusViewFor(detailOrder).message ? [{
              label: 'What this means',
              value: (
                <div className={`rounded-xl p-3 text-xs leading-relaxed ${
                  statusViewFor(detailOrder).tone === 'resolving'
                    ? 'bg-amber/10 border border-amber/25 text-foreground'
                    : 'bg-muted/50 border border-border/50 text-foreground'
                }`}>
                  {statusViewFor(detailOrder).message}
                </div>
              ),
            }] : []),
            ...(refundEvidence[detailOrder.id]?.confirmed ? [
              { label: 'Refund Amount', value: formatGHS(Number(refundEvidence[detailOrder.id].amount || detailOrder.total_amount)) },
              { label: 'Refund Destination', value: refundEvidence[detailOrder.id].method === 'paystack' ? 'Original payment method' : 'DATA360 wallet' },
              ...(refundEvidence[detailOrder.id].at ? [{
                label: 'Refunded On',
                value: new Date(refundEvidence[detailOrder.id].at as string).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
              }] : []),
            ] : []),
          ] : []}
          onReportIssue={() => {
            const o = detailOrder;
            if (o) {
              setDetailOrder(null);
              setReportIssueOrder(o);
            }
          }}
        />
        {reportIssueOrder && (
          <CreateTicketDialog
            open={!!reportIssueOrder}
            onOpenChange={(v) => { if (!v) setReportIssueOrder(null); }}
            defaultCategory={
              isFailed(reportIssueOrder.status) ? 'Order failed'
              : reportIssueOrder.status === 'customer_cancelled' || reportIssueOrder.status === 'cancelled_before_processing' ? 'Order failed'
              : 'Order delayed'
            }
            relatedOrderId={reportIssueOrder.id}
            relatedOrderShortId={reportIssueOrder.short_id}
          />
        )}
      </div>
    </CustomerLayout>
  );
}
