import { useState, useCallback } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { StatCard } from '@/components/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Wrench, Eye,
  Loader2, Play, Activity, Wallet, CreditCard, ShoppingCart, Users
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { REFUNDED_TERMINAL_STATUSES } from '@/lib/order-metrics';
import { useToast } from '@/hooks/use-toast';
import {
  HealthIssueDetailDialog,
  SEVERITY_CONFIG,
  CATEGORY_ICONS,
  type HealthIssue,
  type Severity,
  type Category,
} from '@/components/admin/HealthIssueDetailDialog';

let issueCounter = 0;
const makeId = () => `issue-${++issueCounter}`;

// ── Component ───────────────────────────────────────────────

export default function AdminHealthCheckPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<HealthIssue | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const openIssueDetail = (issue: HealthIssue) => {
    setSelectedIssue(issue);
    setDetailOpen(true);
  };

  const handleStatusChange = (issueId: string, newStatus: Severity) => {
    setIssues(prev => prev.map(i => i.id === issueId ? { ...i, severity: newStatus } : i));
    setSelectedIssue(prev => prev?.id === issueId ? { ...prev, severity: newStatus } : prev);
    const labels: Record<string, string> = { in_review: 'In Review', resolved: 'Resolved', ignored: 'Ignored' };
    toast({ title: `Issue marked as ${labels[newStatus] || newStatus}`, variant: 'success' });
  };

  const runScan = useCallback(async () => {
    setLoading(true);
    issueCounter = 0;
    const found: HealthIssue[] = [];
    const now = new Date().toISOString();

    try {
      // ═══ A. Wallet / Ledger Integrity ═══
      const { data: customers } = await supabase
        .from('customers')
        .select('id, full_name, wallet_balance')
        .not('status', 'in', '("deleted","archived")');

      if (customers && customers.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < customers.length; i += batchSize) {
          const batch = customers.slice(i, i + batchSize);
          const ids = batch.map(c => c.id);

          const { data: txns } = await supabase
            .from('wallet_transactions')
            .select('customer_id, type, amount')
            .in('customer_id', ids);

          if (txns) {
            const ledgerMap: Record<string, number> = {};
            for (const tx of txns) {
              if (!ledgerMap[tx.customer_id]) ledgerMap[tx.customer_id] = 0;
              ledgerMap[tx.customer_id] += tx.type === 'credit' ? Number(tx.amount) : -Number(tx.amount);
            }

            for (const c of batch) {
              const ledgerBalance = ledgerMap[c.id] || 0;
              const variance = Math.abs(Number(c.wallet_balance) - ledgerBalance);
              if (variance > 0.01) {
                found.push({
                  id: makeId(), category: 'wallet',
                  type: 'Wallet / Ledger Variance',
                  severity: variance > 5 ? 'review_needed' : 'warning',
                  summary: `Balance GHS ${Number(c.wallet_balance).toFixed(2)} vs ledger GHS ${ledgerBalance.toFixed(2)} (variance: GHS ${variance.toFixed(2)})`,
                  customerId: c.id, customerName: c.full_name,
                  amount: variance,
                  detectedAt: now,
                });
              }
            }
          }
        }

        // Duplicate wallet credits by reference
        const { data: dupRefs } = await supabase
          .from('wallet_transactions')
          .select('reference, customer_id, amount')
          .eq('type', 'credit')
          .neq('reference', '');

        if (dupRefs) {
          const refCounts: Record<string, { count: number; amount: number }> = {};
          for (const tx of dupRefs) {
            const key = `${tx.customer_id}::${tx.reference}`;
            if (!refCounts[key]) refCounts[key] = { count: 0, amount: Number(tx.amount) };
            refCounts[key].count += 1;
          }
          for (const [key, data] of Object.entries(refCounts)) {
            if (data.count > 1) {
              const [custId, ref] = key.split('::');
              found.push({
                id: makeId(), category: 'wallet',
                type: 'Duplicate Wallet Credit',
                severity: 'review_needed',
                summary: `Reference "${ref}" credited ${data.count} times`,
                reference: ref, customerId: custId,
                amount: data.amount,
                detectedAt: now,
              });
            }
          }
        }
      }

      // ═══ B. Grace Period / Order Flow ═══
      // Only flag stuck orders that have been past grace period for > 5 minutes
      // (process-pending-orders runs every minute, so 5 min buffer avoids false positives)
      const stuckThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: stuckOrders } = await supabase
        .from('orders')
        .select('id, short_id, status, grace_period_ends_at, total_amount, customer_id, customers(full_name)')
        .eq('status', 'pending_confirmation')
        .lte('grace_period_ends_at', stuckThreshold);

      if (stuckOrders && stuckOrders.length > 0) {
        for (const o of stuckOrders) {
          const minutesStuck = Math.round((Date.now() - new Date(o.grace_period_ends_at!).getTime()) / 60000);
          found.push({
            id: makeId(), category: 'grace_period',
            type: 'Stuck Grace-Period Order',
            severity: minutesStuck > 15 ? 'error' : 'warning',
            summary: `Order ${o.short_id} still pending_confirmation — ${minutesStuck} min past grace period`,
            reference: o.short_id, customerId: o.customer_id || undefined,
            customerName: (o as any).customers?.full_name,
            amount: Number(o.total_amount),
            orderStatus: o.status,
            orderId: o.id,
            detectedAt: now,
          });
        }
      }

      // ═══ Missing Refund — ONLY for refund-eligible statuses (NOT delivered) ═══
      const refundEligibleStatuses = [...REFUNDED_TERMINAL_STATUSES] as string[];
      const { data: refundableOrders } = await supabase
        .from('orders')
        .select('id, short_id, status, total_amount, customer_id, customers(full_name)')
        .in('status', refundEligibleStatuses);

      if (refundableOrders) {
        for (const o of refundableOrders) {
          if (!o.customer_id) continue;
          const { data: refundTx } = await supabase
            .from('wallet_transactions')
            .select('id')
            .eq('customer_id', o.customer_id)
            .eq('type', 'credit')
            .or(`reference.ilike.%${o.short_id}%,description.ilike.%${o.short_id}%,reference.ilike.%REF-${o.short_id}%`)
            .limit(1);

          if (!refundTx || refundTx.length === 0) {
            found.push({
              id: makeId(), category: 'order',
              type: 'Missing Refund for Cancelled/Rejected Order',
              severity: 'error',
              summary: `${o.status} order ${o.short_id} (GHS ${Number(o.total_amount).toFixed(2)}) — wallet debited but no refund found`,
              reference: o.short_id, customerId: o.customer_id,
              customerName: (o as any).customers?.full_name,
              amount: Number(o.total_amount),
              orderStatus: o.status,
              orderId: o.id,
              detectedAt: now,
            });
          }
        }
      }

      // ═══ C. Payment / Topup Integrity ═══
      // Only flag approved topups older than 2 minutes (allows webhook/processing time)
      const topupGraceThreshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: approvedTopups } = await supabase
        .from('topups')
        .select('id, short_id, amount, customer_id, method, status, created_at, customers(full_name)')
        .eq('status', 'approved')
        .lte('created_at', topupGraceThreshold);

      if (approvedTopups) {
        for (const t of approvedTopups) {
          if (!t.customer_id) {
            found.push({
              id: makeId(), category: 'topup',
              type: 'Orphaned Topup',
              severity: 'error',
              summary: `Approved topup ${t.short_id} (GHS ${Number(t.amount).toFixed(2)}) has no customer — cannot credit wallet`,
              reference: t.short_id,
              amount: Number(t.amount),
              topupStatus: t.status,
              detectedAt: now,
            });
            continue;
          }
          // Match wallet credit using multiple strategies:
          // 1. Direct short_id match in reference/description (momo topups)
          // 2. PSK-% reference match for Paystack topups (same customer + amount + 5-min window)
          // 3. Generic proximity fallback (same customer + amount + 5-min window)
          const { data: creditTx } = await supabase
            .from('wallet_transactions')
            .select('id')
            .eq('customer_id', t.customer_id)
            .eq('type', 'credit')
            .or(`reference.ilike.%${t.short_id}%,description.ilike.%${t.short_id}%`)
            .limit(1);

          let foundCredit = creditTx && creditTx.length > 0;

          // For Paystack topups, check PSK-% references within a 5-minute window
          if (!foundCredit && t.method === 'paystack') {
            const topupTime = new Date(t.created_at);
            const windowStart = new Date(topupTime.getTime() - 60000).toISOString(); // 1 min before
            const windowEnd = new Date(topupTime.getTime() + 5 * 60000).toISOString(); // 5 min after
            const { data: pskTx } = await supabase
              .from('wallet_transactions')
              .select('id')
              .eq('customer_id', t.customer_id)
              .eq('type', 'credit')
              .eq('amount', Number(t.amount))
              .like('reference', 'PSK-%')
              .gte('created_at', windowStart)
              .lte('created_at', windowEnd)
              .limit(1);
            foundCredit = !!pskTx && pskTx.length > 0;
          }

          // Generic proximity fallback for any method
          if (!foundCredit) {
            const topupTime = new Date(t.created_at);
            const windowStart = new Date(topupTime.getTime() - 60000).toISOString();
            const windowEnd = new Date(topupTime.getTime() + 5 * 60000).toISOString();
            const { data: proxTx } = await supabase
              .from('wallet_transactions')
              .select('id')
              .eq('customer_id', t.customer_id)
              .eq('type', 'credit')
              .eq('amount', Number(t.amount))
              .gte('created_at', windowStart)
              .lte('created_at', windowEnd)
              .limit(1);
            foundCredit = !!proxTx && proxTx.length > 0;
          }

          if (!foundCredit) {
            const minutesOld = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
            found.push({
              id: makeId(), category: 'topup',
              type: 'Approved Topup Without Credit',
              severity: minutesOld > 30 ? 'error' : 'warning',
              summary: `Topup ${t.short_id} approved ${minutesOld} min ago (GHS ${Number(t.amount).toFixed(2)}) but no wallet credit found`,
              reference: t.short_id, customerId: t.customer_id,
              customerName: (t as any).customers?.full_name,
              amount: Number(t.amount),
              topupStatus: t.status,
              detectedAt: now,
            });
          }
        }
      }

      // Review-needed topups
      const { data: reviewTopups } = await supabase
        .from('topups')
        .select('id, short_id, amount, status')
        .eq('status', 'review_needed');

      if (reviewTopups && reviewTopups.length > 0) {
        for (const t of reviewTopups) {
          found.push({
            id: makeId(), category: 'topup',
            type: 'Topup Needs Review',
            severity: 'warning',
            summary: `Topup ${t.short_id} (GHS ${Number(t.amount).toFixed(2)}) is in review_needed status`,
            reference: t.short_id,
            amount: Number(t.amount),
            topupStatus: t.status,
            detectedAt: now,
          });
        }
      }

      // ═══ D. Duplicate Active Orders ═══
      const allTerminalFilter = [...refundEligibleStatuses, 'delivered'];
      const { data: recentActiveOrders } = await supabase
        .from('orders')
        .select('id, short_id, recipient_phone, bundle_size, network, status, created_at, total_amount, customer_id, customers(full_name)')
        .not('status', 'in', `("${allTerminalFilter.join('","')}")`)
        .order('created_at', { ascending: false })
        .limit(500);

      if (recentActiveOrders && recentActiveOrders.length > 1) {
        const seen: Record<string, typeof recentActiveOrders[0]> = {};
        for (const o of recentActiveOrders) {
          const key = `${o.recipient_phone}::${o.bundle_size}::${o.network}`;
          if (seen[key]) {
            const timeDiff = Math.abs(new Date(o.created_at).getTime() - new Date(seen[key].created_at).getTime());
            if (timeDiff < 10 * 60 * 1000) {
              found.push({
                id: makeId(), category: 'order',
                type: 'Possible Duplicate Order',
                severity: 'warning',
                summary: `Orders ${seen[key].short_id} and ${o.short_id} — same phone/bundle/network within 10 min`,
                reference: o.short_id, customerId: o.customer_id || undefined,
                customerName: (o as any).customers?.full_name,
                amount: Number(o.total_amount),
                orderStatus: o.status,
                orderId: o.id,
                detectedAt: now,
              });
            }
          }
          seen[key] = o;
        }
      }

      // ═══ E. Deleted User Integrity ═══
      const { data: deletedWithAuth } = await supabase
        .from('customers')
        .select('id, full_name, email, auth_user_id')
        .eq('status', 'deleted')
        .not('auth_user_id', 'is', null);

      if (deletedWithAuth && deletedWithAuth.length > 0) {
        for (const u of deletedWithAuth) {
          found.push({
            id: makeId(), category: 'user',
            type: 'Deleted User With Auth Link',
            severity: 'warning',
            summary: `Deleted user "${u.full_name}" (${u.email}) still has auth_user_id — may block re-signup`,
            customerId: u.id, customerName: u.full_name,
            detectedAt: now,
          });
        }
      }

      setIssues(found);
      setHasRun(true);
      setLastScanTime(new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      toast({ title: 'Health check complete', description: `${found.length} issue${found.length !== 1 ? 's' : ''} found`, variant: 'success' });
    } catch (err) {
      console.error('Health check error:', err);
      toast({ title: 'Health check failed', description: 'Check console for details', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const autoFixSafe = useCallback(async () => {
    setFixing(true);
    let fixed = 0;

    try {
      const stuckIssues = issues.filter(i => i.type === 'Stuck Grace-Period Order' && !['auto-fixed', 'resolved', 'ignored'].includes(i.severity));
      if (stuckIssues.length > 0) {
        const res = await supabase.functions.invoke('process-pending-orders');
        if (!res.error) {
          fixed += stuckIssues.length;
          setIssues(prev => prev.map(i =>
            i.type === 'Stuck Grace-Period Order' && !['resolved', 'ignored'].includes(i.severity)
              ? { ...i, severity: 'auto-fixed' as Severity }
              : i
          ));
        }
      }

      toast({ title: 'Auto-fix complete', description: `Fixed ${fixed} issue${fixed !== 1 ? 's' : ''}. Remaining issues need manual review.`, variant: 'success' });
    } catch (err) {
      console.error('Auto-fix error:', err);
      toast({ title: 'Auto-fix failed', variant: 'destructive' });
    } finally {
      setFixing(false);
    }
  }, [issues, toast]);

  // ── Stats (exclude resolved/ignored from active counts) ──
  const resolvedStatuses: Severity[] = ['passed', 'auto-fixed', 'resolved', 'ignored'];
  const activeIssues = issues.filter(i => !resolvedStatuses.includes(i.severity));
  const totalChecks = issues.length || 0;
  const resolved = issues.filter(i => i.severity === 'resolved').length;
  const warnings = activeIssues.filter(i => i.severity === 'warning').length;
  const errors = activeIssues.filter(i => i.severity === 'error').length;
  const autoFixed = issues.filter(i => i.severity === 'auto-fixed').length;
  const reviewNeeded = activeIssues.filter(i => i.severity === 'review_needed' || i.severity === 'in_review').length;
  const ignored = issues.filter(i => i.severity === 'ignored').length;
  const safeFixableCount = issues.filter(i => i.type === 'Stuck Grace-Period Order' && !['auto-fixed', 'resolved', 'ignored'].includes(i.severity)).length;
  const activeCount = activeIssues.length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              System Health Check
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Scan for integrity issues across orders, wallets, topups, and users
              {lastScanTime && <span className="text-muted-foreground/60"> · Last scan: {lastScanTime}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={runScan} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? 'Scanning…' : hasRun ? 'Re-Run Scan' : 'Run Health Check'}
            </Button>
            {hasRun && safeFixableCount > 0 && (
              <Button variant="secondary" onClick={autoFixSafe} disabled={fixing} className="gap-2">
                {fixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                Auto-Fix Safe ({safeFixableCount})
              </Button>
            )}
          </div>
        </div>

        {/* Overall health status banner */}
        {hasRun && (
          <div className={`rounded-xl p-3 border flex items-center gap-3 ${
            activeCount === 0
              ? 'bg-success/5 border-success/20 text-success'
              : (errors > 0 || reviewNeeded > 0)
                ? 'bg-destructive/5 border-destructive/20 text-destructive'
                : 'bg-warning/5 border-warning/20 text-warning'
          }`}>
            {activeCount === 0 ? <CheckCircle2 className="w-5 h-5" /> : errors > 0 ? <XCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span className="text-sm font-medium">
              {activeCount === 0
                ? `All systems healthy${totalChecks > 0 ? ` — ${totalChecks} issue${totalChecks !== 1 ? 's' : ''} resolved/ignored` : ' — no integrity issues detected'}`
                : `${activeCount} active issue${activeCount !== 1 ? 's' : ''} found${resolved + ignored + autoFixed > 0 ? ` · ${resolved + ignored + autoFixed} resolved/ignored` : ''}`}
            </span>
          </div>
        )}

        {/* Summary Cards */}
        {hasRun && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard title="Active Issues" value={String(activeCount)} icon={<Activity className="w-4 h-4" />} accent={activeCount > 0 ? 'amber' : 'green'} />
            <StatCard title="Errors" value={String(errors)} icon={<XCircle className="w-4 h-4" />} accent={errors > 0 ? 'red' : 'green'} />
            <StatCard title="Warnings" value={String(warnings)} icon={<AlertTriangle className="w-4 h-4" />} accent={warnings > 0 ? 'amber' : 'green'} />
            <StatCard title="Review Needed" value={String(reviewNeeded)} icon={<Eye className="w-4 h-4" />} accent="purple" />
            <StatCard title="Auto-Fixed" value={String(autoFixed)} icon={<Wrench className="w-4 h-4" />} accent="teal" />
            <StatCard title="Resolved" value={String(resolved + ignored)} icon={<CheckCircle2 className="w-4 h-4" />} accent="green" />
          </div>
        )}

        {/* No issues state */}
        {hasRun && issues.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-4" />
              <h3 className="text-lg font-display font-semibold text-foreground">All Clear</h3>
              <p className="text-sm text-muted-foreground mt-1">No integrity issues detected across the platform.</p>
            </CardContent>
          </Card>
        )}

        {/* Issues Table */}
        {hasRun && issues.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-display">Detected Issues</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-[120px]">Reference</TableHead>
                    <TableHead className="w-[140px]">Customer</TableHead>
                    <TableHead className="w-[120px]">Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map(issue => {
                    const sevCfg = SEVERITY_CONFIG[issue.severity];
                    const SevIcon = sevCfg.icon;
                    const CatIcon = CATEGORY_ICONS[issue.category];
                    return (
                      <TableRow
                        key={issue.id}
                        className="cursor-pointer hover:bg-muted/60 transition-colors"
                        onClick={() => openIssueDetail(issue)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CatIcon className="w-3.5 h-3.5" />
                            <span className="capitalize">{issue.category.replace('_', ' ')}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium text-foreground">{issue.type}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate" title={issue.summary}>{issue.summary}</TableCell>
                        <TableCell>
                          {issue.reference && <span className="font-mono text-xs text-primary">{issue.reference}</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{issue.customerName || '—'}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${sevCfg.variant}`}>
                            <SevIcon className="w-3 h-3" />{sevCfg.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Not yet run */}
        {!hasRun && !loading && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <ShieldCheck className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-display font-semibold text-foreground">Ready to Scan</h3>
              <p className="text-sm text-muted-foreground mt-1">Click "Run Health Check" to scan for integrity issues.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <HealthIssueDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        issue={selectedIssue}
        onStatusChange={handleStatusChange}
      />
    </AdminLayout>
  );
}
