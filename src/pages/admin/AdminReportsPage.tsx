import { useState } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { useReportData, ReportFilters, ReportPeriod } from '@/hooks/use-report-data';
import { downloadCsv, downloadFullReportCsv, pct } from '@/lib/report-export';
import { downloadFullReportExcel } from '@/lib/report-export-xlsx';
import { formatGHS } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, FileSpreadsheet, CalendarIcon, BarChart3, ShoppingCart, Wallet,
  Users, Wifi, UserCheck, LifeBuoy, TrendingUp, AlertTriangle, CheckCircle2,
  XCircle, Clock, Download, DollarSign, FileText, Printer
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts';

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  daily: 'Today',
  weekly: 'This Week',
  monthly: 'This Month',
  quarterly: 'This Quarter',
  yearly: 'This Year',
  specific_month: 'Select Month',
  specific_quarter: 'Select Quarter',
  specific_year: 'Select Year',
  custom: 'Custom Range',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const QUARTERS = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

const NETWORKS = ['all', 'MTN', 'Telecel', 'AirtelTigo'];
const STATUSES = ['all', 'pending', 'processing', 'delivered', 'failed', 'cancelled'];

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

function MetricCard({ icon, label, value, sub, accent = 'primary' }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string;
}) {
  const tints: Record<string, { wrap: string; icon: string; value: string; bar: string }> = {
    primary:     { wrap: 'bg-gradient-to-br from-primary/[0.08] via-card to-card',     icon: 'bg-primary/15 text-primary border border-primary/20',           value: 'text-primary',     bar: 'border-l-[3px] border-l-primary/60' },
    success:     { wrap: 'bg-gradient-to-br from-success/[0.08] via-card to-card',     icon: 'bg-success/15 text-success border border-success/20',           value: 'text-success',     bar: 'border-l-[3px] border-l-success/60' },
    warning:     { wrap: 'bg-gradient-to-br from-amber/[0.08] via-card to-card',       icon: 'bg-amber/15 text-amber border border-amber/20',                 value: 'text-amber',       bar: 'border-l-[3px] border-l-amber/60' },
    destructive: { wrap: 'bg-gradient-to-br from-destructive/[0.08] via-card to-card', icon: 'bg-destructive/15 text-destructive border border-destructive/20', value: 'text-destructive', bar: 'border-l-[3px] border-l-destructive/60' },
    teal:        { wrap: 'bg-gradient-to-br from-teal/[0.08] via-card to-card',        icon: 'bg-teal/15 text-teal border border-teal/20',                    value: 'text-teal',        bar: 'border-l-[3px] border-l-teal/60' },
    purple:      { wrap: 'bg-gradient-to-br from-purple/[0.08] via-card to-card',      icon: 'bg-purple/15 text-purple border border-purple/20',              value: 'text-purple',      bar: 'border-l-[3px] border-l-purple/60' },
  };
  const t = tints[accent] || tints.primary;
  return (
    <Card className={cn('overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md', t.wrap, t.bar)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{label}</p>
            <p className={cn('text-lg font-bold tabular-nums', t.value)}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', t.icon)}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-display font-semibold text-foreground">{children}</h2>
      {action}
    </div>
  );
}

export default function AdminReportsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.adminRole === 'Super Admin';
  const { loading, data, error, generateReport, dateRange } = useReportData();

  const [period, setPeriod] = useState<ReportPeriod>('monthly');
  const [network, setNetwork] = useState('all');
  const [status, setStatus] = useState('all');
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [specificMonth, setSpecificMonth] = useState(new Date().getMonth());
  const [specificQuarter, setSpecificQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [specificYear, setSpecificYear] = useState(new Date().getFullYear());
  const [activeTab, setActiveTab] = useState('overview');

  if (!isSuperAdmin) {
    return <AdminLayout><Navigate to="/admin" replace /></AdminLayout>;
  }

  const handleGenerate = () => {
    const filters: ReportFilters = {
      period, network, status, customStart, customEnd,
      specificMonth, specificYear, specificQuarter,
    };
    generateReport(filters);
  };

  const periodLabel = dateRange
    ? `${format(dateRange.start, 'dd MMM yyyy')} — ${format(dateRange.end, 'dd MMM yyyy')}`
    : '';

  const handleFullCsv = () => {
    if (!data) return;
    downloadFullReportCsv(data, periodLabel, { network, status });
  };

  const handleFullExcel = () => {
    if (!data) return;
    downloadFullReportExcel(data, periodLabel, { network, status });
  };

  const handlePrint = () => window.print();

  // Section CSV exports
  const exportOrders = () => {
    if (!data) return;
    downloadCsv(data.rawOrders.map(o => ({
      'Order ID': o.short_id, Network: o.network, Bundle: o.bundle_size,
      Phone: o.recipient_phone, Amount: o.total_amount, Cost: o.cost_price,
      Profit: o.total_amount - o.cost_price, Status: o.status, Date: o.created_at,
    })), `orders-detail-${period}.csv`);
  };

  const exportWallet = () => {
    if (!data) return;
    downloadCsv(data.rawTransactions.map(t => ({
      Type: t.type, Amount: t.amount, Description: t.description, Reference: t.reference, Date: t.created_at,
    })), `wallet-transactions-${period}.csv`);
  };

  const exportBalances = () => {
    if (!data) return;
    downloadCsv(data.customerBalances.filter(c => c.opening !== 0 || c.netChange !== 0 || c.balance !== 0).map(c => ({
      Name: c.name, Email: c.email, 'Opening Balance': c.opening.toFixed(2),
      'Net Change': c.netChange.toFixed(2), 'Closing Balance': c.closing.toFixed(2),
      'Current Live Balance': c.balance.toFixed(2),
    })), `customer-balances-${period}.csv`);
  };

  const exportAffiliates = () => {
    if (!data) return;
    downloadCsv(data.affiliateDetails.map(a => ({
      Name: a.name, Email: a.email, Code: a.code, Referrals: a.referrals,
      Orders: a.orders, Revenue: a.revenue, Commission: a.commission, Paid: a.paid, Unpaid: a.unpaid,
    })), `affiliates-${period}.csv`);
  };

  const exportNetworks = () => {
    if (!data) return;
    downloadCsv(data.networkBreakdown.map(n => ({
      Network: n.network, Orders: n.orders, Revenue: n.revenue, Profit: n.profit,
      Delivered: n.delivered, Failed: n.failed, 'Success Rate': `${n.successRate.toFixed(1)}%`,
    })), `networks-${period}.csv`);
  };

  return (
    <AdminLayout>
      <div className="space-y-6 print:space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6 text-primary" />
              Business Reports
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Generate, review, and export comprehensive business reports</p>
          </div>
          {data && (
            <div className="flex items-center gap-2">
              <Button onClick={handleFullExcel} variant="default" size="sm" className="gap-1.5">
                <Download className="w-4 h-4" />
                Download Full Report (Excel)
              </Button>
              <Button onClick={handleFullCsv} variant="outline" size="sm" className="gap-1.5">
                <Download className="w-4 h-4" />
                CSV
              </Button>
              <Button onClick={handlePrint} variant="outline" size="sm" className="gap-1.5">
                <Printer className="w-4 h-4" />
                Print
              </Button>
            </div>
          )}
        </div>

        {/* Print header */}
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">Business Report</h1>
          <p className="text-sm text-muted-foreground">{periodLabel}</p>
          <p className="text-xs text-muted-foreground">
            Network: {network === 'all' ? 'All' : network} · Status: {status === 'all' ? 'All' : status} · Generated: {new Date().toLocaleString('en-GB')}
          </p>
        </div>

        {/* Filters */}
        <Card className="print:hidden">
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Period</label>
                <Select value={period} onValueChange={v => setPeriod(v as ReportPeriod)}>
                  <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Quick Periods</SelectLabel>
                      <SelectItem value="daily">Today</SelectItem>
                      <SelectItem value="weekly">This Week</SelectItem>
                      <SelectItem value="monthly">This Month</SelectItem>
                      <SelectItem value="quarterly">This Quarter</SelectItem>
                      <SelectItem value="yearly">This Year</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Specific Periods</SelectLabel>
                      <SelectItem value="specific_month">Select Month</SelectItem>
                      <SelectItem value="specific_quarter">Select Quarter</SelectItem>
                      <SelectItem value="specific_year">Select Year</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Flexible</SelectLabel>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {period === 'custom' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Start</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="w-[140px] justify-start gap-1.5 text-xs">
                          <CalendarIcon className="w-3.5 h-3.5" />
                          {customStart ? format(customStart, 'dd MMM yyyy') : 'Pick date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={customStart} onSelect={setCustomStart}
                          disabled={d => d > new Date()} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">End</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="w-[140px] justify-start gap-1.5 text-xs">
                          <CalendarIcon className="w-3.5 h-3.5" />
                          {customEnd ? format(customEnd, 'dd MMM yyyy') : 'Pick date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd}
                          disabled={d => d > new Date()} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                </>
              )}

              {period === 'specific_month' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Month</label>
                    <Select value={String(specificMonth)} onValueChange={v => setSpecificMonth(Number(v))}>
                      <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Year</label>
                    <Select value={String(specificYear)} onValueChange={v => setSpecificYear(Number(v))}>
                      <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {period === 'specific_quarter' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Quarter</label>
                    <Select value={String(specificQuarter)} onValueChange={v => setSpecificQuarter(Number(v))}>
                      <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {QUARTERS.map((q, i) => <SelectItem key={i + 1} value={String(i + 1)}>{q}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Year</label>
                    <Select value={String(specificYear)} onValueChange={v => setSpecificYear(Number(v))}>
                      <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {period === 'specific_year' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Year</label>
                  <Select value={String(specificYear)} onValueChange={v => setSpecificYear(Number(v))}>
                    <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Network</label>
                <Select value={network} onValueChange={setNetwork}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NETWORKS.map(n => <SelectItem key={n} value={n}>{n === 'all' ? 'All Networks' : n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleGenerate} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                Generate Report
              </Button>
            </div>
            {periodLabel && (
              <p className="text-xs text-muted-foreground">
                Report period: <span className="font-medium text-foreground">{periodLabel}</span>
                {network !== 'all' && <> · Network: <span className="font-medium text-foreground">{network}</span></>}
                {status !== 'all' && <> · Status: <span className="font-medium text-foreground capitalize">{status}</span></>}
              </p>
            )}
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </CardContent>
          </Card>
        )}

        {/* Report Content */}
        {data && (
          <div className="space-y-6">
            {/* Tabs navigation — hidden when printing */}
            <div className="print:hidden">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                 <TabsList className="flex-wrap h-auto gap-1 bg-muted/60 p-1">
                  <TabsTrigger value="overview" className="text-xs gap-1"><BarChart3 className="w-3.5 h-3.5" />Overview</TabsTrigger>
                  <TabsTrigger value="profit" className="text-xs gap-1"><DollarSign className="w-3.5 h-3.5" />Profit Analysis</TabsTrigger>
                  <TabsTrigger value="orders" className="text-xs gap-1"><ShoppingCart className="w-3.5 h-3.5" />Orders</TabsTrigger>
                  <TabsTrigger value="wallet" className="text-xs gap-1"><Wallet className="w-3.5 h-3.5" />Wallet & Balances</TabsTrigger>
                  <TabsTrigger value="customers" className="text-xs gap-1"><Users className="w-3.5 h-3.5" />Customers</TabsTrigger>
                  <TabsTrigger value="networks" className="text-xs gap-1"><Wifi className="w-3.5 h-3.5" />Networks</TabsTrigger>
                  <TabsTrigger value="affiliates" className="text-xs gap-1"><UserCheck className="w-3.5 h-3.5" />Affiliates</TabsTrigger>
                  <TabsTrigger value="support" className="text-xs gap-1"><LifeBuoy className="w-3.5 h-3.5" />Support</TabsTrigger>
                </TabsList>

                {/* ═══ OVERVIEW ═══ */}
                <TabsContent value="overview" className="space-y-5 mt-4">
                  {/* Key Insights */}
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">Key Insights</p>
                      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
                        <div><span className="text-muted-foreground block text-xs">Total Profit</span><span className="font-bold text-foreground">{formatGHS(data.totalProfit)}</span></div>
                        <div><span className="text-muted-foreground block text-xs">Profit Margin</span><span className="font-bold text-foreground">{data.profitAnalysis.profitMargin.toFixed(1)}%</span></div>
                        <div><span className="text-muted-foreground block text-xs">Best Network</span><span className="font-bold text-foreground">{data.profitAnalysis.byNetwork.length > 0 ? data.profitAnalysis.byNetwork.reduce((a, b) => b.profit > a.profit ? b : a).network : 'N/A'}</span></div>
                        <div><span className="text-muted-foreground block text-xs">Successful Orders</span><span className="font-bold text-foreground">{data.successfulOrders}</span></div>
                        <div><span className="text-muted-foreground block text-xs">Closing Balance</span><span className="font-bold text-foreground">{formatGHS(data.totalClosingBalance)}</span></div>
                      </div>
                    </CardContent>
                  </Card>

                  <SectionHeading>Executive Summary</SectionHeading>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricCard icon={<ShoppingCart className="w-4 h-4" />} label="Total Orders" value={String(data.totalOrders)} />
                    <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Revenue" value={formatGHS(data.totalRevenue)} accent="success" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Profit" value={formatGHS(data.totalProfit)} accent="primary" />
                    <MetricCard icon={<CheckCircle2 className="w-4 h-4" />} label="Completion Rate" value={`${data.completionRate.toFixed(1)}%`} accent="success" />
                    <MetricCard icon={<CheckCircle2 className="w-4 h-4" />} label="Successful" value={String(data.successfulOrders)} accent="success" />
                    <MetricCard icon={<XCircle className="w-4 h-4" />} label="Failed" value={String(data.failedOrders)} accent="destructive" />
                    <MetricCard icon={<Clock className="w-4 h-4" />} label="Pending" value={String(data.pendingOrders)} accent="warning" />
                    <MetricCard icon={<Users className="w-4 h-4" />} label="Active Customers" value={String(data.activeCustomersInPeriod)} accent="teal" />
                    <MetricCard icon={<Wallet className="w-4 h-4" />} label="Total Topups" value={formatGHS(data.totalTopups)} accent="teal" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Total Refunds" value={formatGHS(data.totalRefunds)} accent="warning" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Avg Order Value" value={formatGHS(data.avgOrderValue)} accent="purple" />
                    <MetricCard icon={<Users className="w-4 h-4" />} label="New Customers" value={String(data.newCustomers)} accent="primary" />
                  </div>

                  <Separator />
                  <SectionHeading>Balance Summary</SectionHeading>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <MetricCard icon={<Wallet className="w-4 h-4" />} label="Opening Balance" value={formatGHS(data.totalOpeningBalance)} accent="primary" sub="Start of period" />
                    <MetricCard icon={<Wallet className="w-4 h-4" />} label="Closing Balance" value={formatGHS(data.totalClosingBalance)} accent="success" sub="End of period" />
                    <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Net Change" value={formatGHS(data.totalNetBalanceChange)}
                      accent={data.totalNetBalanceChange >= 0 ? 'success' : 'destructive'}
                      sub={data.totalNetBalanceChange >= 0 ? 'Increase' : 'Decrease'} />
                  </div>

                  {data.dailyTrend.length > 1 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Revenue & Profit Trend</CardTitle></CardHeader>
                      <CardContent>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.dailyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                              <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatGHS(v)]} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Revenue" />
                              <Line type="monotone" dataKey="profit" stroke="hsl(var(--success))" strokeWidth={2} dot={false} name="Profit" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ═══ PROFIT ANALYSIS ═══ */}
                <TabsContent value="profit" className="space-y-5 mt-4">
                  <SectionHeading>Profit Analysis</SectionHeading>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Total Profit" value={formatGHS(data.profitAnalysis.totalProfit)} accent="primary" />
                    <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Revenue" value={formatGHS(data.profitAnalysis.totalRevenue)} accent="success" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Total Cost" value={formatGHS(data.profitAnalysis.totalCost)} accent="destructive" />
                    <MetricCard icon={<BarChart3 className="w-4 h-4" />} label="Profit Margin" value={`${data.profitAnalysis.profitMargin.toFixed(1)}%`} accent="teal" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Avg Daily Profit" value={formatGHS(data.profitAnalysis.avgDailyProfit)} accent="purple" />
                    {data.profitAnalysis.bestPeriod && (
                      <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Best Period" value={formatGHS(data.profitAnalysis.bestPeriod.profit)} accent="success" sub={data.profitAnalysis.bestPeriod.label} />
                    )}
                    {data.profitAnalysis.worstPeriod && (
                      <MetricCard icon={<AlertTriangle className="w-4 h-4" />} label="Lowest Period" value={formatGHS(data.profitAnalysis.worstPeriod.profit)} accent="warning" sub={data.profitAnalysis.worstPeriod.label} />
                    )}
                  </div>

                  {data.profitAnalysis.breakdown.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Profit Breakdown by Period</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Period</TableHead><TableHead className="text-right">Orders</TableHead>
                              <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead>
                              <TableHead className="text-right">Profit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.profitAnalysis.breakdown.map((r, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium">{r.label}</TableCell>
                                <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatGHS(r.revenue)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatGHS(r.cost)}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatGHS(r.profit)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  {data.profitAnalysis.byNetwork.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Profit by Network</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Network</TableHead><TableHead className="text-right">Revenue</TableHead>
                              <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead>
                              <TableHead className="text-right">Revenue %</TableHead><TableHead className="text-right">Profit %</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.profitAnalysis.byNetwork.map((n, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium">{n.network}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatGHS(n.revenue)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatGHS(n.cost)}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatGHS(n.profit)}</TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">{n.revenueShare.toFixed(1)}%</TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">{n.profitShare.toFixed(1)}%</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  {data.profitAnalysis.breakdown.length > 1 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Profit Trend</CardTitle></CardHeader>
                      <CardContent>
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.profitAnalysis.breakdown} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%">
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                              <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatGHS(v)]} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} name="Revenue" />
                              <Bar dataKey="profit" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={28} name="Profit" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ═══ ORDERS ═══ */}
                <TabsContent value="orders" className="space-y-5 mt-4">
                  <SectionHeading action={
                    <Button variant="outline" size="sm" onClick={exportOrders} className="gap-1.5 text-xs"><Download className="w-3.5 h-3.5" />CSV</Button>
                  }>Orders Report</SectionHeading>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricCard icon={<ShoppingCart className="w-4 h-4" />} label="Total Orders" value={String(data.totalOrders)} />
                    <MetricCard icon={<CheckCircle2 className="w-4 h-4" />} label="Delivered" value={String(data.successfulOrders)} accent="success" />
                    <MetricCard icon={<Loader2 className="w-4 h-4" />} label="Processing" value={String(data.processingOrders)} accent="warning" />
                    <MetricCard icon={<XCircle className="w-4 h-4" />} label="Failed" value={String(data.failedOrders)} accent="destructive" />
                  </div>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Status Breakdown</CardTitle></CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader><TableRow><TableHead>Status</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {Object.entries(data.ordersByStatus).sort(([, a], [, b]) => b - a).map(([s, count]) => (
                            <TableRow key={s}>
                              <TableCell className="capitalize font-medium">{s.replace(/_/g, ' ')}</TableCell>
                              <TableCell className="text-right tabular-nums">{count}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{pct(count, data.totalOrders)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {data.dailyTrend.length > 1 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Order Volume</CardTitle></CardHeader>
                      <CardContent>
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.dailyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%">
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                              <RechartsTooltip contentStyle={tooltipStyle} />
                              <Bar dataKey="orders" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} name="Orders" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ═══ WALLET & BALANCES ═══ */}
                <TabsContent value="wallet" className="space-y-5 mt-4">
                  <SectionHeading action={
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={exportBalances} className="gap-1.5 text-xs"><Download className="w-3.5 h-3.5" />Balances</Button>
                      <Button variant="outline" size="sm" onClick={exportWallet} className="gap-1.5 text-xs"><Download className="w-3.5 h-3.5" />Transactions</Button>
                    </div>
                  }>Wallet & Balances</SectionHeading>

                  {/* Historical balance section */}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <MetricCard icon={<Wallet className="w-4 h-4" />} label="Opening Balance (Total)" value={formatGHS(data.totalOpeningBalance)} accent="primary" sub="Start of period" />
                    <MetricCard icon={<Wallet className="w-4 h-4" />} label="Closing Balance (Total)" value={formatGHS(data.totalClosingBalance)} accent="success" sub="End of period" />
                    <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Net Balance Change" value={formatGHS(data.totalNetBalanceChange)}
                      accent={data.totalNetBalanceChange >= 0 ? 'success' : 'destructive'} />
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricCard icon={<Wallet className="w-4 h-4" />} label="Current Live Balance" value={formatGHS(data.totalCurrentBalance)} accent="primary" />
                    <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Topup Amount" value={formatGHS(data.walletTopupAmount)} sub={`${data.walletSuccessTopups} successful`} accent="success" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Admin Credits" value={formatGHS(data.walletAdminCreditAmount)} sub={`${data.walletAdminCredits} txns`} accent="teal" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Admin Debits" value={formatGHS(data.walletAdminDebitAmount)} sub={`${data.walletAdminDebits} txns`} accent="destructive" />
                    <MetricCard icon={<ShoppingCart className="w-4 h-4" />} label="Purchase Deductions" value={formatGHS(data.walletPurchaseAmount)} sub={`${data.walletPurchaseDeductions} orders`} accent="purple" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Refunds" value={formatGHS(data.walletRefundAmount)} accent="warning" />
                    <MetricCard icon={<Users className="w-4 h-4" />} label="Zero Balance" value={String(data.zeroBalanceCount)} sub="customers" accent="warning" />
                    <MetricCard icon={<XCircle className="w-4 h-4" />} label="Failed Topups" value={String(data.walletFailedTopups)} accent="destructive" />
                  </div>

                  {/* Top by opening balance */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Top by Opening Balance</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Opening</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {data.topByOpeningBalance.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatGHS(c.opening)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Top by Closing Balance</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Closing</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {data.topByClosingBalance.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatGHS(c.closing)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Admin adjustments */}
                  {data.adminAdjustedCustomers.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Admin Wallet Adjustments</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Customer</TableHead><TableHead>Type</TableHead>
                              <TableHead className="text-right">Amount</TableHead><TableHead>Description</TableHead><TableHead>Date</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.adminAdjustedCustomers.slice(0, 20).map((a, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-sm">{a.name}</TableCell>
                                <TableCell>
                                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
                                    a.type === 'credit' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'
                                  )}>{a.type}</span>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{formatGHS(a.amount)}</TableCell>
                                <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{a.description}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{format(new Date(a.created_at), 'dd MMM HH:mm')}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  {data.dailyTrend.length > 1 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Topup Trend</CardTitle></CardHeader>
                      <CardContent>
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.dailyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="30%">
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                              <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatGHS(v)]} />
                              <Bar dataKey="topups" fill="hsl(var(--teal))" radius={[4, 4, 0, 0]} maxBarSize={28} name="Topups" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ═══ CUSTOMERS ═══ */}
                <TabsContent value="customers" className="space-y-5 mt-4">
                  <SectionHeading action={
                    <Button variant="outline" size="sm" onClick={exportBalances} className="gap-1.5 text-xs"><Download className="w-3.5 h-3.5" />CSV</Button>
                  }>Customer Summary</SectionHeading>

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <MetricCard icon={<Users className="w-4 h-4" />} label="New Customers" value={String(data.newCustomers)} accent="primary" />
                    <MetricCard icon={<Users className="w-4 h-4" />} label="Active in Period" value={String(data.activeCustomersInPeriod)} accent="success" />
                    <MetricCard icon={<Wallet className="w-4 h-4" />} label="Zero Balance" value={String(data.zeroBalanceCount)} accent="warning" />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Top by Spend</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Spent</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {data.topCustomersBySpend.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatGHS(c.spent)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Top by Order Count</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Orders</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {data.topCustomersByOrders.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{c.orders}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Top by Opening Balance</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Opening</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {data.topByOpeningBalance.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatGHS(c.opening)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Top by Closing Balance</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Closing</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {data.topByClosingBalance.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                                <TableCell className="text-right tabular-nums font-medium">{formatGHS(c.closing)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* ═══ NETWORKS ═══ */}
                <TabsContent value="networks" className="space-y-5 mt-4">
                  <SectionHeading action={
                    <Button variant="outline" size="sm" onClick={exportNetworks} className="gap-1.5 text-xs"><Download className="w-3.5 h-3.5" />CSV</Button>
                  }>Network Breakdown</SectionHeading>

                  {data.networkBreakdown.length === 0 ? (
                    <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">No network data for this period</CardContent></Card>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {data.networkBreakdown.map(n => (
                          <Card key={n.network}>
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{n.network}</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Orders</span><span className="font-medium tabular-nums">{n.orders}</span></div>
                              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Revenue</span><span className="font-medium tabular-nums">{formatGHS(n.revenue)}</span></div>
                              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Profit</span><span className="font-medium tabular-nums">{formatGHS(n.profit)}</span></div>
                              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Success Rate</span>
                                <span className={cn('font-medium tabular-nums', n.successRate >= 90 ? 'text-emerald-600' : n.successRate >= 70 ? 'text-amber-600' : 'text-destructive')}>
                                  {n.successRate.toFixed(1)}%
                                </span>
                              </div>
                              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Failed</span><span className="font-medium tabular-nums text-destructive">{n.failed}</span></div>
                              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Revenue Share</span><span className="font-medium tabular-nums">{n.revenueShare.toFixed(1)}%</span></div>
                              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Profit Share</span><span className="font-medium tabular-nums">{n.profitShare.toFixed(1)}%</span></div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Network Revenue Comparison</CardTitle></CardHeader>
                        <CardContent>
                          <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={data.networkBreakdown} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap="35%">
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="network" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={v => `₵${v}`} />
                                <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatGHS(v)]} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} name="Revenue" />
                                <Bar dataKey="profit" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={40} name="Profit" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  )}
                </TabsContent>

                {/* ═══ AFFILIATES ═══ */}
                <TabsContent value="affiliates" className="space-y-5 mt-4">
                  <SectionHeading action={
                    <Button variant="outline" size="sm" onClick={exportAffiliates} className="gap-1.5 text-xs"><Download className="w-3.5 h-3.5" />CSV</Button>
                  }>Affiliate / Referrals</SectionHeading>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <MetricCard icon={<Users className="w-4 h-4" />} label="Referred Customers" value={String(data.totalReferredCustomers)} accent="primary" />
                    <MetricCard icon={<ShoppingCart className="w-4 h-4" />} label="Referral Orders" value={String(data.totalReferralOrders)} accent="success" />
                    <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Referral Revenue" value={formatGHS(data.totalReferralRevenue)} accent="primary" />
                    <MetricCard icon={<CheckCircle2 className="w-4 h-4" />} label="Conversion Rate" value={`${data.referralConversionRate.toFixed(1)}%`}
                      sub={`${data.referredWithOrders} placed orders`} accent="teal" />
                    <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Total Earnings" value={formatGHS(data.totalAffiliateEarnings)} accent="teal" />
                    <MetricCard icon={<CheckCircle2 className="w-4 h-4" />} label="Paid Out" value={formatGHS(data.totalPaidEarnings)} accent="success" />
                    <MetricCard icon={<Clock className="w-4 h-4" />} label="Unpaid Balance" value={formatGHS(data.totalUnpaidEarnings)} accent="warning" />
                  </div>

                  {data.affiliateDetails.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Affiliate Performance</CardTitle></CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Affiliate</TableHead><TableHead>Code</TableHead>
                                <TableHead className="text-right">Referrals</TableHead><TableHead className="text-right">Orders</TableHead>
                                <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Commission</TableHead>
                                <TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Unpaid</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.affiliateDetails.slice(0, 20).map((a, i) => (
                                <TableRow key={i}>
                                  <TableCell><p className="font-medium text-sm">{a.name}</p><p className="text-xs text-muted-foreground">{a.email}</p></TableCell>
                                  <TableCell className="font-mono text-xs text-primary">{a.code}</TableCell>
                                  <TableCell className="text-right tabular-nums">{a.referrals}</TableCell>
                                  <TableCell className="text-right tabular-nums">{a.orders}</TableCell>
                                  <TableCell className="text-right tabular-nums">{formatGHS(a.revenue)}</TableCell>
                                  <TableCell className="text-right tabular-nums font-medium">{formatGHS(a.commission)}</TableCell>
                                  <TableCell className="text-right tabular-nums text-emerald-600">{formatGHS(a.paid)}</TableCell>
                                  <TableCell className="text-right tabular-nums text-amber-600">{formatGHS(a.unpaid)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ═══ SUPPORT ═══ */}
                <TabsContent value="support" className="space-y-5 mt-4">
                  <SectionHeading>Support Summary</SectionHeading>

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <MetricCard icon={<LifeBuoy className="w-4 h-4" />} label="Tickets Opened" value={String(data.ticketsOpened)} accent="primary" />
                    <MetricCard icon={<CheckCircle2 className="w-4 h-4" />} label="Resolved" value={String(data.ticketsResolved)} accent="success" />
                    <MetricCard icon={<Clock className="w-4 h-4" />} label="Open" value={String(data.ticketsOpen)} accent="warning" />
                  </div>

                  {data.ticketCategories.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Ticket Categories</CardTitle></CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {data.ticketCategories.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium">{c.category}</TableCell>
                                <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">{pct(c.count, data.ticketsOpened)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            {/* Download full report reminder at bottom */}
            <Card className="border-primary/20 bg-primary/5 print:hidden">
              <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Download Full Report</p>
                    <p className="text-xs text-muted-foreground">Export all sections as a professional Excel workbook for accounting review</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={handleFullExcel} size="sm" className="gap-1.5">
                    <Download className="w-4 h-4" />
                    Excel (.xlsx)
                  </Button>
                  <Button onClick={handleFullCsv} variant="outline" size="sm" className="gap-1.5">
                    <Download className="w-4 h-4" />
                    CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && !error && (
          <Card>
            <CardContent className="p-12 text-center space-y-3">
              <FileSpreadsheet className="w-12 h-12 text-muted-foreground/40 mx-auto" />
              <h3 className="text-lg font-semibold text-foreground">No Report Generated</h3>
              <p className="text-sm text-muted-foreground">Select a period and click Generate Report to view business analytics</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
