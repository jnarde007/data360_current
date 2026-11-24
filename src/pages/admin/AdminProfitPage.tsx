import { useState, useEffect, useMemo } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { formatGHS } from '@/lib/mock-data';
import { Loader2, TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownRight, Minus, Target, CalendarIcon, Wallet, Receipt } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { isOperational } from '@/lib/order-metrics';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  format, startOfDay, endOfDay, startOfWeek, endOfWeek,
  subWeeks, subMonths, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, addDays, startOfYear, subYears, differenceInCalendarDays,
} from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';

type ViewMode = 'daily' | 'weekly' | 'monthly';

interface OrderData {
  total_amount: number;
  cost_price: number;
  created_at: string;
  network: string;
  status: string;
}

// Helper to compute profit from delivered orders in a list
function profitFrom(orders: OrderData[]): number {
  return orders
    .filter(o => o.status === 'delivered')
    .reduce((s, o) => s + (o.total_amount - o.cost_price), 0);
}
// Projected profit: delivered + all in-flight operational orders
function projectedProfitFrom(orders: OrderData[]): number {
  return orders
    .filter(o => isOperational(o.status))
    .reduce((s, o) => s + (o.total_amount - o.cost_price), 0);
}
function revenueFrom(orders: OrderData[]): number {
  return orders
    .filter(o => o.status === 'delivered')
    .reduce((s, o) => s + o.total_amount, 0);
}
function deliveredCount(orders: OrderData[]): number {
  return orders.filter(o => o.status === 'delivered').length;
}
function inflightCount(orders: OrderData[]): number {
  return orders.filter(o => isOperational(o.status) && o.status !== 'delivered').length;
}

function pctChange(current: number, previous: number): string | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return '+100';
  return ((current - previous) / Math.abs(previous) * 100).toFixed(1);
}

function ChangeIndicator({ current, previous, label }: { current: number; previous: number; label: string }) {
  const pct = pctChange(current, previous);
  if (pct === null) return <span className="text-xs text-muted-foreground">{label}: —</span>;
  const val = parseFloat(pct);
  const isUp = val > 0;
  const isDown = val < 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium",
      isUp ? "text-emerald-600 dark:text-emerald-400" : isDown ? "text-destructive" : "text-muted-foreground"
    )}>
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : isDown ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {isUp ? '+' : ''}{pct}% {label}
    </span>
  );
}

