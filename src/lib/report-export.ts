import { formatGHS } from '@/lib/utils';
import type { ReportData } from '@/hooks/use-report-data';

function escapeCsv(val: unknown): string {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsv).join(','),
    ...rows.map(r => headers.map(h => escapeCsv(r[h])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function pct(num: number, denom: number): string {
  if (denom === 0) return '0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

// ── Full Report CSV Export ──
// Combines all sections into a single multi-section CSV
export function downloadFullReportCsv(data: ReportData, periodLabel: string, filters: { network: string; status: string }) {
  const lines: string[] = [];
  const addLine = (...cells: (string | number)[]) => lines.push(cells.map(escapeCsv).join(','));
  const addBlank = () => lines.push('');

  // ── Report Header ──
  addLine('BUSINESS REPORT');
  addLine('Period', periodLabel);
  addLine('Network Filter', filters.network === 'all' ? 'All Networks' : filters.network);
  addLine('Status Filter', filters.status === 'all' ? 'All Statuses' : filters.status);
  addLine('Generated', new Date().toLocaleString('en-GB'));
  addBlank();

  // ── 1. Executive Summary ──
  addLine('═══ EXECUTIVE SUMMARY ═══');
  addLine('Metric', 'Value');
  addLine('Total Orders', data.totalOrders);
  addLine('Total Revenue', data.totalRevenue.toFixed(2));
  addLine('Total Profit', data.totalProfit.toFixed(2));
  addLine('Successful Orders', data.successfulOrders);
  addLine('Failed Orders', data.failedOrders);
  addLine('Cancelled Orders', data.cancelledOrders);
  addLine('Refunded Orders', data.refundedOrders);
  addLine('Pending Orders', data.pendingOrders);
  addLine('Processing Orders', data.processingOrders);
  addLine('Completion Rate', `${data.completionRate.toFixed(1)}%`);
  addLine('Average Order Value', data.avgOrderValue.toFixed(2));
  addLine('Active Customers', data.activeCustomersInPeriod);
  addLine('New Customers', data.newCustomers);
  addLine('Total Topups', data.totalTopups.toFixed(2));
  addLine('Total Refunds', data.totalRefunds.toFixed(2));
  addBlank();

  // ── 2. Wallet & Balances Summary ──
  addLine('═══ WALLET & BALANCES ═══');
  addLine('Metric', 'Value');
  addLine('Total Opening Balance', data.totalOpeningBalance.toFixed(2));
  addLine('Total Closing Balance', data.totalClosingBalance.toFixed(2));
  addLine('Net Balance Change', data.totalNetBalanceChange.toFixed(2));
  addLine('Total Current Live Balance', data.totalCurrentBalance.toFixed(2));
  addLine('Successful Topups', `${data.walletSuccessTopups} (${data.walletTopupAmount.toFixed(2)})`);
  addLine('Failed Topups', data.walletFailedTopups);
  addLine('Admin Credits', `${data.walletAdminCredits} (${data.walletAdminCreditAmount.toFixed(2)})`);
  addLine('Admin Debits', `${data.walletAdminDebits} (${data.walletAdminDebitAmount.toFixed(2)})`);
  addLine('Purchase Deductions', `${data.walletPurchaseDeductions} (${data.walletPurchaseAmount.toFixed(2)})`);
  addLine('Refunds to Wallet', data.walletRefundAmount.toFixed(2));
  addLine('Zero Balance Customers', data.zeroBalanceCount);
  addBlank();

  // ── 3. Orders by Status ──
  addLine('═══ ORDERS BY STATUS ═══');
  addLine('Status', 'Count', '% of Total');
  Object.entries(data.ordersByStatus).sort(([, a], [, b]) => b - a).forEach(([status, count]) => {
    addLine(status, count, pct(count, data.totalOrders));
  });
  addBlank();

  // ── 4. Network Breakdown ──
  addLine('═══ NETWORK BREAKDOWN ═══');
  addLine('Network', 'Orders', 'Revenue', 'Profit', 'Delivered', 'Failed', 'Success Rate');
  data.networkBreakdown.forEach(n => {
    addLine(n.network, n.orders, n.revenue.toFixed(2), n.profit.toFixed(2), n.delivered, n.failed, `${n.successRate.toFixed(1)}%`);
  });
  addBlank();

  // ── 5. Top Customers by Spend ──
  addLine('═══ TOP CUSTOMERS BY SPEND ═══');
  addLine('Name', 'Email', 'Amount Spent');
  data.topCustomersBySpend.forEach(c => addLine(c.name, c.email, c.spent.toFixed(2)));
  addBlank();

  // ── 6. Top Customers by Opening Balance ──
  addLine('═══ TOP CUSTOMERS BY OPENING BALANCE ═══');
  addLine('Name', 'Email', 'Opening Balance');
  data.topByOpeningBalance.forEach(c => addLine(c.name, c.email, c.opening.toFixed(2)));
  addBlank();

  // ── 7. Top Customers by Closing Balance ──
  addLine('═══ TOP CUSTOMERS BY CLOSING BALANCE ═══');
  addLine('Name', 'Email', 'Closing Balance');
  data.topByClosingBalance.forEach(c => addLine(c.name, c.email, c.closing.toFixed(2)));
  addBlank();

  // ── 8. Customer Balances Detail ──
  addLine('═══ ALL CUSTOMER BALANCES ═══');
  addLine('Name', 'Email', 'Opening Balance', 'Net Change', 'Closing Balance', 'Current Live Balance');
  data.customerBalances.filter(c => c.opening !== 0 || c.netChange !== 0 || c.balance !== 0).forEach(c => {
    addLine(c.name, c.email, c.opening.toFixed(2), c.netChange.toFixed(2), c.closing.toFixed(2), c.balance.toFixed(2));
  });
  addBlank();

  // ── 9. Admin Wallet Adjustments ──
  if (data.adminAdjustedCustomers.length > 0) {
    addLine('═══ ADMIN WALLET ADJUSTMENTS ═══');
    addLine('Customer', 'Email', 'Type', 'Amount', 'Description', 'Date');
    data.adminAdjustedCustomers.forEach(a => {
      addLine(a.name, a.email, a.type, a.amount.toFixed(2), a.description, a.created_at);
    });
    addBlank();
  }

  // ── 10. Affiliate / Referrals ──
  addLine('═══ AFFILIATE / REFERRALS SUMMARY ═══');
  addLine('Metric', 'Value');
  addLine('Total Referred Customers', data.totalReferredCustomers);
  addLine('Referred Who Placed Orders', data.referredWithOrders);
  addLine('Referral Conversion Rate', `${data.referralConversionRate.toFixed(1)}%`);
  addLine('Referral-Linked Orders', data.totalReferralOrders);
  addLine('Referral Revenue', data.totalReferralRevenue.toFixed(2));
  addLine('Total Affiliate Earnings', data.totalAffiliateEarnings.toFixed(2));
  addLine('Total Paid', data.totalPaidEarnings.toFixed(2));
  addLine('Total Unpaid', data.totalUnpaidEarnings.toFixed(2));
  addBlank();

  if (data.affiliateDetails.length > 0) {
    addLine('═══ AFFILIATE PERFORMANCE DETAIL ═══');
    addLine('Affiliate', 'Email', 'Code', 'Referrals', 'Orders', 'Revenue', 'Commission', 'Paid', 'Unpaid');
    data.affiliateDetails.forEach(a => {
      addLine(a.name, a.email, a.code, a.referrals, a.orders, a.revenue.toFixed(2), a.commission.toFixed(2), a.paid.toFixed(2), a.unpaid.toFixed(2));
    });
    addBlank();
  }

  // ── 11. Support ──
  addLine('═══ SUPPORT SUMMARY ═══');
  addLine('Tickets Opened', data.ticketsOpened);
  addLine('Tickets Resolved', data.ticketsResolved);
  addLine('Tickets Open', data.ticketsOpen);
  addBlank();
  if (data.ticketCategories.length > 0) {
    addLine('Category', 'Count', '% of Total');
    data.ticketCategories.forEach(c => addLine(c.category, c.count, pct(c.count, data.ticketsOpened)));
    addBlank();
  }

  // ── 12. Detailed Orders ──
  addLine('═══ DETAILED ORDERS ═══');
  addLine('Order ID', 'Network', 'Bundle', 'Phone', 'Amount', 'Cost', 'Profit', 'Status', 'Date');
  data.rawOrders.forEach(o => {
    addLine(o.short_id, o.network, o.bundle_size, o.recipient_phone, o.total_amount.toFixed(2), o.cost_price.toFixed(2), (o.total_amount - o.cost_price).toFixed(2), o.status, o.created_at);
  });
  addBlank();

  // ── 13. Detailed Wallet Transactions ──
  addLine('═══ DETAILED WALLET TRANSACTIONS ═══');
  addLine('Type', 'Amount', 'Description', 'Reference', 'Date');
  data.rawTransactions.forEach(t => {
    addLine(t.type, t.amount.toFixed(2), t.description, t.reference, t.created_at);
  });

  // ── 14. Daily Trend ──
  addBlank();
  addLine('═══ DAILY TREND ═══');
  addLine('Date', 'Orders', 'Revenue', 'Profit', 'Topups');
  data.dailyTrend.forEach(d => {
    addLine(d.date, d.orders, d.revenue.toFixed(2), d.profit.toFixed(2), d.topups.toFixed(2));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `full-business-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
