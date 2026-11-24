import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { endOfDay } from 'date-fns';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom' | 'specific_month' | 'specific_quarter' | 'specific_year';

export interface ReportFilters {
  period: ReportPeriod;
  customStart?: Date;
  customEnd?: Date;
  specificMonth?: number; // 0-11
  specificYear?: number;
  specificQuarter?: number; // 1-4
  network: string;
  status: string;
}

export interface ProfitPeriodRow {
  label: string;
  orders: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface ProfitAnalysis {
  totalProfit: number;
  totalRevenue: number;
  totalCost: number;
  profitMargin: number;
  avgDailyProfit: number;
  bestPeriod: ProfitPeriodRow | null;
  worstPeriod: ProfitPeriodRow | null;
  breakdown: ProfitPeriodRow[];
  byNetwork: { network: string; revenue: number; cost: number; profit: number; revenueShare: number; profitShare: number }[];
}

export interface ReportData {
  totalOrders: number;
  totalRevenue: number;
  totalProfit: number;
  successfulOrders: number;
  failedOrders: number;
  cancelledOrders: number;
  refundedOrders: number;
  pendingOrders: number;
  processingOrders: number;
  avgOrderValue: number;
  activeCustomersInPeriod: number;
  totalTopups: number;
  totalRefunds: number;
  completionRate: number;

  ordersByStatus: Record<string, number>;

  networkBreakdown: {
    network: string;
    orders: number;
    revenue: number;
    profit: number;
    delivered: number;
    failed: number;
    successRate: number;
    revenueShare: number;
    profitShare: number;
  }[];

  // Wallet
  walletTopups: number;
  walletTopupAmount: number;
  walletSuccessTopups: number;
  walletFailedTopups: number;
  walletAdminCredits: number;
  walletAdminCreditAmount: number;
  walletAdminDebits: number;
  walletAdminDebitAmount: number;
  walletPurchaseDeductions: number;
  walletPurchaseAmount: number;
  walletRefundAmount: number;
  totalCurrentBalance: number;

  // Historical balance
  totalOpeningBalance: number;
  totalClosingBalance: number;
  totalNetBalanceChange: number;
  topByOpeningBalance: { id: string; name: string; email: string; opening: number }[];
  topByClosingBalance: { id: string; name: string; email: string; closing: number }[];

  customerBalances: { id: string; name: string; email: string; balance: number; netChange: number; opening: number; closing: number }[];
  zeroBalanceCount: number;
  adminAdjustedCustomers: { id: string; name: string; email: string; type: string; amount: number; description: string; created_at: string }[];

  newCustomers: number;
  topCustomersBySpend: { name: string; email: string; spent: number }[];
  topCustomersByOrders: { name: string; email: string; orders: number }[];
  topCustomersByBalance: { name: string; email: string; balance: number }[];

  // Affiliate
  totalReferredCustomers: number;
  totalReferralOrders: number;
  totalReferralRevenue: number;
  totalAffiliateEarnings: number;
  totalPaidEarnings: number;
  totalUnpaidEarnings: number;
  referralConversionRate: number;
  referredWithOrders: number;
  affiliateDetails: {
    name: string;
    email: string;
    code: string;
    referrals: number;
    orders: number;
    revenue: number;
    commission: number;
    paid: number;
    unpaid: number;
  }[];

  // Support
  ticketsOpened: number;
  ticketsResolved: number;
  ticketsOpen: number;
  ticketCategories: { category: string; count: number }[];

  dailyTrend: { date: string; revenue: number; profit: number; orders: number; topups: number }[];

  profitAnalysis: ProfitAnalysis;

  rawOrders: any[];
  rawTransactions: any[];
}

function getDateRange(filters: ReportFilters): { start: Date; end: Date } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (filters.period) {
    case 'daily':
      return { start: todayStart, end: endOfDay(now) };
    case 'weekly': {
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      return { start: weekStart, end: endOfDay(now) };
    }
    case 'monthly': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: monthStart, end: endOfDay(now) };
    }
    case 'quarterly': {
      const q = Math.floor(now.getMonth() / 3);
      const qStart = new Date(now.getFullYear(), q * 3, 1);
      return { start: qStart, end: endOfDay(now) };
    }
    case 'yearly': {
      const yearStart = new Date(now.getFullYear(), 0, 1);
      return { start: yearStart, end: endOfDay(now) };
    }
    case 'specific_month': {
      const y = filters.specificYear ?? now.getFullYear();
      const m = filters.specificMonth ?? now.getMonth();
      const mStart = new Date(y, m, 1);
      const mEnd = new Date(y, m + 1, 0); // last day of month
      return { start: mStart, end: endOfDay(mEnd) };
    }
    case 'specific_quarter': {
      const y = filters.specificYear ?? now.getFullYear();
      const q = (filters.specificQuarter ?? 1) - 1; // 0-indexed
      const qStart = new Date(y, q * 3, 1);
      const qEnd = new Date(y, q * 3 + 3, 0); // last day of quarter
      return { start: qStart, end: endOfDay(qEnd) };
    }
    case 'specific_year': {
      const y = filters.specificYear ?? now.getFullYear();
      const yStart = new Date(y, 0, 1);
      const yEnd = new Date(y, 11, 31);
      return { start: yStart, end: endOfDay(yEnd) };
    }
    case 'custom':
      return {
        start: filters.customStart || todayStart,
        end: endOfDay(filters.customEnd || now),
      };
    default:
      return { start: todayStart, end: endOfDay(now) };
  }
}