export default function AdminProfitPage() {
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.adminRole === 'Super Admin';
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [allOrders, setAllOrders] = useState<OrderData[]>([]);

  // Load a wide range of orders (back to start of previous year) to power all views including year-over-year comparison
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const now = new Date();
        const sixMonthsAgo = startOfMonth(subMonths(now, 5));
        const startOfLastYear = startOfYear(subYears(now, 1));
        const start = sixMonthsAgo < startOfLastYear ? sixMonthsAgo : startOfLastYear;
        const end = endOfDay(now);
        // Page through results to bypass Supabase's default 1000-row cap.
        // Without this, the most recent days get chopped off and profit shows ₵0.
        const PAGE_SIZE = 1000;
        let from = 0;
        const all: any[] = [];
        // Order by created_at DESC so if anything is missed, it's the oldest (least relevant) data.
        while (true) {
          const { data, error } = await supabase
            .from('orders_admin' as any)
            .select('total_amount, cost_price, created_at, network, status')
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString())
            .order('created_at', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
          if (error) throw error;
          if (!data || (data as any[]).length === 0) break;
          all.push(...(data as any[]));
          if ((data as any[]).length < PAGE_SIZE) break;
          from += PAGE_SIZE;
          // Safety: hard cap at 50k rows
          if (from >= 50000) break;
        }
        const data = all;
        // Fold in AFA registrations as synthetic orders so AFA profit is
        // included in every aggregation (totals, networks, daily/weekly/monthly).
        const { fetchAfaAsOrders } = await import('@/lib/afa-profit');
        const afaRows = await fetchAfaAsOrders({
          startISO: start.toISOString(),
          endISO: end.toISOString(),
        });
        setAllOrders([
          ...(data || []).map(d => ({
            ...d,
            total_amount: Number(d.total_amount),
            cost_price: Number((d as any).cost_price || 0),
          })),
          ...afaRows.map(r => ({
            total_amount: r.total_amount,
            cost_price: r.cost_price,
            created_at: r.created_at,
            network: r.network,
            status: r.status,
          })),
        ]);
      } catch (e) {
        console.error('Failed to load profit data', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Filter orders into a date range
  const ordersInRange = (start: Date, end: Date) =>
    allOrders.filter(o => {
      const d = new Date(o.created_at);
      return d >= start && d <= end;
    });

  // ── DAILY VIEW DATA (last 7 days) ──
  const dailyData = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));

    const chartData = days.map((day, i) => {
      const dayOrders = ordersInRange(startOfDay(day), endOfDay(day));
      const prevDay = subWeeks(day, 1);
      const prevDayOrders = ordersInRange(startOfDay(prevDay), endOfDay(prevDay));
      const isToday = i === 6;
      const isYesterday = i === 5;
      const label = isToday ? 'Today' : isYesterday ? 'Yesterday' : format(day, 'EEEE');
      return {
        name: label,
        fullDate: format(day, 'MMM d'),
        profit: profitFrom(dayOrders),
        prevProfit: profitFrom(prevDayOrders),
        revenue: revenueFrom(dayOrders),
        orders: deliveredCount(dayOrders),
      };
    });

    const todayOrders = ordersInRange(startOfDay(now), endOfDay(now));
    const yesterday = addDays(now, -1);
    const yesterdayOrders = ordersInRange(startOfDay(yesterday), endOfDay(yesterday));
    const todayProfit = profitFrom(todayOrders);
    const todayProjected = projectedProfitFrom(todayOrders);
    const todayInflight = inflightCount(todayOrders);
    const todayRevenue = revenueFrom(todayOrders);
    const yesterdayProfit = profitFrom(yesterdayOrders);
    const yesterdayRevenue = revenueFrom(yesterdayOrders);

    return { chartData, todayProfit, todayProjected, todayInflight, todayRevenue, todayOrders: deliveredCount(todayOrders), yesterdayProfit, yesterdayRevenue, yesterdayOrders: deliveredCount(yesterdayOrders) };
  }, [allOrders]);

  // ── WEEKLY VIEW DATA (5 weeks) ──
  const weeklyData = useMemo(() => {
    const now = new Date();
    const weeks = Array.from({ length: 5 }, (_, i) => {
      const ws = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      const we = i === 0 ? endOfDay(now) : endOfWeek(ws, { weekStartsOn: 1 });
      return { start: ws, end: we, index: i };
    }).reverse();

    const chartData = weeks.map(w => {
      const wOrders = ordersInRange(w.start, w.end);
      const label = w.index === 0 ? 'This Week' : w.index === 1 ? 'Last Week' : `${w.index} Weeks Ago`;
      return {
        name: label,
        profit: profitFrom(wOrders),
        revenue: revenueFrom(wOrders),
        orders: deliveredCount(wOrders),
      };
    });

    const thisWeek = chartData[chartData.length - 1];
    const lastWeek = chartData[chartData.length - 2];
    const thisWeekOrders = ordersInRange(weeks[weeks.length - 1].start, weeks[weeks.length - 1].end);
    const thisWeekProjected = projectedProfitFrom(thisWeekOrders);
    const thisWeekInflight = inflightCount(thisWeekOrders);

    return { chartData, thisWeekProfit: thisWeek.profit, lastWeekProfit: lastWeek.profit, thisWeekRevenue: thisWeek.revenue, lastWeekRevenue: lastWeek.revenue, thisWeekOrders: thisWeek.orders, thisWeekProjected, thisWeekInflight };
  }, [allOrders]);

  // ── MONTHLY VIEW DATA (Jan to current month) ──
  const monthlyData = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const months = Array.from({ length: currentMonth + 1 }, (_, i) => {
      const ms = new Date(now.getFullYear(), i, 1);
      const me = i === currentMonth ? endOfDay(now) : endOfMonth(ms);
      return { start: ms, end: me, index: i };
    });

    const chartData = months.map(m => {
      const mOrders = ordersInRange(m.start, m.end);
      return {
        name: format(m.start, 'MMM'),
        profit: profitFrom(mOrders),
        revenue: revenueFrom(mOrders),
        orders: deliveredCount(mOrders),
      };
    });

    const thisMonth = chartData[chartData.length - 1];
    const lastMonth = chartData.length >= 2 ? chartData[chartData.length - 2] : { profit: 0, revenue: 0, orders: 0 };
    const thisMonthOrders = ordersInRange(months[months.length - 1].start, months[months.length - 1].end);
    const thisMonthProjected = projectedProfitFrom(thisMonthOrders);
    const thisMonthInflight = inflightCount(thisMonthOrders);

    return { chartData, thisMonthProfit: thisMonth.profit, lastMonthProfit: lastMonth.profit, thisMonthRevenue: thisMonth.revenue, lastMonthRevenue: lastMonth.revenue, thisMonthOrders: thisMonth.orders, thisMonthProjected, thisMonthInflight };
  }, [allOrders]);

  // ── NETWORK BREAKDOWN ──
  const networkBreakdown = useMemo(() => {
    let relevantOrders: OrderData[] = [];
    const now = new Date();
    if (viewMode === 'daily') {
      relevantOrders = ordersInRange(startOfDay(now), endOfDay(now));
    } else if (viewMode === 'weekly') {
      relevantOrders = ordersInRange(startOfWeek(now, { weekStartsOn: 1 }), endOfDay(now));
    } else {
      relevantOrders = ordersInRange(startOfMonth(now), endOfDay(now));
    }
    const delivered = relevantOrders.filter(o => o.status === 'delivered');
    const map: Record<string, { revenue: number; cost: number; profit: number; orders: number }> = {};
    delivered.forEach(o => {
      if (!map[o.network]) map[o.network] = { revenue: 0, cost: 0, profit: 0, orders: 0 };
      map[o.network].revenue += o.total_amount;
      map[o.network].cost += o.cost_price;
      map[o.network].profit += o.total_amount - o.cost_price;
      map[o.network].orders += 1;
    });
    return Object.entries(map).map(([network, data]) => ({ network, ...data }));
  }, [allOrders, viewMode]);

  if (!isSuperAdmin) {
    return <AdminLayout><Navigate to="/admin" replace /></AdminLayout>;
  }

  const tooltipStyle = {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Profit & Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Compare performance across periods</p>
        </div>

        {/* ═══ TOTAL PROFIT SUMMARY ═══ */}
        <TotalProfitCard orders={allOrders} loading={loading} ordersInRange={ordersInRange} />



        {/* View Mode Tabs */}
        <Tabs value={viewMode} onValueChange={v => setViewMode(v as ViewMode)} className="w-full sm:w-auto">
          <TabsList className="grid grid-cols-3 w-full sm:w-72">
            <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
            <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
            <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* ═══ DAILY VIEW ═══ */}
            {viewMode === 'daily' && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <SummaryCard
                    icon={<DollarSign className="w-4 h-4 text-primary" />}
                    iconBg="bg-primary/10"
                    label="Today's Profit"
                    value={formatGHS(dailyData.todayProfit)}
                    sub={`${dailyData.todayOrders} delivered`}
                  />
                  <SummaryCard
                    icon={<Target className="w-4 h-4 text-amber-500" />}
                    iconBg="bg-amber-500/10"
                    label="Today's Projected"
                    value={formatGHS(dailyData.todayProjected)}
                    sub={dailyData.todayInflight > 0 ? `From ${dailyData.todayInflight} active orders` : 'No active orders'}
                    hint="If all active orders complete"
                  />
                  <SummaryCard
                    icon={<TrendingUp className="w-4 h-4 text-primary" />}
                    iconBg="bg-primary/10"
                    label="Today's Revenue"
                    value={formatGHS(dailyData.todayRevenue)}
                  />
                  <SummaryCard
                    icon={<TrendingDown className="w-4 h-4 text-muted-foreground" />}
                    iconBg="bg-muted"
                    label="Yesterday's Profit"
                    value={formatGHS(dailyData.yesterdayProfit)}
                    sub={`${dailyData.yesterdayOrders} delivered`}
                  />
                  <SummaryCard
                    icon={<TrendingUp className="w-4 h-4 text-muted-foreground" />}
                    iconBg="bg-muted"
                    label="Yesterday's Revenue"
                    value={formatGHS(dailyData.yesterdayRevenue)}
                  />
                </div>

                <div className="glass-card glow-border p-5">
                  <h3 className="font-display font-semibold text-foreground mb-1">Daily Profit — Last 7 Days</h3>
                  <p className="text-xs text-muted-foreground mb-4">Recent 7-day daily trend</p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData.chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [formatGHS(value), 'Profit']} />
                        <Bar dataKey="profit" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            {/* ═══ WEEKLY VIEW ═══ */}
            {viewMode === 'weekly' && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <SummaryCard
                    icon={<DollarSign className="w-4 h-4 text-primary" />}
                    iconBg="bg-primary/10"
                    label="This Week's Profit"
                    value={formatGHS(weeklyData.thisWeekProfit)}
                    sub={<ChangeIndicator current={weeklyData.thisWeekProfit} previous={weeklyData.lastWeekProfit} label="vs last week" />}
                  />
                  <SummaryCard
                    icon={<Target className="w-4 h-4 text-amber-500" />}
                    iconBg="bg-amber-500/10"
                    label="This Week's Projected"
                    value={formatGHS(weeklyData.thisWeekProjected)}
                    sub={weeklyData.thisWeekInflight > 0 ? `From ${weeklyData.thisWeekInflight} active orders` : 'No active orders'}
                    hint="If all active orders complete"
                  />
                  <SummaryCard
                    icon={<TrendingUp className="w-4 h-4 text-primary" />}
                    iconBg="bg-primary/10"
                    label="This Week's Revenue"
                    value={formatGHS(weeklyData.thisWeekRevenue)}
                    sub={`${weeklyData.thisWeekOrders} delivered`}
                  />
                  <SummaryCard
                    icon={<TrendingDown className="w-4 h-4 text-muted-foreground" />}
                    iconBg="bg-muted"
                    label="Last Week's Profit"
                    value={formatGHS(weeklyData.lastWeekProfit)}
                  />
                  <SummaryCard
                    icon={<TrendingDown className="w-4 h-4 text-muted-foreground" />}
                    iconBg="bg-muted"
                    label="Last Week's Revenue"
                    value={formatGHS(weeklyData.lastWeekRevenue)}
                  />
                </div>

                <div className="glass-card glow-border p-5">
                  <h3 className="font-display font-semibold text-foreground mb-1">Weekly Profit Comparison</h3>
                  <p className="text-xs text-muted-foreground mb-4">Last 6 weeks</p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weeklyData.chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="35%">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [formatGHS(value), 'Profit']} />
                        <Bar dataKey="profit" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            {/* ═══ MONTHLY VIEW ═══ */}
            {viewMode === 'monthly' && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <SummaryCard
                    icon={<DollarSign className="w-4 h-4 text-primary" />}
                    iconBg="bg-primary/10"
                    label="This Month's Profit"
                    value={formatGHS(monthlyData.thisMonthProfit)}
                    sub={<ChangeIndicator current={monthlyData.thisMonthProfit} previous={monthlyData.lastMonthProfit} label="vs last month" />}
                  />
                  <SummaryCard
                    icon={<Target className="w-4 h-4 text-amber-500" />}
                    iconBg="bg-amber-500/10"
                    label="This Month's Projected"
                    value={formatGHS(monthlyData.thisMonthProjected)}
                    sub={monthlyData.thisMonthInflight > 0 ? `From ${monthlyData.thisMonthInflight} active orders` : 'No active orders'}
                    hint="If all active orders complete"
                  />
                  <SummaryCard
                    icon={<TrendingUp className="w-4 h-4 text-primary" />}
                    iconBg="bg-primary/10"
                    label="This Month's Revenue"
                    value={formatGHS(monthlyData.thisMonthRevenue)}
                    sub={`${monthlyData.thisMonthOrders} delivered`}
                  />
                  <SummaryCard
                    icon={<TrendingDown className="w-4 h-4 text-muted-foreground" />}
                    iconBg="bg-muted"
                    label="Last Month's Profit"
                    value={formatGHS(monthlyData.lastMonthProfit)}
                  />
                  <SummaryCard
                    icon={<TrendingDown className="w-4 h-4 text-muted-foreground" />}
                    iconBg="bg-muted"
                    label="Last Month's Revenue"
                    value={formatGHS(monthlyData.lastMonthRevenue)}
                  />
                </div>

                <div className="glass-card glow-border p-5">
                  <h3 className="font-display font-semibold text-foreground mb-1">Monthly Profit Comparison</h3>
                  <p className="text-xs text-muted-foreground mb-4">Last 6 months</p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyData.chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="35%">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [formatGHS(value), 'Profit']} />
                        <Bar dataKey="profit" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={44} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            {/* Network Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-card glow-border p-5">
                <h3 className="font-display font-semibold text-foreground mb-1">Network Breakdown</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {viewMode === 'daily' ? "Today's" : viewMode === 'weekly' ? 'This week' : 'This month'} profit by network
                </p>
                {networkBreakdown.length > 0 ? (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={networkBreakdown} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%" barGap={4}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="network" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [formatGHS(value), name.charAt(0).toUpperCase() + name.slice(1)]} />
                        <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="profit" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
                )}
              </div>

              <div className="glass-card glow-border p-5">
                <h3 className="font-display font-semibold text-foreground mb-1">Network Summary</h3>
                <p className="text-xs text-muted-foreground mb-4">Detailed breakdown</p>
                <div className="space-y-3">
                  {networkBreakdown.length > 0 ? networkBreakdown.map(n => (
                    <div key={n.network} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-foreground">{n.network}</p>
                        <p className="text-xs text-muted-foreground">{n.orders} order(s) · Cost: {formatGHS(n.cost)}</p>
                      </div>
                      <div className="text-right">
                        <p className={cn("text-sm font-bold tabular-nums", n.profit >= 0 ? "text-primary" : "text-destructive")}>
                          {formatGHS(n.profit)}
                        </p>
                        <p className="text-xs text-muted-foreground">Rev: {formatGHS(n.revenue)}</p>
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// ── Reusable summary card ──
function SummaryCard({ icon, iconBg, label, value, sub, hint }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  sub?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="glass-card glow-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", iconBg)}>
          {icon}
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-display font-bold text-foreground tabular-nums">{value}</p>
      {sub && <div className="mt-1.5">{typeof sub === 'string' ? <p className="text-xs text-muted-foreground">{sub}</p> : sub}</div>}
      {hint && <p className="text-[10px] text-muted-foreground/60 mt-1 italic">{hint}</p>}
    </div>
  );
}

// ── Total Profit summary card with period selector ──
function getPeriodRange(period: PeriodKey, customStart?: Date, customEnd?: Date): { start: Date; end: Date; prevStart: Date; prevEnd: Date; label: string; prevLabel: string } | null {
  const now = new Date();
  switch (period) {
    case 'today': {
      const start = startOfDay(now);
      const end = endOfDay(now);
      return { start, end, prevStart: startOfDay(addDays(now, -1)), prevEnd: endOfDay(addDays(now, -1)), label: 'Today', prevLabel: 'yesterday' };
    }
    case 'week': {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      const end = endOfDay(now);
      const prevStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      const prevEnd = endOfWeek(prevStart, { weekStartsOn: 1 });
      return { start, end, prevStart, prevEnd, label: 'This Week', prevLabel: 'last week' };
    }
    case 'month': {
      const start = startOfMonth(now);
      const end = endOfDay(now);
      const prevStart = startOfMonth(subMonths(now, 1));
      const prevEnd = endOfMonth(prevStart);
      return { start, end, prevStart, prevEnd, label: 'This Month', prevLabel: 'last month' };
    }
    case 'year': {
      const start = startOfYear(now);
      const end = endOfDay(now);
      const prevStart = startOfYear(subYears(now, 1));
      const prevEnd = new Date(prevStart);
      prevEnd.setMonth(now.getMonth());
      prevEnd.setDate(now.getDate());
      return { start, end, prevStart, prevEnd: endOfDay(prevEnd), label: 'This Year', prevLabel: 'last year' };
    }
    case 'custom': {
      if (!customStart || !customEnd) return null;
      const start = startOfDay(customStart);
      const end = endOfDay(customEnd);
      const days = differenceInCalendarDays(end, start) + 1;
      const prevEnd = endOfDay(addDays(start, -1));
      const prevStart = startOfDay(addDays(prevEnd, -(days - 1)));
      return { start, end, prevStart, prevEnd, label: `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`, prevLabel: 'previous period' };
    }
  }
}

function TotalProfitCard({ orders, loading, ordersInRange }: {
  orders: OrderData[];
  loading: boolean;
  ordersInRange: (start: Date, end: Date) => OrderData[];
}) {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customStart, setCustomStart] = useState<Date | undefined>(addDays(new Date(), -7));
  const [customEnd, setCustomEnd] = useState<Date | undefined>(new Date());
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const data = useMemo(() => {
    const r = getPeriodRange(period, customStart, customEnd);
    if (!r) return null;
    const current = ordersInRange(r.start, r.end);
    const previous = ordersInRange(r.prevStart, r.prevEnd);
    const profit = profitFrom(current);
    const prevProfit = profitFrom(previous);
    const revenue = revenueFrom(current);
    const cost = revenue - profit;
    const txns = deliveredCount(current);

    const totalDays = differenceInCalendarDays(r.end, r.start) + 1;
    const days = totalDays <= 0 ? [r.start] : eachDayOfInterval({ start: r.start, end: r.end });
    let buckets: { name: string; value: number }[];
    if (days.length <= 62) {
      buckets = days.map(d => ({
        name: format(d, 'MMM d'),
        value: profitFrom(ordersInRange(startOfDay(d), endOfDay(d))),
      }));
    } else {
      const monthMap = new Map<string, { date: Date; value: number }>();
      current.filter(o => o.status === 'delivered').forEach(o => {
        const d = new Date(o.created_at);
        const k = format(d, 'yyyy-MM');
        const cur = monthMap.get(k) ?? { date: startOfMonth(d), value: 0 };
        cur.value += o.total_amount - o.cost_price;
        monthMap.set(k, cur);
      });
      buckets = Array.from(monthMap.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map(b => ({ name: format(b.date, 'MMM'), value: b.value }));
    }

    return { ...r, profit, prevProfit, revenue, cost, txns, sparkline: buckets };
  }, [orders, period, customStart, customEnd, ordersInRange]);

  const pct = data ? pctChange(data.profit, data.prevProfit) : null;
  const pctVal = pct !== null ? parseFloat(pct) : 0;
  const isPositive = data ? data.profit >= 0 : true;
  const trendUp = pct !== null && pctVal > 0;
  const trendDown = pct !== null && pctVal < 0;

  const accentText = isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive';
  const accentBorder = isPositive ? 'border-l-emerald-500/60' : 'border-l-destructive/60';
  const accentGlow = isPositive
    ? 'hover:shadow-[0_8px_32px_-8px_hsl(142_76%_36%/0.25)]'
    : 'hover:shadow-[0_8px_32px_-8px_hsl(var(--destructive)/0.25)]';

  return (
    <div className={cn('glass-card glow-border border-l-[3px] p-5 sm:p-6 transition-all duration-300', accentBorder, accentGlow)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center',
            isPositive ? 'bg-emerald-500/10' : 'bg-destructive/10')}>
            <Wallet className={cn('w-4 h-4', accentText)} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Profit</p>
            <p className="text-[11px] text-muted-foreground/70">{data?.label ?? '—'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'week', 'month', 'year', 'custom'] as PeriodKey[]).map(p => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'outline'}
              onClick={() => setPeriod(p)}
              className="h-8 text-xs"
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p === 'year' ? 'This Year' : 'Custom'}
            </Button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" />
                {customStart ? format(customStart, 'MMM d, yyyy') : 'Start date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={customStart}
                onSelect={(d) => { if (d) { setCustomStart(d); setStartOpen(false); } }}
                disabled={(d) => d > new Date()}
                initialFocus className={cn('p-3 pointer-events-auto')} />
            </PopoverContent>
          </Popover>
          <span className="text-xs text-muted-foreground">to</span>
          <Popover open={endOpen} onOpenChange={setEndOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" />
                {customEnd ? format(customEnd, 'MMM d, yyyy') : 'End date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={customEnd}
                onSelect={(d) => { if (d) { setCustomEnd(d); setEndOpen(false); } }}
                disabled={(d) => d > new Date() || (customStart ? d < customStart : false)}
                initialFocus className={cn('p-3 pointer-events-auto')} />
            </PopoverContent>
          </Popover>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-center">
        <div className="lg:col-span-2">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-sm">Loading…</span>
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">Select a date range</p>
          ) : (
            <>
              <p className={cn('text-4xl sm:text-5xl font-display font-bold tabular-nums leading-none', accentText)}>
                {formatGHS(data.profit)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {pct !== null ? (
                  <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-1 rounded-md',
                    trendUp ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : trendDown ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted text-muted-foreground'
                  )}>
                    {trendUp ? <ArrowUpRight className="w-3 h-3" /> : trendDown ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                    {trendUp ? '+' : ''}{pct}% vs {data.prevLabel}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No prior data to compare</span>
                )}
                <span className="text-xs text-muted-foreground">· {data.txns} delivered</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 max-w-xs">
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="w-3 h-3" /> Revenue
                  </div>
                  <p className="text-sm font-semibold text-foreground tabular-nums mt-1">{formatGHS(data.revenue)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Receipt className="w-3 h-3" /> Cost
                  </div>
                  <p className="text-sm font-semibold text-foreground tabular-nums mt-1">{formatGHS(data.cost)}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="lg:col-span-3 h-28 sm:h-32">
          {data && data.sparkline.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.sparkline} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(v: number) => [formatGHS(v), 'Profit']}
                  labelStyle={{ fontSize: '10px', color: 'hsl(var(--muted-foreground))' }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={isPositive ? 'hsl(142 76% 36%)' : 'hsl(var(--destructive))'}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              {data ? 'Not enough data for trend' : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
