import { useSuperAgentPricing } from '@/hooks/use-super-agent-pricing';
import { SuperAgentBadge } from '@/components/SuperAgentBadge';
import { useState, useEffect, useCallback } from 'react';
import { OrderCountdown } from '@/components/OrderCountdown';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge } from '@/components/StatusBadge';
import { CustomerLayout } from '@/components/CustomerLayout';
import { formatGHS } from '@/lib/mock-data';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Wallet, ShoppingCart, TrendingUp, Clock, CreditCard, History, User, Users, MessageCircle, ArrowRight, Loader2, LifeBuoy, FileSearch, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { countOperationalOrders, countDeliveredOrders, totalSpent as calcTotalSpent, isOperational, TERMINAL_STATUS_FILTER } from '@/lib/order-metrics';
import { motion } from 'framer-motion';
import { getNetworkAccent, getNetworkStripe, formatPhoneSpaced } from '@/lib/network-colors';
import mtnLogo from '@/assets/mtn-logo.png';
import atLogo from '@/assets/at-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';

const networkLogos: Record<string, string> = { MTN: mtnLogo, AirtelTigo: atLogo, Telecel: telecelLogo };

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

function MiniStatCard({ title, value, icon, subtitle, accentColor, borderAccent, valueColor }: { title: string; value: string; icon: React.ReactNode; subtitle?: string; accentColor?: string; borderAccent?: string; valueColor?: string }) {
  return (
    <div className={`glass-card p-3.5 lg:p-5 card-hover card-shine group text-center ${borderAccent || ''}`}>
      <div className={`icon-box icon-box-md lg:icon-box-lg mx-auto mb-2.5 transition-all duration-300 group-hover:scale-110 ${accentColor || 'icon-box-primary'}`}>
        {icon}
      </div>
      <p className="text-[10px] lg:text-xs font-medium uppercase tracking-wider text-muted-foreground/70 leading-tight">{title}</p>
      <p className={`text-lg lg:text-2xl font-display font-bold mt-1 tabular-nums ${valueColor || 'text-foreground'}`}>{value}</p>
      {subtitle && <p className="text-[10px] lg:text-xs text-muted-foreground/60 mt-1 lg:mt-2">{subtitle}</p>}
    </div>
  );
}

interface OrderRow {
  id: string;
  short_id: string;
  network: string;
  bundle_size: string;
  recipient_phone: string;
  total_amount: number;
  status: string;
  created_at: string;
  grace_period_ends_at: string | null;
}

