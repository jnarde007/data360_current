import ExcelJS from 'exceljs';
import type { ReportData } from '@/hooks/use-report-data';
import { pct } from '@/lib/report-export';

// ── Formatting helpers ──

const GHS = (n: number) => `GHS ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctStr = (n: number) => `${n.toFixed(1)}%`;

const COLORS = {
  primary: 'FF1A3A5C',     // dark navy
  primaryFg: 'FFFFFFFF',
  sectionBg: 'FFE8EDF2',
  sectionFg: 'FF1A3A5C',
  headerBg: 'FFF3F5F8',
  headerFg: 'FF333333',
  border: 'FFD0D5DD',
  subtle: 'FF6B7280',
  white: 'FFFFFFFF',
};

const fontTitle: Partial<ExcelJS.Font> = { bold: true, size: 16, color: { argb: COLORS.primary } };
const fontSection: Partial<ExcelJS.Font> = { bold: true, size: 12, color: { argb: COLORS.sectionFg } };
const fontSubsection: Partial<ExcelJS.Font> = { bold: true, size: 10, color: { argb: COLORS.headerFg } };
const fontHeader: Partial<ExcelJS.Font> = { bold: true, size: 10, color: { argb: COLORS.headerFg } };
const fontNormal: Partial<ExcelJS.Font> = { size: 10, color: { argb: 'FF222222' } };
const fontSubtle: Partial<ExcelJS.Font> = { size: 9, color: { argb: COLORS.subtle } };

const borderThin: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: COLORS.border } },
};

function setColWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function addTitle(ws: ExcelJS.Worksheet, row: number, text: string, cols: number) {
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = fontTitle;
  if (cols > 1) ws.mergeCells(row, 1, row, cols);
}

function addSection(ws: ExcelJS.Worksheet, row: number, text: string, cols: number) {
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = fontSection;
  for (let c = 1; c <= cols; c++) {
    ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.sectionBg } };
    ws.getCell(row, c).border = borderThin;
  }
  if (cols > 1) ws.mergeCells(row, 1, row, cols);
}

function addHeaders(ws: ExcelJS.Worksheet, row: number, headers: string[]) {
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.font = fontHeader;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    cell.border = borderThin;
    cell.alignment = { vertical: 'middle' };
  });
}

const DATE_FMT = 'DD MMM YYYY, hh:mm AM/PM';

function parseDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function addRow(ws: ExcelJS.Worksheet, row: number, values: (string | number | Date)[], opts?: { bold?: boolean; rightAlignFrom?: number; dateCols?: number[] }) {
  values.forEach((v, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = v;
    cell.font = opts?.bold ? fontSubsection : fontNormal;
    if (opts?.dateCols?.includes(i)) {
      cell.numFmt = DATE_FMT;
      cell.alignment = { horizontal: 'left' };
    } else if (opts?.rightAlignFrom !== undefined && i >= opts.rightAlignFrom) {
      cell.alignment = { horizontal: 'right' };
    }
  });
}

function addMetricRow(ws: ExcelJS.Worksheet, row: number, label: string, value: string | number) {
  const lc = ws.getCell(row, 1);
  lc.value = label;
  lc.font = fontNormal;
  const vc = ws.getCell(row, 2);
  vc.value = value;
  vc.font = { ...fontNormal, bold: true };
  vc.alignment = { horizontal: 'right' };
}

// ── Main export function ──

export async function downloadFullReportExcel(data: ReportData, periodLabel: string, filters: { network: string; status: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Data360';
  wb.created = new Date();
  const now = new Date().toLocaleString('en-GB');
  const pa = data.profitAnalysis;

  // ── 1. Summary ──
  {
    const ws = wb.addWorksheet('Summary');
    setColWidths(ws, [32, 26]);
    ws.views = [{ state: 'frozen', ySplit: 0, xSplit: 0 }];

    let r = 1;
    addTitle(ws, r, 'BUSINESS REPORT', 2); r += 1;
    ws.getCell(r, 1).value = 'Data360 Platform'; ws.getCell(r, 1).font = fontSubtle; r += 2;

    addSection(ws, r, 'REPORT DETAILS', 2); r += 1;
    addMetricRow(ws, r, 'Report Period', periodLabel); r++;
    addMetricRow(ws, r, 'Network Filter', filters.network === 'all' ? 'All Networks' : filters.network); r++;
    addMetricRow(ws, r, 'Status Filter', filters.status === 'all' ? 'All Statuses' : filters.status); r++;
    addMetricRow(ws, r, 'Generated', now); r += 2;

    addSection(ws, r, 'KEY INSIGHTS', 2); r += 1;
    addMetricRow(ws, r, 'Total Profit', GHS(data.totalProfit)); r++;
    addMetricRow(ws, r, 'Profit Margin', pctStr(pa.profitMargin)); r++;
    addMetricRow(ws, r, 'Best Network', pa.byNetwork.length > 0 ? pa.byNetwork.reduce((a, b) => b.profit > a.profit ? b : a).network : 'N/A'); r++;
    addMetricRow(ws, r, 'Total Successful Orders', data.successfulOrders); r++;
    addMetricRow(ws, r, 'Total Revenue', GHS(data.totalRevenue)); r++;
    addMetricRow(ws, r, 'Referral Revenue', GHS(data.totalReferralRevenue)); r++;
    addMetricRow(ws, r, 'Closing Wallet Balance', GHS(data.totalClosingBalance)); r += 2;

    addSection(ws, r, 'EXECUTIVE SUMMARY', 2); r += 1;
    addHeaders(ws, r, ['Metric', 'Value']); r++;
    const summaryRows: [string, string | number][] = [
      ['Total Orders', data.totalOrders],
      ['Total Revenue', GHS(data.totalRevenue)],
      ['Total Profit', GHS(data.totalProfit)],
      ['Successful Orders', data.successfulOrders],
      ['Failed Orders', data.failedOrders],
      ['Cancelled Orders', data.cancelledOrders],
      ['Refunded Orders', data.refundedOrders],
      ['Pending Orders', data.pendingOrders],
      ['Processing Orders', data.processingOrders],
      ['Completion Rate', pctStr(data.completionRate)],
      ['Average Order Value', GHS(data.avgOrderValue)],
      ['Active Customers', data.activeCustomersInPeriod],
      ['New Customers', data.newCustomers],
      ['Total Topups', GHS(data.totalTopups)],
      ['Total Refunds', GHS(data.totalRefunds)],
    ];
    summaryRows.forEach(([label, val]) => { addMetricRow(ws, r, label, val); r++; });
  }

  // ── 2. Profit Analysis ──
  {
    const ws = wb.addWorksheet('Profit Analysis');
    setColWidths(ws, [22, 14, 16, 16, 16, 18]);
    let r = 1;
    addTitle(ws, r, 'PROFIT ANALYSIS', 6); r += 2;

    addSection(ws, r, 'OVERVIEW', 2); r += 1;
    addMetricRow(ws, r, 'Total Revenue', GHS(pa.totalRevenue)); r++;
    addMetricRow(ws, r, 'Total Cost', GHS(pa.totalCost)); r++;
    addMetricRow(ws, r, 'Total Profit', GHS(pa.totalProfit)); r++;
    addMetricRow(ws, r, 'Profit Margin', pctStr(pa.profitMargin)); r++;
    addMetricRow(ws, r, 'Average Daily Profit', GHS(pa.avgDailyProfit)); r++;
    addMetricRow(ws, r, 'Best Period', pa.bestPeriod ? `${pa.bestPeriod.label} (${GHS(pa.bestPeriod.profit)})` : 'N/A'); r++;
    addMetricRow(ws, r, 'Worst Period', pa.worstPeriod ? `${pa.worstPeriod.label} (${GHS(pa.worstPeriod.profit)})` : 'N/A'); r += 2;

    addSection(ws, r, 'PROFIT BREAKDOWN BY PERIOD', 5); r += 1;
    addHeaders(ws, r, ['Period', 'Orders', 'Revenue', 'Cost', 'Profit']); r++;
    pa.breakdown.forEach(row => {
      addRow(ws, r, [row.label, row.orders, GHS(row.revenue), GHS(row.cost), GHS(row.profit)], { rightAlignFrom: 1 }); r++;
    });
    r++;

    if (pa.byNetwork.length > 0) {
      addSection(ws, r, 'PROFIT BY NETWORK', 6); r += 1;
      addHeaders(ws, r, ['Network', 'Revenue', 'Cost', 'Profit', 'Revenue Share', 'Profit Share']); r++;
      pa.byNetwork.forEach(n => {
        addRow(ws, r, [n.network, GHS(n.revenue), GHS(n.cost), GHS(n.profit), pctStr(n.revenueShare), pctStr(n.profitShare)], { rightAlignFrom: 1 }); r++;
      });
    }
  }

  // ── 3. Orders ──
  {
    const ws = wb.addWorksheet('Orders');
    setColWidths(ws, [28, 12, 14]);
    let r = 1;
    addTitle(ws, r, 'ORDERS SUMMARY', 3); r += 2;
    addHeaders(ws, r, ['Status', 'Count', '% of Total']); r++;
    Object.entries(data.ordersByStatus).sort(([, a], [, b]) => b - a).forEach(([s, c]) => {
      addRow(ws, r, [s, c, pct(c, data.totalOrders)], { rightAlignFrom: 1 }); r++;
    });
  }

  // ── 4. Wallet & Balances ──
  {
    const ws = wb.addWorksheet('Wallet & Balances');
    setColWidths(ws, [40, 30, 20]);
    let r = 1;
    addTitle(ws, r, 'WALLET & BALANCES', 3); r += 2;

    addSection(ws, r, 'PERIOD BALANCES', 2); r += 1;
    addMetricRow(ws, r, 'Opening Balance (Start of Period)', GHS(data.totalOpeningBalance)); r++;
    addMetricRow(ws, r, 'Net Change During Period', GHS(data.totalNetBalanceChange)); r++;
    addMetricRow(ws, r, 'Closing Balance (End of Period)', GHS(data.totalClosingBalance)); r += 2;

    // Current live balance - visually secondary
    const liveCell = ws.getCell(r, 1);
    liveCell.value = 'Current Live Balance (at report generation)';
    liveCell.font = fontSubtle;
    const liveVal = ws.getCell(r, 2);
    liveVal.value = GHS(data.totalCurrentBalance);
    liveVal.font = { ...fontSubtle, italic: true };
    liveVal.alignment = { horizontal: 'right' };
    r += 2;

    addSection(ws, r, 'WALLET ACTIVITY', 3); r += 1;
    addHeaders(ws, r, ['Metric', 'Count', 'Amount']); r++;
    const walletRows: [string, number | string, string][] = [
      ['Successful Topups', data.walletSuccessTopups, GHS(data.walletTopupAmount)],
      ['Failed Topups', data.walletFailedTopups, '–'],
      ['Admin Credits', data.walletAdminCredits, GHS(data.walletAdminCreditAmount)],
      ['Admin Debits', data.walletAdminDebits, GHS(data.walletAdminDebitAmount)],
      ['Purchase Deductions', data.walletPurchaseDeductions, GHS(data.walletPurchaseAmount)],
      ['Refunds to Wallet', '–', GHS(data.walletRefundAmount)],
      ['Zero Balance Customers', data.zeroBalanceCount, '–'],
    ];
    walletRows.forEach(([label, count, amt]) => {
      addRow(ws, r, [label, count as string | number, amt], { rightAlignFrom: 1 }); r++;
    });
    r++;

    if (data.topByClosingBalance.length > 0) {
      addSection(ws, r, 'TOP CUSTOMERS BY CLOSING BALANCE', 3); r += 1;
      addHeaders(ws, r, ['Name', 'Email', 'Closing Balance']); r++;
      data.topByClosingBalance.forEach(c => {
        addRow(ws, r, [c.name, c.email, GHS(c.closing)], { rightAlignFrom: 2 }); r++;
      });
    }
  }

  // ── 5. Customers ──
  {
    const ws = wb.addWorksheet('Customers');
    setColWidths(ws, [24, 30, 16, 16, 16, 16]);
    let r = 1;
    addTitle(ws, r, 'CUSTOMER SUMMARY', 6); r += 2;

    addSection(ws, r, 'OVERVIEW', 2); r += 1;
    addMetricRow(ws, r, 'New Customers', data.newCustomers); r++;
    addMetricRow(ws, r, 'Active in Period', data.activeCustomersInPeriod); r++;
    addMetricRow(ws, r, 'Zero Balance', data.zeroBalanceCount); r += 2;

    if (data.topCustomersBySpend.length > 0) {
      addSection(ws, r, 'TOP CUSTOMERS BY SPEND', 3); r += 1;
      addHeaders(ws, r, ['Name', 'Email', 'Amount Spent']); r++;
      data.topCustomersBySpend.forEach(c => {
        addRow(ws, r, [c.name, c.email, GHS(c.spent)], { rightAlignFrom: 2 }); r++;
      });
      r++;
    }

    const activeBalances = data.customerBalances.filter(c => c.opening !== 0 || c.netChange !== 0 || c.balance !== 0);
    if (activeBalances.length > 0) {
      addSection(ws, r, 'ALL CUSTOMER BALANCES', 6); r += 1;
      addHeaders(ws, r, ['Name', 'Email', 'Opening', 'Net Change', 'Closing', 'Current Live']); r++;
      activeBalances.forEach(c => {
        addRow(ws, r, [c.name, c.email, GHS(c.opening), GHS(c.netChange), GHS(c.closing), GHS(c.balance)], { rightAlignFrom: 2 }); r++;
      });
    }
  }

  // ── 6. Networks ──
  {
    const ws = wb.addWorksheet('Networks');
    setColWidths(ws, [16, 10, 16, 16, 10, 10, 14, 16, 16]);
    let r = 1;
    addTitle(ws, r, 'NETWORK BREAKDOWN', 9); r += 2;
    addHeaders(ws, r, ['Network', 'Orders', 'Revenue', 'Profit', 'Delivered', 'Failed', 'Success Rate', 'Revenue Share', 'Profit Share']); r++;
    data.networkBreakdown.forEach(n => {
      addRow(ws, r, [
        n.network, n.orders, GHS(n.revenue), GHS(n.profit), n.delivered, n.failed,
        pctStr(n.successRate), pctStr(n.revenueShare), pctStr(n.profitShare),
      ], { rightAlignFrom: 1 });
      r++;
    });
  }

  // ── 7. Affiliates ──
  {
    const ws = wb.addWorksheet('Affiliates');
    setColWidths(ws, [24, 30, 16, 12, 12, 16, 16, 16, 16]);
    let r = 1;
    addTitle(ws, r, 'AFFILIATE / REFERRALS SUMMARY', 9); r += 2;

    addSection(ws, r, 'OVERVIEW', 2); r += 1;
    addMetricRow(ws, r, 'Total Referred Customers', data.totalReferredCustomers); r++;
    addMetricRow(ws, r, 'Referred Who Placed Orders', data.referredWithOrders); r++;
    addMetricRow(ws, r, 'Referral Conversion Rate', pctStr(data.referralConversionRate)); r++;
    addMetricRow(ws, r, 'Referral-Linked Orders', data.totalReferralOrders); r++;
    addMetricRow(ws, r, 'Referral Revenue', GHS(data.totalReferralRevenue)); r++;
    addMetricRow(ws, r, 'Total Affiliate Earnings', GHS(data.totalAffiliateEarnings)); r++;
    addMetricRow(ws, r, 'Total Paid', GHS(data.totalPaidEarnings)); r++;
    addMetricRow(ws, r, 'Total Unpaid', GHS(data.totalUnpaidEarnings)); r += 2;

    if (data.affiliateDetails.length > 0) {
      addSection(ws, r, 'AFFILIATE PERFORMANCE DETAIL', 9); r += 1;
      addHeaders(ws, r, ['Affiliate', 'Email', 'Code', 'Referrals', 'Orders', 'Revenue', 'Commission', 'Paid', 'Unpaid']); r++;
      data.affiliateDetails.forEach(a => {
        addRow(ws, r, [a.name, a.email, a.code, a.referrals, a.orders, GHS(a.revenue), GHS(a.commission), GHS(a.paid), GHS(a.unpaid)], { rightAlignFrom: 3 }); r++;
      });
    }
  }

  // ── 8. Support ──
  {
    const ws = wb.addWorksheet('Support');
    setColWidths(ws, [24, 12, 16]);
    let r = 1;
    addTitle(ws, r, 'SUPPORT SUMMARY', 3); r += 2;

    addSection(ws, r, 'OVERVIEW', 2); r += 1;
    addMetricRow(ws, r, 'Tickets Opened', data.ticketsOpened); r++;
    addMetricRow(ws, r, 'Tickets Resolved', data.ticketsResolved); r++;
    addMetricRow(ws, r, 'Tickets Open', data.ticketsOpen); r += 2;

    if (data.ticketCategories.length > 0) {
      addSection(ws, r, 'BY CATEGORY', 3); r += 1;
      addHeaders(ws, r, ['Category', 'Count', '% of Total']); r++;
      data.ticketCategories.forEach(c => {
        addRow(ws, r, [c.category, c.count, pct(c.count, data.ticketsOpened)], { rightAlignFrom: 1 }); r++;
      });
    }
  }

  // ── 9. Detailed Orders ──
  {
    const ws = wb.addWorksheet('Detailed Orders');
    setColWidths(ws, [16, 14, 14, 18, 16, 16, 16, 22, 22]);
    let r = 1;
    addTitle(ws, r, 'DETAILED ORDERS', 9); r += 2;
    addHeaders(ws, r, ['Order ID', 'Network', 'Bundle', 'Phone', 'Amount', 'Cost', 'Profit', 'Status', 'Date']); r++;
    data.rawOrders.forEach(o => {
      addRow(ws, r, [
        o.short_id, o.network, o.bundle_size, o.recipient_phone,
        GHS(o.total_amount), GHS(o.cost_price), GHS(o.total_amount - o.cost_price), o.status, parseDate(o.created_at) ?? o.created_at,
      ], { rightAlignFrom: 4, dateCols: [8] });
      r++;
    });
    ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 0 }];
  }

  // ── 10. Detailed Transactions ──
  {
    const ws = wb.addWorksheet('Detailed Transactions');
    setColWidths(ws, [12, 16, 34, 24, 24]);
    let r = 1;
    addTitle(ws, r, 'DETAILED WALLET TRANSACTIONS', 5); r += 2;
    addHeaders(ws, r, ['Type', 'Amount', 'Description', 'Reference', 'Date']); r++;
    data.rawTransactions.forEach(t => {
      addRow(ws, r, [t.type, GHS(t.amount), t.description, t.reference, parseDate(t.created_at) ?? t.created_at], { rightAlignFrom: 1, dateCols: [4] }); r++;
    });
    ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 0 }];
  }

  // ── 11. Admin Adjustments ──
  if (data.adminAdjustedCustomers.length > 0) {
    const ws = wb.addWorksheet('Admin Adjustments');
    setColWidths(ws, [24, 30, 12, 16, 34, 24]);
    let r = 1;
    addTitle(ws, r, 'ADMIN WALLET ADJUSTMENTS', 6); r += 2;
    addHeaders(ws, r, ['Customer', 'Email', 'Type', 'Amount', 'Description', 'Date']); r++;
    data.adminAdjustedCustomers.forEach(a => {
      addRow(ws, r, [a.name, a.email, a.type, GHS(a.amount), a.description, parseDate(a.created_at) ?? a.created_at], { rightAlignFrom: 3, dateCols: [5] }); r++;
    });
  }

  // ── 12. Daily Trend ──
  {
    const ws = wb.addWorksheet('Daily Trend');
    setColWidths(ws, [16, 10, 16, 16, 16]);
    let r = 1;
    addTitle(ws, r, 'DAILY TREND', 5); r += 2;
    addHeaders(ws, r, ['Date', 'Orders', 'Revenue', 'Profit', 'Topups']); r++;
    data.dailyTrend.forEach(d => {
      addRow(ws, r, [d.date, d.orders, GHS(d.revenue), GHS(d.profit), GHS(d.topups)], { rightAlignFrom: 1 }); r++;
    });
  }

  // Write and download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `full-business-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
