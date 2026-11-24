import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { NeedsAttentionPanel } from '@/components/admin/NeedsAttentionPanel';
import { OrderInspector } from '@/components/admin/OrderInspector';
import { formatGHS } from '@/lib/mock-data';
import {
  Users, CreditCard, ShoppingCart, Wallet, TrendingUp, Clock, Loader2, Package,
  XCircle, CheckCircle2, BarChart3, AlertTriangle, Store
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { TERMINAL_STATUS_FILTER } from '@/lib/order-metrics';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.adminRole === 'Super Admin';
  const [inspectOrderId, setInspectOrderId] = useState<string | null>(null);
  const [stats, setStats] = useState({
    todayTopupAmount: 0, todayTopupCount: 0,
    todayAdminTopupCount: 0, todayAdminTopupAmount: 0,
    todayWebTopupCount: 0, todayWebTopupAmount: 0,
    todayOrderAmount: 0, todayOrderCount: 0,
    lifetimeTopupAmount: 0, lifetimeTopupCount: 0,
    lifetimeAdminTopupCount: 0, lifetimeAdminTopupAmount: 0,
    lifetimeWebTopupCount: 0, lifetimeWebTopupAmount: 0,
    lifetimeOrderAmount: 0, lifetimeOrderCount: 0,
    totalBalance: 0, totalCustomers: 0,
    activeCustomers: 0, suspendedCustomers: 0,
    failedOrdersToday: 0, pendingOrdersStale: 0,
    todaySuccessRate: 0, todayDelivered: 0,
    storesTotal: 0, storesActive: 0, storesSuspended: 0,
    storeRevenueToday: 0, storeOrdersToday: 0,
    storeRevenueLifetime: 0, storeOrdersLifetime: 0,
    pendingWithdrawals: 0, pendingWithdrawalsAmount: 0,
  });
  const [recentTopups, setRecentTopups] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  // Needs Attention data
  const [attentionData, setAttentionData] = useState({ failedToday: 0, pendingStale: 0, unresolvedRecon: 0, staleItems: 0 });

  const loadDashboard = useCallback(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const EXCLUDED_STATUSES = TERMINAL_STATUS_FILTER;
      const [
        customersRes,
        topupsRes,
        ordersRes,
        todayPaystackTopupsRes,
        todayOrdersDataRes,
        allPaystackTopupsRes,
        allOrdersRes,
        todayManualCreditsRes,
        allManualCreditsRes,
        // Operational health
        failedTodayRes,
        pendingStaleRes,
        deliveredTodayRes,
        // Reconciliation quick count
        reconTopupsRes,
        // Stores marketplace
        storesRes,
        storeOrdersTodayRes,
        storeOrdersLifetimeRes,
        pendingWithdrawalsRes,
      ] = await Promise.all([
        supabase.from('customers').select('wallet_balance, status').not('status', 'in', '("deleted","archived")'),
        supabase.from('topups').select('id, short_id, amount, method, status, created_at, customers(full_name)').order('created_at', { ascending: false }).limit(5),
        supabase.from('orders').select('id, short_id, network, bundle_size, recipient_phone, total_amount, status, created_at, customers(full_name)').order('created_at', { ascending: false }).limit(5),
        supabase.from('topups').select('amount').eq('status', 'approved').neq('method', 'manual').gte('created_at', todayISO),
        supabase.from('orders').select('total_amount').gte('created_at', todayISO).not('status', 'in', EXCLUDED_STATUSES),
        supabase.from('topups').select('amount').eq('status', 'approved').neq('method', 'manual'),
        supabase.from('orders').select('total_amount').not('status', 'in', EXCLUDED_STATUSES),
        supabase.from('wallet_transactions').select('amount').eq('type', 'credit').not('admin_id', 'is', null).gte('created_at', todayISO),
        supabase.from('wallet_transactions').select('amount').eq('type', 'credit').not('admin_id', 'is', null),
        // Failed today
        supabase.from('orders').select('id').eq('status', 'failed').gte('created_at', todayISO),
        // Pending orders older than 5 min
        supabase.from('orders').select('id').in('status', ['pending', 'pending_confirmation', 'pending_manual']).lt('created_at', fiveMinAgo),
        // Delivered today
        supabase.from('orders').select('id').eq('status', 'delivered').gte('created_at', todayISO),
        // Quick recon check: approved topups without linked credits
        supabase.from('topups').select('id').eq('status', 'approved').is('customer_id', null),
        // Stores
        supabase.from('stores').select('id, status'),
        supabase.from('store_orders').select('amount_paid, profit').gte('created_at', todayISO).not('status', 'in', '("failed","refunded","cancelled","rejected")'),
        supabase.from('store_orders').select('amount_paid, profit').not('status', 'in', '("failed","refunded","cancelled","rejected")'),
        supabase.from('store_withdrawals').select('id, amount').in('status', ['pending', 'processing']),
      ]);

      const totalBalance = (customersRes.data || []).reduce((s, c) => s + Number(c.wallet_balance), 0);

      const aggregateAmount = (data: any[]) => ({
        count: data.length,
        amount: data.reduce((sum: number, row: any) => sum + Number(row.amount), 0),
      });

      const combineTopups = (paystackData: any[], manualData: any[]) => {
        const paystack = aggregateAmount(paystackData);
        const manual = aggregateAmount(manualData);
        return {
          adminCount: manual.count, adminAmount: manual.amount,
          webCount: paystack.count, webAmount: paystack.amount,
          totalAmount: manual.amount + paystack.amount,
          totalCount: manual.count + paystack.count,
        };
      };

      const todayTopups = combineTopups(todayPaystackTopupsRes.data || [], todayManualCreditsRes.data || []);
      const lifetimeTopups = combineTopups(allPaystackTopupsRes.data || [], allManualCreditsRes.data || []);
      const todayOrders = todayOrdersDataRes.data || [];
      const allOrders = allOrdersRes.data || [];
      const failedToday = (failedTodayRes.data || []).length;
      const pendingStale = (pendingStaleRes.data || []).length;
      const deliveredToday = (deliveredTodayRes.data || []).length;
      const totalOrdersToday = todayOrders.length;
      const successRate = totalOrdersToday > 0 ? Math.round((deliveredToday / totalOrdersToday) * 100) : 100;

      const storesData = storesRes.data || [];
      const storeOrdersToday = storeOrdersTodayRes.data || [];
      const storeOrdersLifetime = storeOrdersLifetimeRes.data || [];
      const pendingWithdrawals = pendingWithdrawalsRes.data || [];

      setStats({
        todayTopupAmount: todayTopups.totalAmount,
        todayTopupCount: todayTopups.totalCount,
        todayAdminTopupCount: todayTopups.adminCount, todayAdminTopupAmount: todayTopups.adminAmount,
        todayWebTopupCount: todayTopups.webCount, todayWebTopupAmount: todayTopups.webAmount,
        todayOrderAmount: todayOrders.reduce((s: number, o: any) => s + Number(o.total_amount), 0),
        todayOrderCount: totalOrdersToday,
        lifetimeTopupAmount: lifetimeTopups.totalAmount,
        lifetimeTopupCount: lifetimeTopups.totalCount,
        lifetimeAdminTopupCount: lifetimeTopups.adminCount, lifetimeAdminTopupAmount: lifetimeTopups.adminAmount,
        lifetimeWebTopupCount: lifetimeTopups.webCount, lifetimeWebTopupAmount: lifetimeTopups.webAmount,
        lifetimeOrderAmount: allOrders.reduce((s: number, o: any) => s + Number(o.total_amount), 0),
        lifetimeOrderCount: allOrders.length,
        totalBalance,
        totalCustomers: (customersRes.data || []).length,
        activeCustomers: (customersRes.data || []).filter((c: any) => c.status === 'active').length,
        suspendedCustomers: (customersRes.data || []).filter((c: any) => c.status === 'suspended').length,
        failedOrdersToday: failedToday,
        pendingOrdersStale: pendingStale,
        todaySuccessRate: successRate,
        todayDelivered: deliveredToday,
        storesTotal: storesData.length,
        storesActive: storesData.filter((s: any) => s.status === 'active').length,
        storesSuspended: storesData.filter((s: any) => s.status === 'suspended').length,
        storeRevenueToday: storeOrdersToday.reduce((s: number, o: any) => s + Number(o.amount_paid), 0),
        storeOrdersToday: storeOrdersToday.length,
        storeRevenueLifetime: storeOrdersLifetime.reduce((s: number, o: any) => s + Number(o.amount_paid), 0),
        storeOrdersLifetime: storeOrdersLifetime.length,
        pendingWithdrawals: pendingWithdrawals.length,
        pendingWithdrawalsAmount: pendingWithdrawals.reduce((s: number, w: any) => s + Number(w.amount), 0),
      });

      setAttentionData({
        failedToday,
        pendingStale,
        unresolvedRecon: (reconTopupsRes.data || []).length,
        staleItems: pendingStale,
      });

      setRecentTopups((topupsRes.data || []).map((t: any) => ({
        id: t.id, short_id: t.short_id || t.id.slice(0, 8), customer_name: t.customers?.full_name || 'Unknown',
        amount: Number(t.amount), method: t.method, status: t.status, created_at: t.created_at,
      })));

      setRecentOrders((ordersRes.data || []).map((o: any) => ({
        id: o.id, short_id: o.short_id || o.id.slice(0, 8), customer_name: o.customers?.full_name || 'Unknown',
        network: o.network, bundle_size: o.bundle_size, recipient_phone: o.recipient_phone,
        total_amount: Number(o.total_amount), status: o.status, created_at: o.created_at,
      })));
    } catch (e) {
      console.error('Dashboard load error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadDashboard(), 400);
    };
    const channel = supabase
      .channel('admin-dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders' }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_withdrawals' }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topups' }, debouncedRefresh)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [loadDashboard]);

  if (loading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="h-7 w-48 rounded-md bg-muted/60 animate-pulse" />
            <div className="h-3 w-64 rounded-md bg-muted/40 animate-pulse" />
          </div>
          {[0, 1, 2, 3].map(row => (
            <div key={row} className="space-y-3">
              <div className="h-3 w-36 rounded-md bg-muted/50 animate-pulse" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                {[0, 1, 2, 3].map(c => (
                  <div key={c} className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
                ))}
              </div>
            </div>
          ))}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map(c => <div key={c} className="h-72 rounded-2xl bg-muted/30 animate-pulse" />)}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-5 lg:space-y-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-xs lg:text-sm text-muted-foreground mt-0.5 lg:mt-1">Operational control center</p>
        </motion.div>

        {/* Row 1: Business Metrics */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Business Metrics</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <StatCard
              title="Topups Today"
              value={formatGHS(stats.todayTopupAmount)}
              icon={<CreditCard className="w-4 h-4" />}
              accent="teal"
              href="/admin/topups"
              breakdown={[
                { label: 'Admin', value: `${stats.todayAdminTopupCount} — ${formatGHS(stats.todayAdminTopupAmount)}` },
                { label: 'Paystack', value: `${stats.todayWebTopupCount} — ${formatGHS(stats.todayWebTopupAmount)}` },
              ]}
            />
            {isSuperAdmin && (
              <StatCard
                title="Revenue Today"
                value={formatGHS(stats.todayOrderAmount)}
                icon={<TrendingUp className="w-4 h-4" />}
                accent="blue"
                href="/admin/profit"
                breakdown={[
                  { label: 'Total orders', value: String(stats.todayOrderCount) },
                ]}
              />
            )}
            <StatCard
              title="Orders Today"
              value={String(stats.todayOrderCount)}
              icon={<ShoppingCart className="w-4 h-4" />}
              accent="purple"
              href="/admin/orders"
              breakdown={[
                { label: 'Delivered', value: String(stats.todayDelivered) },
              ]}
            />
            <StatCard
              title="Customers"
              value={String(stats.totalCustomers)}
              icon={<Users className="w-4 h-4" />}
              accent="green"
              href="/admin/customers"
              className="col-span-2 lg:col-span-1"
              breakdown={[
                { label: 'Active', value: String(stats.activeCustomers) },
                { label: 'Suspended', value: String(stats.suspendedCustomers) },
              ]}
            />
          </motion.div>
        </section>

        {/* Row 2: Operational Health */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Operational Health</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <StatCard
              title="Failed Today"
              value={String(stats.failedOrdersToday)}
              icon={<XCircle className="w-4 h-4" />}
              accent={stats.failedOrdersToday > 0 ? 'red' : 'green'}
              href="/admin/orders"
              secondaryValue={stats.failedOrdersToday === 0 ? 'No failures' : 'Needs attention'}
            />
            <StatCard
              title="Pending >5 min"
              value={String(stats.pendingOrdersStale)}
              icon={<Clock className="w-4 h-4" />}
              accent={stats.pendingOrdersStale > 0 ? 'amber' : 'green'}
              href="/admin/orders"
              secondaryValue={stats.pendingOrdersStale === 0 ? 'All clear' : 'Check orders'}
            />
            <StatCard
              title="Success Rate"
              value={`${stats.todaySuccessRate}%`}
              icon={<CheckCircle2 className="w-4 h-4" />}
              accent={stats.todaySuccessRate >= 90 ? 'green' : stats.todaySuccessRate >= 70 ? 'amber' : 'red'}
              secondaryValue={`${stats.todayDelivered} delivered today`}
            />
            <StatCard
              title="Total Wallet Balance"
              value={formatGHS(stats.totalBalance)}
              icon={<Wallet className="w-4 h-4" />}
              accent="teal"
              secondaryValue="Across all wallets"
            />
          </motion.div>
        </section>

        {/* Row 3: Lifetime Metrics */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Lifetime</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.15 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <StatCard
              title="Lifetime Topups"
              value={formatGHS(stats.lifetimeTopupAmount)}
              icon={<CreditCard className="w-4 h-4" />}
              accent="teal"
              href="/admin/topups"
              breakdown={[
                { label: 'Admin', value: `${stats.lifetimeAdminTopupCount} — ${formatGHS(stats.lifetimeAdminTopupAmount)}` },
                { label: 'Paystack', value: `${stats.lifetimeWebTopupCount} — ${formatGHS(stats.lifetimeWebTopupAmount)}` },
              ]}
            />
            <StatCard
              title="Lifetime Orders"
              value={formatGHS(stats.lifetimeOrderAmount)}
              icon={<Package className="w-4 h-4" />}
              accent="purple"
              href="/admin/orders"
              breakdown={[
                { label: 'Total orders', value: String(stats.lifetimeOrderCount) },
              ]}
            />
          </motion.div>
        </section>

        {/* Stores Marketplace */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Stores Marketplace</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.18 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <StatCard
              title="Total Stores"
              value={String(stats.storesTotal)}
              icon={<Store className="w-4 h-4" />}
              accent="blue"
              href="/admin/stores"
              breakdown={[
                { label: 'Active', value: String(stats.storesActive) },
                { label: 'Suspended', value: String(stats.storesSuspended) },
              ]}
            />
            <StatCard
              title="Store Sales Today"
              value={formatGHS(stats.storeRevenueToday)}
              icon={<ShoppingCart className="w-4 h-4" />}
              accent="purple"
              href="/admin/stores"
              breakdown={[
                { label: 'Orders', value: String(stats.storeOrdersToday) },
              ]}
            />
            <StatCard
              title="Lifetime Store Sales"
              value={formatGHS(stats.storeRevenueLifetime)}
              icon={<TrendingUp className="w-4 h-4" />}
              accent="teal"
              href="/admin/stores"
              breakdown={[
                { label: 'Total orders', value: String(stats.storeOrdersLifetime) },
              ]}
            />
            <StatCard
              title="Pending Withdrawals"
              value={String(stats.pendingWithdrawals)}
              icon={<Wallet className="w-4 h-4" />}
              accent={stats.pendingWithdrawals > 0 ? 'amber' : 'green'}
              href="/admin/stores"
              secondaryValue={stats.pendingWithdrawals > 0 ? formatGHS(stats.pendingWithdrawalsAmount) : 'All clear'}
            />
          </motion.div>
        </section>


        {/* Needs Attention + Recent Activity */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Activity & Alerts</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Needs Attention */}
            <NeedsAttentionPanel
              failedOrdersToday={attentionData.failedToday}
              pendingOrdersStale={attentionData.pendingStale}
              unresolvedReconciliation={attentionData.unresolvedRecon}
              staleItems={attentionData.staleItems}
            />

            {/* Recent Topups */}
            <div className="glass-card p-4 lg:p-5 card-shine border-l-[3px] border-l-teal/50">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-teal" />
                Recent Topups
              </h3>
              <div className="space-y-1">
                {recentTopups.map(t => (
                  <div key={t.id} onClick={() => navigate('/admin/topups')} className="flex items-center justify-between py-3 px-2 rounded-lg border-b border-border/30 last:border-0 hover:bg-muted/40 transition-colors cursor-pointer">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{t.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono text-primary">{t.short_id}</span> · {t.method}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        {' · '}
                        {new Date(t.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-3 space-y-1">
                      <span className="text-sm font-semibold text-foreground tabular-nums">{formatGHS(t.amount)}</span>
                      <div><StatusBadge status={t.status} /></div>
                    </div>
                  </div>
                ))}
                {recentTopups.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No topups yet</p>}
              </div>
            </div>

            {/* Recent Orders */}
            <div className="glass-card p-4 lg:p-5 card-shine border-l-[3px] border-l-primary/50">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Recent Orders
              </h3>
              <div className="space-y-1">
                {recentOrders.map(o => (
                  <div key={o.id} onClick={() => setInspectOrderId(o.id)} className="flex items-center justify-between py-3 px-2 rounded-lg border-b border-border/30 last:border-0 hover:bg-muted/40 transition-colors cursor-pointer">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{o.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.network} <span className="text-muted-foreground">•</span> {o.bundle_size} · <span className="font-mono">{o.recipient_phone}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        {' · '}
                        {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-3 space-y-1">
                      <span className="text-sm font-semibold text-foreground tabular-nums">{formatGHS(o.total_amount)}</span>
                      <div><StatusBadge status={o.status} /></div>
                    </div>
                  </div>
                ))}
                {recentOrders.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No orders yet</p>}
              </div>
            </div>
          </motion.div>
        </section>
      </div>

      {/* Order Inspector */}
      <OrderInspector
        orderId={inspectOrderId}
        open={!!inspectOrderId}
        onOpenChange={open => { if (!open) setInspectOrderId(null); }}
      />
    </AdminLayout>
  );
}
