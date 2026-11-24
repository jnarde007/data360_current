import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { StatusBadge } from '@/components/StatusBadge';
import { formatGHS } from '@/lib/mock-data';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Search, CreditCard, UserCog, Users, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { DateFilter, filterByDate, type DatePreset } from '@/components/DateFilter';
import { Pagination } from '@/components/Pagination';
import { MobileCard } from '@/components/MobileCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';
import { motion } from 'framer-motion';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

interface TopupRow {
  id: string; short_id: string; customer_id: string; customer_name: string;
  customer_phone: string; customer_email: string; amount: number; method: string;
  network: string; momo_number: string; status: string; created_at: string;
}

interface ManualCreditRow {
  id: string; customer_id: string; customer_name: string; customer_phone: string;
  customer_email: string; amount: number; description: string; admin_name: string;
  reference: string; created_at: string;
}

interface GuestRow {
  id: string; reference: string; buyer_phone: string; buyer_email: string;
  amount: number; status: string; order_short_id: string; network: string;
  recipient_phone: string; created_at: string;
}

const ROWS_PER_PAGE = 15;

export default function AdminTopupsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [topups, setTopups] = useState<TopupRow[]>([]);
  const [manualCredits, setManualCredits] = useState<ManualCreditRow[]>([]);
  const [guestPayments, setGuestPayments] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customDate, setCustomDate] = useState<Date>();
  const [paystackPage, setPaystackPage] = useState(1);
  const [manualPage, setManualPage] = useState(1);
  const [guestPage, setGuestPage] = useState(1);
  const [detailTopup, setDetailTopup] = useState<TopupRow | null>(null);
  const [detailManual, setDetailManual] = useState<ManualCreditRow | null>(null);
  const [detailGuest, setDetailGuest] = useState<GuestRow | null>(null);

  const filteredTopups = filterByDate(
    topups.filter(t => {
      const q = search.toLowerCase();
      return !q || t.short_id.toLowerCase().includes(q) || t.customer_name.toLowerCase().includes(q) || t.customer_email.toLowerCase().includes(q);
    }),
    t => t.created_at, datePreset, customDate
  );

  const filteredManual = filterByDate(
    manualCredits.filter(t => {
      const q = search.toLowerCase();
      return !q || t.customer_name.toLowerCase().includes(q) || t.customer_email.toLowerCase().includes(q) || t.admin_name.toLowerCase().includes(q);
    }),
    t => t.created_at, datePreset, customDate
  );

  const filteredGuest = filterByDate(
    guestPayments.filter(t => {
      const q = search.toLowerCase();
      return !q || t.reference.toLowerCase().includes(q) || t.buyer_phone.toLowerCase().includes(q) || t.buyer_email.toLowerCase().includes(q) || t.order_short_id.toLowerCase().includes(q);
    }),
    t => t.created_at, datePreset, customDate
  );

  const paystackTotalPages = Math.max(1, Math.ceil(filteredTopups.length / ROWS_PER_PAGE));
  const paginatedTopups = filteredTopups.slice((paystackPage - 1) * ROWS_PER_PAGE, paystackPage * ROWS_PER_PAGE);
  const manualTotalPages = Math.max(1, Math.ceil(filteredManual.length / ROWS_PER_PAGE));
  const paginatedManual = filteredManual.slice((manualPage - 1) * ROWS_PER_PAGE, manualPage * ROWS_PER_PAGE);
  const guestTotalPages = Math.max(1, Math.ceil(filteredGuest.length / ROWS_PER_PAGE));
  const paginatedGuest = filteredGuest.slice((guestPage - 1) * ROWS_PER_PAGE, guestPage * ROWS_PER_PAGE);

  // Totals (only successful for Paystack & Guest; manual credits are always credited)
  const paystackTotal = filteredTopups.filter(t => t.status === 'success' || t.status === 'completed' || t.status === 'delivered').reduce((s, t) => s + t.amount, 0);
  const manualTotal = filteredManual.reduce((s, t) => s + t.amount, 0);
  const guestTotal = filteredGuest.filter(t => t.status === 'completed' || t.status === 'success').reduce((s, t) => s + t.amount, 0);
  const grandTotal = paystackTotal + manualTotal + guestTotal;

  const loadTopups = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('topups')
        .select('id, short_id, amount, method, network, momo_number, status, customer_id, created_at, customers(full_name, phone, email)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTopups((data || []).map((t: any) => ({
        id: t.id, short_id: t.short_id || t.id.slice(0, 8), customer_id: t.customer_id,
        customer_name: t.customers?.full_name || 'Unknown', customer_phone: t.customers?.phone || '',
        customer_email: t.customers?.email || '', amount: Number(t.amount), method: t.method,
        network: t.network, momo_number: t.momo_number, status: t.status, created_at: t.created_at,
      })));
    } catch {
      toast({ title: 'Unable to load topups', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadManualCredits = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('id, customer_id, amount, description, reference, admin_id, created_at, customers(full_name, phone, email), admin_users(name)')
        .eq('type', 'credit')
        .not('admin_id', 'is', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setManualCredits((data || []).map((t: any) => ({
        id: t.id, customer_id: t.customer_id, customer_name: t.customers?.full_name || 'Unknown',
        customer_phone: t.customers?.phone || '', customer_email: t.customers?.email || '',
        amount: Number(t.amount), description: t.description, admin_name: t.admin_users?.name || 'Admin',
        reference: t.reference, created_at: t.created_at,
      })));
    } catch {
      toast({ title: 'Unable to load manual credits', description: 'Please refresh the page and try again.', variant: 'destructive' });
    }
  }, [toast]);

  const loadGuestPayments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('payment_attempts')
        .select('id, paystack_reference, amount, status, buyer_phone, buyer_email, order_id, created_at')
        .eq('buyer_type', 'guest')
        .eq('attempt_type', 'data_direct')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;

      const orderIds = (data || []).map((d: any) => d.order_id).filter(Boolean);
      const orderMap = new Map<string, any>();
      if (orderIds.length) {
        const { data: orderRows } = await supabase
          .from('orders')
          .select('id, short_id, network, recipient_phone')
          .in('id', orderIds);
        (orderRows || []).forEach((o: any) => orderMap.set(o.id, o));
      }

      setGuestPayments((data || []).map((t: any) => {
        const o = t.order_id ? orderMap.get(t.order_id) : null;
        return {
          id: t.id,
          reference: t.paystack_reference || '',
          buyer_phone: t.buyer_phone || '',
          buyer_email: t.buyer_email || '',
          amount: Number(t.amount),
          status: t.status,
          order_short_id: o?.short_id || '—',
          network: o?.network || '—',
          recipient_phone: o?.recipient_phone || '',
          created_at: t.created_at,
        };
      }));
    } catch {
      toast({ title: 'Unable to load guest payments', description: 'Please refresh the page and try again.', variant: 'destructive' });
    }
  }, [toast]);

  const loadAll = useCallback(() => { loadTopups(); loadManualCredits(); loadGuestPayments(); }, [loadTopups, loadManualCredits, loadGuestPayments]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { setPaystackPage(1); setManualPage(1); setGuestPage(1); }, [search, datePreset, customDate]);

  useRealtimeRefresh(['topups', 'wallet_transactions', 'payment_attempts'], loadAll, 'admin-topups-live');

  const getTopupDetailFields = (t: TopupRow): DetailField[] => [
    { label: 'ID', value: <span className="font-mono">{t.short_id}</span> },
    { label: 'Customer', value: t.customer_name },
    { label: 'Email', value: t.customer_email || '—' },
    { label: 'Phone', value: t.customer_phone || '—' },
    { label: 'Amount', value: <span className="font-semibold">{formatGHS(t.amount)}</span> },
    { label: 'Method', value: t.method },
    { label: 'Network', value: t.network },
    { label: 'MoMo Number', value: t.momo_number },
    { label: 'Status', value: <StatusBadge status={t.status as any} /> },
    { label: 'Date', value: new Date(t.created_at).toLocaleString() },
  ];

  const getManualDetailFields = (t: ManualCreditRow): DetailField[] => [
    { label: 'Customer', value: t.customer_name },
    { label: 'Email', value: t.customer_email || '—' },
    { label: 'Phone', value: t.customer_phone || '—' },
    { label: 'Amount', value: <span className="font-semibold">{formatGHS(t.amount)}</span> },
    { label: 'By Admin', value: t.admin_name },
    { label: 'Reason', value: t.description },
    { label: 'Reference', value: <span className="font-mono text-xs">{t.reference}</span> },
    { label: 'Date', value: new Date(t.created_at).toLocaleString() },
  ];

  const getGuestDetailFields = (t: GuestRow): DetailField[] => [
    { label: 'Order ID', value: <span className="font-mono">{t.order_short_id}</span> },
    { label: 'Buyer Phone', value: t.buyer_phone || '—' },
    { label: 'Buyer Email', value: t.buyer_email || '—' },
    { label: 'Amount', value: <span className="font-semibold">{formatGHS(t.amount)}</span> },
    { label: 'Network', value: t.network },
    { label: 'Recipient', value: t.recipient_phone || '—' },
    { label: 'Status', value: <StatusBadge status={t.status as any} /> },
    { label: 'Paystack Ref', value: <span className="font-mono text-xs">{t.reference}</span> },
    { label: 'Date', value: new Date(t.created_at).toLocaleString() },
  ];

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Topup Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">Wallet topups, manual admin credits, and direct guest buyer payments</p>
        </motion.div>

        {/* Breakdown totals */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.03 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CreditCard className="w-3.5 h-3.5" /> Paystack</div>
            <div className="mt-1 text-base sm:text-lg font-semibold text-foreground">{formatGHS(paystackTotal)}</div>
          </div>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserCog className="w-3.5 h-3.5" /> Admin (Manual)</div>
            <div className="mt-1 text-base sm:text-lg font-semibold text-foreground">{formatGHS(manualTotal)}</div>
          </div>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="w-3.5 h-3.5" /> Guest Buyers</div>
            <div className="mt-1 text-base sm:text-lg font-semibold text-foreground">{formatGHS(guestTotal)}</div>
          </div>
          <div className="glass-card p-3 sm:p-4 border-primary/30">
            <div className="text-xs text-muted-foreground">Total Inflow</div>
            <div className="mt-1 text-base sm:text-lg font-bold text-primary">{formatGHS(grandTotal)}</div>
          </div>
        </motion.div>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Filters</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="glass-card p-3 sm:p-4 space-y-3 card-shine">
            <DateFilter datePreset={datePreset} customDate={customDate} onPresetChange={setDatePreset} onCustomDateChange={setCustomDate} />
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by ID, customer, email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
          </motion.div>
        </section>

        <Tabs defaultValue="paystack" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="paystack" className="gap-1.5 flex-1 sm:flex-none">
              <CreditCard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Paystack</span> ({filteredTopups.length})
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1.5 flex-1 sm:flex-none">
              <UserCog className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Admin</span> ({filteredManual.length})
            </TabsTrigger>
            <TabsTrigger value="guest" className="gap-1.5 flex-1 sm:flex-none">
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Guest Buyers</span> ({filteredGuest.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paystack">
            {isMobile ? (
              <div className="space-y-3">
                {paginatedTopups.length === 0 && <p className="text-center text-muted-foreground py-8">No Paystack topups</p>}
                {paginatedTopups.map(t => (
                  <MobileCard key={t.id} fields={[
                    { label: 'ID', value: <span className="font-mono text-xs text-primary">{t.short_id}</span> },
                    { label: 'Customer', value: <span className="font-medium">{t.customer_name}</span> },
                    { label: 'Amount', value: <span className="font-semibold">{formatGHS(t.amount)}</span> },
                    { label: 'Status', value: <StatusBadge status={t.status as any} /> },
                    { label: 'Date', value: <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</span> },
                  ]} action={
                    <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailTopup(t)}>
                      <Eye className="w-3.5 h-3.5" /> View Details
                    </Button>
                  } />
                ))}
                <Pagination currentPage={paystackPage} totalPages={paystackTotalPages} onPageChange={setPaystackPage} totalItems={filteredTopups.length} label="topups" />
              </div>
            ) : (
              <div className="glass-card glow-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-4 font-medium text-muted-foreground">ID</th>
                      <th className="p-4 font-medium text-muted-foreground">Customer</th>
                      <th className="p-4 font-medium text-muted-foreground">Amount</th>
                      <th className="p-4 font-medium text-muted-foreground">Status</th>
                      <th className="p-4 font-medium text-muted-foreground">Date</th>
                      <th className="p-4 font-medium text-muted-foreground">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTopups.map(t => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-4 font-mono text-xs text-primary">{t.short_id}</td>
                        <td className="p-4 font-medium text-foreground">{t.customer_name}</td>
                        <td className="p-4 font-semibold text-foreground">{formatGHS(t.amount)}</td>
                        <td className="p-4"><StatusBadge status={t.status as any} /></td>
                        <td className="p-4 text-muted-foreground text-xs whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="p-4">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailTopup(t)}>
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredTopups.length === 0 && <p className="text-center text-muted-foreground py-8">No Paystack topups</p>}
                <Pagination currentPage={paystackPage} totalPages={paystackTotalPages} onPageChange={setPaystackPage} totalItems={filteredTopups.length} label="topups" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual">
            {isMobile ? (
              <div className="space-y-3">
                {paginatedManual.length === 0 && <p className="text-center text-muted-foreground py-8">No manual credits yet</p>}
                {paginatedManual.map(t => (
                  <MobileCard key={t.id} fields={[
                    { label: 'Customer', value: <span className="font-medium">{t.customer_name}</span> },
                    { label: 'Amount', value: <span className="font-semibold">{formatGHS(t.amount)}</span> },
                    { label: 'By Admin', value: <span className="text-xs">{t.admin_name}</span> },
                    { label: 'Date', value: <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</span> },
                  ]} action={
                    <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailManual(t)}>
                      <Eye className="w-3.5 h-3.5" /> View Details
                    </Button>
                  } />
                ))}
                <Pagination currentPage={manualPage} totalPages={manualTotalPages} onPageChange={setManualPage} totalItems={filteredManual.length} label="credits" />
              </div>
            ) : (
              <div className="glass-card glow-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-4 font-medium text-muted-foreground">Date</th>
                      <th className="p-4 font-medium text-muted-foreground">Customer</th>
                      <th className="p-4 font-medium text-muted-foreground">Amount</th>
                      <th className="p-4 font-medium text-muted-foreground">By Admin</th>
                      <th className="p-4 font-medium text-muted-foreground">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedManual.map(t => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="p-4 font-medium text-foreground">{t.customer_name}</td>
                        <td className="p-4 font-semibold text-foreground">{formatGHS(t.amount)}</td>
                        <td className="p-4 text-xs text-muted-foreground">{t.admin_name}</td>
                        <td className="p-4">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailManual(t)}>
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredManual.length === 0 && <p className="text-center text-muted-foreground py-8">No manual credits yet</p>}
                <Pagination currentPage={manualPage} totalPages={manualTotalPages} onPageChange={setManualPage} totalItems={filteredManual.length} label="credits" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="guest">
            {isMobile ? (
              <div className="space-y-3">
                {paginatedGuest.length === 0 && <p className="text-center text-muted-foreground py-8">No guest buyer payments</p>}
                {paginatedGuest.map(t => (
                  <MobileCard key={t.id} fields={[
                    { label: 'Order', value: <span className="font-mono text-xs text-primary">{t.order_short_id}</span> },
                    { label: 'Buyer', value: <span className="font-medium">{t.buyer_phone || t.buyer_email || '—'}</span> },
                    { label: 'Amount', value: <span className="font-semibold">{formatGHS(t.amount)}</span> },
                    { label: 'Network', value: <span className="text-xs">{t.network}</span> },
                    { label: 'Status', value: <StatusBadge status={t.status as any} /> },
                    { label: 'Date', value: <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</span> },
                  ]} action={
                    <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailGuest(t)}>
                      <Eye className="w-3.5 h-3.5" /> View Details
                    </Button>
                  } />
                ))}
                <Pagination currentPage={guestPage} totalPages={guestTotalPages} onPageChange={setGuestPage} totalItems={filteredGuest.length} label="payments" />
              </div>
            ) : (
              <div className="glass-card glow-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-4 font-medium text-muted-foreground">Order</th>
                      <th className="p-4 font-medium text-muted-foreground">Buyer</th>
                      <th className="p-4 font-medium text-muted-foreground">Network</th>
                      <th className="p-4 font-medium text-muted-foreground">Amount</th>
                      <th className="p-4 font-medium text-muted-foreground">Status</th>
                      <th className="p-4 font-medium text-muted-foreground">Date</th>
                      <th className="p-4 font-medium text-muted-foreground">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedGuest.map(t => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-4 font-mono text-xs text-primary">{t.order_short_id}</td>
                        <td className="p-4 text-foreground text-xs">{t.buyer_phone || t.buyer_email || '—'}</td>
                        <td className="p-4 text-xs">{t.network}</td>
                        <td className="p-4 font-semibold text-foreground">{formatGHS(t.amount)}</td>
                        <td className="p-4"><StatusBadge status={t.status as any} /></td>
                        <td className="p-4 text-muted-foreground text-xs whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="p-4">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailGuest(t)}>
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredGuest.length === 0 && <p className="text-center text-muted-foreground py-8">No guest buyer payments</p>}
                <Pagination currentPage={guestPage} totalPages={guestTotalPages} onPageChange={setGuestPage} totalItems={filteredGuest.length} label="payments" />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Detail Dialogs */}
      <DetailViewDialog
        open={!!detailTopup}
        onOpenChange={open => { if (!open) setDetailTopup(null); }}
        title="Topup Details"
        subtitle="Complete information about this topup"
        fields={detailTopup ? getTopupDetailFields(detailTopup) : []}
      />
      <DetailViewDialog
        open={!!detailManual}
        onOpenChange={open => { if (!open) setDetailManual(null); }}
        title="Manual Credit Details"
        subtitle="Complete information about this credit"
        fields={detailManual ? getManualDetailFields(detailManual) : []}
      />
      <DetailViewDialog
        open={!!detailGuest}
        onOpenChange={open => { if (!open) setDetailGuest(null); }}
        title="Guest Buyer Payment"
        subtitle="Direct Paystack payment from a guest buyer"
        fields={detailGuest ? getGuestDetailFields(detailGuest) : []}
      />
    </AdminLayout>
  );
}