export function useReportData() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null);

  const generateReport = useCallback(async (filters: ReportFilters) => {
    setLoading(true);
    setError(null);
    const range = getDateRange(filters);
    setDateRange(range);
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();

    try {
      // Fetch all data in parallel — including ALL wallet transactions for historical balance
      const [
        ordersRes,
        customersRes,
        topupsRes,
        walletTxInPeriodRes,
        walletTxBeforePeriodRes,
        supportRes,
        withdrawalsRes,
      ] = await Promise.all([
        supabase.from('orders_admin' as any)
          .select('id, network, bundle_size, total_amount, cost_price, status, created_at, customer_id, recipient_phone, short_id, provider_name')
          .gte('created_at', startISO)
          .lte('created_at', endISO)
          .order('created_at'),
        supabase.from('customers')
          .select('id, full_name, email, wallet_balance, status, created_at, affiliate_code, referred_by, total_commission, available_commission')
          .not('status', 'in', '("deleted","archived")'),
        supabase.from('topups')
          .select('id, amount, status, method, created_at, customer_id')
          .gte('created_at', startISO)
          .lte('created_at', endISO),
        supabase.from('wallet_transactions')
          .select('id, amount, type, description, customer_id, admin_id, created_at, reference')
          .gte('created_at', startISO)
          .lte('created_at', endISO),
        // All wallet transactions BEFORE the period start — for opening balance calculation
        supabase.from('wallet_transactions')
          .select('amount, type, customer_id')
          .lt('created_at', startISO),
        supabase.from('support_tickets')
          .select('id, status, category, created_at')
          .gte('created_at', startISO)
          .lte('created_at', endISO),
        supabase.from('affiliate_withdrawals')
          .select('id, amount, status, customer_id, created_at')
          .eq('status', 'approved'),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (customersRes.error) throw customersRes.error;

      // Fold AFA registrations in as synthetic order rows so AFA profit
      // contributes to revenue, profit, network breakdown, daily trend, etc.
      const { fetchAfaAsOrders } = await import('@/lib/afa-profit');
      const afaSynthetic = await fetchAfaAsOrders({ startISO, endISO });

      const orders = [
        ...((ordersRes.data || []) as any[]).map((o: any) => ({
          ...o,
          total_amount: Number(o.total_amount),
          cost_price: Number(o.cost_price || 0),
        })),
        ...afaSynthetic,
      ];
      const customers = (customersRes.data || []).map(c => ({
        ...c,
        wallet_balance: Number(c.wallet_balance),
        total_commission: Number(c.total_commission),
        available_commission: Number(c.available_commission),
      }));
      const topups = (topupsRes.data || []).map(t => ({ ...t, amount: Number(t.amount) }));
      const walletTx = (walletTxInPeriodRes.data || []).map(t => ({ ...t, amount: Number(t.amount) }));
      const walletTxBefore = (walletTxBeforePeriodRes.data || []).map(t => ({ ...t, amount: Number(t.amount) }));
      const tickets = supportRes.data || [];
      const withdrawals = (withdrawalsRes.data || []).map(w => ({ ...w, amount: Number(w.amount) }));

      // ── Historical balance calculation ──
      // Opening balance per customer = sum of all wallet tx before period
      const openingMap: Record<string, number> = {};
      walletTxBefore.forEach(t => {
        if (!openingMap[t.customer_id]) openingMap[t.customer_id] = 0;
        openingMap[t.customer_id] += t.type === 'credit' ? t.amount : -t.amount;
      });

      // Net change per customer during the period
      const periodChangeMap: Record<string, number> = {};
      walletTx.forEach(t => {
        if (!periodChangeMap[t.customer_id]) periodChangeMap[t.customer_id] = 0;
        periodChangeMap[t.customer_id] += t.type === 'credit' ? t.amount : -t.amount;
      });

      // Build customer balances with opening/closing
      const customerBalances = customers.map(c => {
        const opening = openingMap[c.id] || 0;
        const netChange = periodChangeMap[c.id] || 0;
        const closing = opening + netChange;
        return {
          id: c.id,
          name: c.full_name,
          email: c.email,
          balance: c.wallet_balance,
          netChange,
          opening,
          closing,
        };
      });

      const totalOpeningBalance = customerBalances.reduce((s, c) => s + c.opening, 0);
      const totalNetBalanceChange = customerBalances.reduce((s, c) => s + c.netChange, 0);
      const totalClosingBalance = totalOpeningBalance + totalNetBalanceChange;

      const topByOpeningBalance = [...customerBalances].sort((a, b) => b.opening - a.opening).slice(0, 10)
        .map(c => ({ id: c.id, name: c.name, email: c.email, opening: c.opening }));
      const topByClosingBalance = [...customerBalances].sort((a, b) => b.closing - a.closing).slice(0, 10)
        .map(c => ({ id: c.id, name: c.name, email: c.email, closing: c.closing }));

      // Apply network filter
      const filteredOrders = filters.network === 'all'
        ? orders
        : orders.filter(o => o.network === filters.network);

      // Apply status filter
      const statusOrders = filters.status === 'all'
        ? filteredOrders
        : filteredOrders.filter(o => o.status === filters.status);

      // Executive summary
      const delivered = statusOrders.filter(o => o.status === 'delivered');
      const totalRevenue = delivered.reduce((s, o) => s + o.total_amount, 0);
      const totalProfit = delivered.reduce((s, o) => s + (o.total_amount - o.cost_price), 0);
      const failed = statusOrders.filter(o => o.status === 'failed').length;
      const cancelled = statusOrders.filter(o => ['customer_cancelled', 'cancelled_before_processing'].includes(o.status)).length;
      const refunded = statusOrders.filter(o => o.status === 'refunded' || o.status === 'rejected').length;
      const pending = statusOrders.filter(o => ['pending', 'pending_confirmation', 'pending_manual'].includes(o.status)).length;
      const processing = statusOrders.filter(o => o.status === 'processing').length;

      const activeCustomerIds = new Set(statusOrders.map(o => o.customer_id).filter(Boolean));

      const ordersByStatus: Record<string, number> = {};
      statusOrders.forEach(o => { ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1; });

      // Network breakdown
      const networkMap: Record<string, { orders: number; revenue: number; profit: number; delivered: number; failed: number }> = {};
      statusOrders.forEach(o => {
        if (!networkMap[o.network]) networkMap[o.network] = { orders: 0, revenue: 0, profit: 0, delivered: 0, failed: 0 };
        const n = networkMap[o.network];
        n.orders++;
        if (o.status === 'delivered') { n.revenue += o.total_amount; n.profit += o.total_amount - o.cost_price; n.delivered++; }
        if (o.status === 'failed') n.failed++;
      });
      const totalNetworkRevenue = Object.values(networkMap).reduce((s, d) => s + d.revenue, 0);
      const totalNetworkProfit = Object.values(networkMap).reduce((s, d) => s + d.profit, 0);
      const networkBreakdown = Object.entries(networkMap).map(([network, d]) => ({
        network, ...d, successRate: d.orders > 0 ? (d.delivered / d.orders) * 100 : 0,
        revenueShare: totalNetworkRevenue > 0 ? (d.revenue / totalNetworkRevenue) * 100 : 0,
        profitShare: totalNetworkProfit > 0 ? (d.profit / totalNetworkProfit) * 100 : 0,
      }));

      // Wallet metrics
      const approvedTopups = topups.filter(t => t.status === 'approved');
      const failedTopups = topups.filter(t => t.status === 'rejected' || t.status === 'failed');
      const adminCredits = walletTx.filter(t => t.type === 'credit' && t.admin_id);
      const adminDebits = walletTx.filter(t => t.type === 'debit' && t.admin_id);
      const purchaseDeductions = walletTx.filter(t => t.type === 'debit' && !t.admin_id);
      const refundTx = walletTx.filter(t => t.type === 'credit' && t.description?.toLowerCase().includes('refund'));

      const zeroBalanceCount = customers.filter(c => c.wallet_balance <= 0).length;

      const adminAdjusted = walletTx
        .filter(t => t.admin_id)
        .map(t => {
          const cust = customers.find(c => c.id === t.customer_id);
          return { id: t.customer_id, name: cust?.full_name || 'Unknown', email: cust?.email || '', type: t.type, amount: t.amount, description: t.description || '', created_at: t.created_at };
        });

      const newCustomers = customers.filter(c => {
        const d = new Date(c.created_at);
        return d >= range.start && d <= range.end;
      }).length;

      // Top customers
      const customerOrderMap: Record<string, { spent: number; count: number; name: string; email: string }> = {};
      delivered.forEach(o => {
        if (!o.customer_id) return;
        if (!customerOrderMap[o.customer_id]) {
          const c = customers.find(cc => cc.id === o.customer_id);
          customerOrderMap[o.customer_id] = { spent: 0, count: 0, name: c?.full_name || 'Unknown', email: c?.email || '' };
        }
        customerOrderMap[o.customer_id].spent += o.total_amount;
        customerOrderMap[o.customer_id].count++;
      });
      const topBySpend = Object.values(customerOrderMap).sort((a, b) => b.spent - a.spent).slice(0, 10);
      const topByOrders = Object.values(customerOrderMap).sort((a, b) => b.count - a.count).slice(0, 10);
      const topByBalance = [...customerBalances].sort((a, b) => b.balance - a.balance).slice(0, 10);

      // Affiliate / Referrals
      const referrers = customers.filter(c => c.affiliate_code);
      const referredCustomers = customers.filter(c => c.referred_by);
      const affiliateMap: Record<string, {
        name: string; email: string; code: string;
        referrals: number; orders: number; revenue: number;
        commission: number; paid: number; unpaid: number;
      }> = {};

      referrers.forEach(r => {
        const refs = referredCustomers.filter(c => c.referred_by === r.affiliate_code);
        const refIds = new Set(refs.map(c => c.id));
        const refOrders = delivered.filter(o => o.customer_id && refIds.has(o.customer_id));
        const paid = withdrawals.filter(w => w.customer_id === r.id).reduce((s, w) => s + w.amount, 0);

        if (refs.length > 0 || r.total_commission > 0) {
          affiliateMap[r.id] = {
            name: r.full_name, email: r.email, code: r.affiliate_code,
            referrals: refs.length, orders: refOrders.length,
            revenue: refOrders.reduce((s, o) => s + o.total_amount, 0),
            commission: r.total_commission, paid, unpaid: r.available_commission,
          };
        }
      });

      const affiliateDetails = Object.values(affiliateMap).sort((a, b) => b.commission - a.commission);
      const totalReferralOrders = affiliateDetails.reduce((s, a) => s + a.orders, 0);
      const totalReferralRevenue = affiliateDetails.reduce((s, a) => s + a.revenue, 0);
      const totalAffiliateEarnings = affiliateDetails.reduce((s, a) => s + a.commission, 0);
      const totalPaidEarnings = affiliateDetails.reduce((s, a) => s + a.paid, 0);

      // Referral conversion
      const referredWithOrders = referredCustomers.filter(c => delivered.some(o => o.customer_id === c.id)).length;
      const referralConversionRate = referredCustomers.length > 0 ? (referredWithOrders / referredCustomers.length) * 100 : 0;

      // Support
      const resolved = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
      const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
      const catMap: Record<string, number> = {};
      tickets.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + 1; });
      const ticketCategories = Object.entries(catMap).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);

      // Daily trend
      const trendMap: Record<string, { revenue: number; profit: number; orders: number; topups: number }> = {};
      statusOrders.forEach(o => {
        const day = o.created_at.slice(0, 10);
        if (!trendMap[day]) trendMap[day] = { revenue: 0, profit: 0, orders: 0, topups: 0 };
        trendMap[day].orders++;
        if (o.status === 'delivered') { trendMap[day].revenue += o.total_amount; trendMap[day].profit += o.total_amount - o.cost_price; }
      });
      approvedTopups.forEach(t => {
        const day = t.created_at.slice(0, 10);
        if (!trendMap[day]) trendMap[day] = { revenue: 0, profit: 0, orders: 0, topups: 0 };
        trendMap[day].topups += t.amount;
      });
      const dailyTrend = Object.entries(trendMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...d }));

      const totalCurrentBalance = customers.reduce((s, c) => s + c.wallet_balance, 0);

      // ── Profit Analysis ──
      const totalCost = delivered.reduce((s, o) => s + o.cost_price, 0);
      const daysInRange = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)));

      // Determine grouping based on period type
      const getGroupKey = (dateStr: string): string => {
        const d = new Date(dateStr);
        const periodType = filters.period;
        if (['daily'].includes(periodType)) return dateStr.slice(11, 16); // HH:MM
        if (['weekly', 'monthly', 'specific_month', 'custom'].includes(periodType) && daysInRange <= 45) return dateStr.slice(0, 10);
        if (['quarterly', 'specific_quarter'].includes(periodType)) {
          const wk = Math.ceil(((d.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24) + 1) / 7);
          return `Week ${wk}`;
        }
        // yearly / specific_year → by month
        return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      };

      const profitGroupMap: Record<string, ProfitPeriodRow> = {};
      delivered.forEach(o => {
        const key = getGroupKey(o.created_at);
        if (!profitGroupMap[key]) profitGroupMap[key] = { label: key, orders: 0, revenue: 0, cost: 0, profit: 0 };
        profitGroupMap[key].orders++;
        profitGroupMap[key].revenue += o.total_amount;
        profitGroupMap[key].cost += o.cost_price;
        profitGroupMap[key].profit += o.total_amount - o.cost_price;
      });
      const profitBreakdown = Object.values(profitGroupMap).sort((a, b) => a.label.localeCompare(b.label));
      const bestPeriod = profitBreakdown.length > 0 ? profitBreakdown.reduce((best, r) => r.profit > best.profit ? r : best) : null;
      const worstPeriod = profitBreakdown.length > 0 ? profitBreakdown.reduce((worst, r) => r.profit < worst.profit ? r : worst) : null;

      const profitByNetwork = networkBreakdown.map(n => ({
        network: n.network, revenue: n.revenue, cost: n.revenue - n.profit, profit: n.profit,
        revenueShare: n.revenueShare, profitShare: n.profitShare,
      }));

      const profitAnalysis: ProfitAnalysis = {
        totalProfit, totalRevenue, totalCost,
        profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
        avgDailyProfit: totalProfit / daysInRange,
        bestPeriod, worstPeriod,
        breakdown: profitBreakdown,
        byNetwork: profitByNetwork,
      };

      setData({
        totalOrders: statusOrders.length, totalRevenue, totalProfit,
        successfulOrders: delivered.length, failedOrders: failed, cancelledOrders: cancelled,
        refundedOrders: refunded, pendingOrders: pending, processingOrders: processing,
        avgOrderValue: delivered.length > 0 ? totalRevenue / delivered.length : 0,
        activeCustomersInPeriod: activeCustomerIds.size,
        totalTopups: approvedTopups.reduce((s, t) => s + t.amount, 0),
        totalRefunds: refundTx.reduce((s, t) => s + t.amount, 0),
        completionRate: statusOrders.length > 0 ? (delivered.length / statusOrders.length) * 100 : 0,
        ordersByStatus, networkBreakdown,
        walletTopups: topups.length,
        walletTopupAmount: approvedTopups.reduce((s, t) => s + t.amount, 0),
        walletSuccessTopups: approvedTopups.length, walletFailedTopups: failedTopups.length,
        walletAdminCredits: adminCredits.length,
        walletAdminCreditAmount: adminCredits.reduce((s, t) => s + t.amount, 0),
        walletAdminDebits: adminDebits.length,
        walletAdminDebitAmount: adminDebits.reduce((s, t) => s + t.amount, 0),
        walletPurchaseDeductions: purchaseDeductions.length,
        walletPurchaseAmount: purchaseDeductions.reduce((s, t) => s + t.amount, 0),
        walletRefundAmount: refundTx.reduce((s, t) => s + t.amount, 0),
        totalCurrentBalance,
        totalOpeningBalance, totalClosingBalance, totalNetBalanceChange,
        topByOpeningBalance, topByClosingBalance,
        customerBalances, zeroBalanceCount, adminAdjustedCustomers: adminAdjusted,
        newCustomers,
        topCustomersBySpend: topBySpend,
        topCustomersByOrders: topByOrders.map(c => ({ name: c.name, email: c.email, orders: c.count })),
        topCustomersByBalance: topByBalance,
        totalReferredCustomers: referredCustomers.length,
        totalReferralOrders, totalReferralRevenue, totalAffiliateEarnings,
        totalPaidEarnings, totalUnpaidEarnings: totalAffiliateEarnings - totalPaidEarnings,
        referralConversionRate, referredWithOrders,
        affiliateDetails,
        ticketsOpened: tickets.length, ticketsResolved: resolved, ticketsOpen: openTickets, ticketCategories,
        dailyTrend,
        rawOrders: statusOrders, rawTransactions: walletTx,
        profitAnalysis,
      });
    } catch (e: any) {
      console.error('Report generation error', e);
      setError(e.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, generateReport, dateRange };
}