export default function CustomerDashboard() {
  const { isSuperAgent } = useSuperAgentPricing();
  const { user } = useAuth();
  const [recentOrders, setRecentOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalSpent: 0, todaySpent: 0, todayCount: 0, totalCount: 0 });
  const [referralCount, setReferralCount] = useState(0);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const ordersPromise = supabase
        .from('orders')
        .select('id, short_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, grace_period_ends_at, delivery_mode, provider_name, buyer_type, payment_method, payment_reference')
        .eq('customer_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const todayOrdersPromise = supabase
        .from('orders')
        .select('total_amount, status')
        .eq('customer_id', user!.id)
        .gte('created_at', todayISO);

      const allOrdersPromise = supabase
        .from('orders')
        .select('total_amount, status')
        .eq('customer_id', user!.id);

      const referralPromise = supabase.rpc('get_my_referral_count');

      const [ordersRes, todayOrdersRes, allOrdersRes, referralRes] = await Promise.all([
        ordersPromise,
        todayOrdersPromise,
        allOrdersPromise,
        referralPromise,
      ]);

      const allOrders = ordersRes.data || [];
      const todayOrders = todayOrdersRes.data || [];

      const allOrd = (allOrdersRes.data || []) as { total_amount: number; status: string }[];
      // Spent excludes only refunded/cancelled/rejected orders (money was returned).
      // Everything else — delivered, pending, processing, failed — counts as spent.
      const countable = allOrd.filter(o => isOperational(o.status) || o.status === 'delivered');
      const totalSpentVal = countable.reduce((sum, o) => sum + Number(o.total_amount), 0);
      const countableToday = todayOrders.filter((o: any) => isOperational(o.status) || o.status === 'delivered');
      const todaySpent = countableToday.reduce((sum: number, o: any) => sum + Number(o.total_amount), 0);


      setRecentOrders(allOrders as OrderRow[]);
      setStats({
        totalSpent: totalSpentVal,
        todaySpent,
        todayCount: countableToday.length,
        totalCount: countable.length,
      });

      if (referralRes && !referralRes.error) {
        setReferralCount(referralRes.data || 0);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.affiliate_code]);

  useEffect(() => { loadData(); }, [loadData]);

  useRealtimeRefresh(['orders', 'wallet_transactions', 'customers'], loadData, 'customer-dash-live');

  if (loading) {
    return (
      <CustomerLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout>
      <div className="space-y-5 lg:space-y-8">
        {/* Welcome */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl lg:text-3xl font-display font-bold text-foreground tracking-tight">
            Welcome back, {user?.full_name?.split(' ')[0]}! 👋
          </h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-0.5 lg:mt-1">Here's your account overview</p>
          {isSuperAgent && <div className="mt-2 flex flex-wrap items-center gap-2"><SuperAgentBadge /><span className="text-xs text-muted-foreground">You get special Super Agent prices on data bundles.</span></div>}
        </motion.div>

        {/* Stats */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Overview</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-4">
            <MiniStatCard title="Account Balance" value={formatGHS(user?.wallet_balance || 0)} icon={<Wallet className="w-4 h-4 lg:w-5 lg:h-5" />} accentColor="icon-box-success" borderAccent="border-l-[3px] border-l-success/50" valueColor="text-success" />
            <MiniStatCard title="Total Spent" value={formatGHS(stats.totalSpent)} icon={<TrendingUp className="w-4 h-4 lg:w-5 lg:h-5" />} subtitle={`${stats.totalCount} orders`} accentColor="icon-box-primary" borderAccent="border-l-[3px] border-l-primary/50" valueColor="text-primary" />
            <MiniStatCard title="Today's Orders" value={formatGHS(stats.todaySpent)} icon={<ShoppingCart className="w-4 h-4 lg:w-5 lg:h-5" />} subtitle={`${stats.todayCount} orders`} accentColor="icon-box-amber" borderAccent="border-l-[3px] border-l-amber/50" valueColor="text-amber" />
            <MiniStatCard title="Referrals" value={String(referralCount)} icon={<Users className="w-4 h-4 lg:w-5 lg:h-5" />} subtitle={`${formatGHS(user?.available_commission || 0)} commission`} accentColor="icon-box-purple" borderAccent="border-l-[3px] border-l-purple/50" valueColor="text-purple" />

          </motion.div>
        </section>

        {/* Quick Actions */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Quick Actions</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <div className="grid grid-cols-3 gap-2.5 lg:gap-3">
            {[
              { to: '/checker', label: 'Results Checker', icon: FileSearch, accent: 'icon-box-primary' },
              { to: '/afa', label: 'AFA Registration', icon: UserPlus, accent: 'icon-box-amber' },
              { to: '/affiliate', label: 'Referrals', icon: Users, accent: 'icon-box-purple' },
            ].map(a => (
              <Link key={a.to} to={a.to} className="group">
                <div className="glass-card flex flex-col items-center justify-center gap-2.5 lg:gap-3 py-4 lg:py-5 px-2 transition-all duration-300 ease-out hover:-translate-y-[3px] hover:shadow-lg active:scale-[0.97] cursor-pointer">
                  <div className={`icon-box icon-box-lg lg:icon-box-xl transition-transform duration-300 group-hover:scale-110 ${a.accent}`}>
                    <a.icon className="w-5 h-5 lg:w-6 lg:h-6" />
                  </div>
                  <span className="text-[11px] lg:text-xs font-semibold text-foreground tracking-wide">{a.label}</span>
                </div>
              </Link>
            ))}
          </div>
          {/* Shortcuts: repeat last order + quick top-up */}
          <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-3 mt-2.5 lg:mt-3">
            {recentOrders[0] && (
              <Link
                to={`/buy-data?network=${encodeURIComponent(recentOrders[0].network)}&size=${encodeURIComponent(String(recentOrders[0].bundle_size))}&phone=${encodeURIComponent(recentOrders[0].recipient_phone || '')}`}
                className="glass-card flex items-center gap-3 p-3.5 transition-all hover:-translate-y-[2px] hover:shadow-lg active:scale-[0.99]"
              >
                <div className="icon-box icon-box-lg icon-box-primary"><History className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Repeat last order</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {recentOrders[0].network} · {recentOrders[0].bundle_size} → {recentOrders[0].recipient_phone}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            )}
            <div className="glass-card p-3.5">
              <p className="text-sm font-semibold text-foreground mb-2">Quick top up</p>
              <div className="grid grid-cols-4 gap-2">
                {[20, 50, 100, 200].map(v => (
                  <Link
                    key={v}
                    to={`/topup?amount=${v}`}
                    className="rounded-xl border border-border bg-card py-2 text-center text-xs font-semibold text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                  >
                    ₵{v}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Recent Orders */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Recent Orders</h2>
            <div className="flex-1 h-px bg-border/60" />
            <Link to="/orders" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.15 }}
            className="glass-card p-3 lg:p-5 card-shine">
            {recentOrders.length === 0 ? (
              <div className="text-center py-8">
                <ShoppingCart className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No orders yet</p>
                <Link to="/buy-data">
                  <Button size="sm" className="mt-3 gradient-primary text-primary-foreground border-0">Buy Data</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentOrders.slice(0, 5).map(o => (
                  <div key={o.id} className={`relative overflow-hidden flex items-center gap-3 py-3 pl-4 pr-3 rounded-2xl border border-border/60 bg-card shadow-sm transition-all hover:-translate-y-[1px] hover:shadow-md before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${getNetworkStripe(o.network)}`}>
                    <div className={`w-10 h-10 rounded-xl ${getNetworkAccent(o.network).iconBg} flex items-center justify-center shrink-0`}>
                      {networkLogos[o.network]
                        ? <img src={networkLogos[o.network]} alt={o.network} className="w-6 h-6 rounded-lg object-cover" />
                        : <ShoppingCart className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-semibold text-foreground truncate">{o.network} · {o.bundle_size}</p>
                      <p className="text-xs font-mono tracking-wide text-muted-foreground">{formatPhoneSpaced(o.recipient_phone)}</p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {o.short_id} · {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        {' · '}
                        {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p className="text-sm font-display font-bold text-foreground tabular-nums">{formatGHS(Number(o.total_amount))}</p>
                      <StatusBadge status={o.status} />
                      {o.status === 'pending_confirmation' && o.grace_period_ends_at && (
                        <div className="mt-1">
                          <OrderCountdown
                            orderId={o.id}
                            customerId={user!.id}
                            gracePeriodEndsAt={o.grace_period_ends_at}
                            shortId={o.short_id}
                            onCancelled={() => loadData()}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </section>

      </div>
    </CustomerLayout>
  );
}
