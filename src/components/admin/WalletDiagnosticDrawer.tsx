import { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatGHS } from '@/lib/mock-data';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock,
  FileText, Flag, Loader2, Search, ShieldAlert, Sparkles, StickyNote, Wrench, X,
} from 'lucide-react';
import { format } from 'date-fns';
import type {
  DiagnosticConfidence, DiagnosticResult, TimelineEntry, UnmatchedEntry,
} from '@/lib/reconciliation-diagnostics';

interface WalletIssueWithDiag {
  customerId: string;
  customerName: string;
  email: string;
  currentBalance: number;
  computedBalance: number;
  variance: number;
  lastTxDate: string | null;
  reconciliationStatus: string;
  issue: string;
  diagnosis: DiagnosticResult | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: WalletIssueWithDiag | null;
  onStatusChange?: () => void;
}

const confidenceBadge = (c: DiagnosticConfidence) => {
  const map: Record<DiagnosticConfidence, { className: string; icon: React.ReactNode; label: string }> = {
    likely: {
      className: 'bg-destructive/10 text-destructive border-destructive/20',
      icon: <AlertTriangle className="w-3 h-3" />,
      label: 'Likely cause',
    },
    possible: {
      className: 'bg-warning/10 text-warning border-warning/20',
      icon: <Search className="w-3 h-3" />,
      label: 'Possible cause',
    },
    needs_review: {
      className: 'bg-muted text-muted-foreground border-border',
      icon: <ShieldAlert className="w-3 h-3" />,
      label: 'Needs manual review',
    },
  };
  const m = map[c];
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${m.className}`}>
      {m.icon} {m.label}
    </Badge>
  );
};

const flagLabel = (flag: string) => {
  const map: Record<string, { label: string; className: string }> = {
    duplicate: { label: 'Duplicate', className: 'bg-destructive/10 text-destructive' },
    balance_gap: { label: 'Balance Gap', className: 'bg-warning/10 text-warning' },
    undocumented_admin: { label: 'Undocumented', className: 'bg-amber-500/10 text-amber-600' },
    suspicious_timing: { label: 'Timing', className: 'bg-primary text-primary-foreground' },
    missing_counterpart: { label: 'Missing', className: 'bg-purple-500/10 text-purple-600' },
  };
  const m = map[flag] || { label: flag, className: 'bg-muted text-muted-foreground' };
  return <Badge variant="outline" className={`text-[9px] ${m.className}`}>{m.label}</Badge>;
};

export function WalletDiagnosticDrawer({ open, onOpenChange, issue, onStatusChange }: Props) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (!issue) return null;
  const diag = issue.diagnosis;

  const fmtDate = (d: string) => {
    try { return format(new Date(d), 'dd MMM yyyy, HH:mm'); } catch { return d; }
  };

  const persistIssue = async (status: string, adminNote?: string) => {
    setActionLoading(status);
    try {
      // Check if already exists
      const { data: existing } = await supabase
        .from('reconciliation_issues')
        .select('id')
        .eq('customer_id', issue.customerId)
        .eq('status', 'open')
        .limit(1);

      const payload: Record<string, any> = {
        customer_id: issue.customerId,
        current_balance: issue.currentBalance,
        computed_balance: issue.computedBalance,
        variance: issue.variance,
        likely_cause: diag?.likelyCause || null,
        confidence: diag?.confidence || 'needs_review',
        suggested_fix: diag?.suggestedFix || null,
        diagnostic_details: diag ? {
          explanation: diag.explanation,
          unmatched_count: diag.unmatchedEntries.length,
          timeline_count: diag.balanceTimeline.length,
        } : {},
        linked_transactions: diag?.unmatchedEntries.map(e => ({
          id: e.id, reference: e.reference, flag: e.flag, amount: e.amount, type: e.type,
        })) || [],
        status,
        admin_note: adminNote || note || null,
      };

      if (status === 'resolved' || status === 'ignored') {
        payload.resolved_at = new Date().toISOString();
      }

      if (existing && existing.length > 0) {
        await supabase
          .from('reconciliation_issues')
          .update(payload)
          .eq('id', existing[0].id);
      } else {
        await supabase.from('reconciliation_issues').insert(payload);
      }

      toast({ title: 'Issue updated', description: `Marked as ${status.replace('_', ' ')}` });
      onStatusChange?.();
    } catch (err) {
      toast({ title: 'Error saving', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border/40 bg-gradient-to-b from-primary/[0.03] to-transparent shrink-0">
          <SheetTitle className="text-base font-bold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Wallet Variance Investigation
          </SheetTitle>
          <SheetDescription className="text-xs">
            {issue.customerName} · {issue.email}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">
            {/* Balance Summary */}
            <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</p>
                  <p className="text-lg font-bold text-foreground">{formatGHS(issue.currentBalance)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Computed</p>
                  <p className="text-lg font-bold text-foreground">{formatGHS(issue.computedBalance)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Variance</p>
                  <p className={`text-lg font-bold ${issue.variance > 0 ? 'text-success' : 'text-destructive'}`}>
                    {issue.variance > 0 ? '+' : ''}{formatGHS(issue.variance)}
                  </p>
                </div>
              </div>
              {issue.lastTxDate && (
                <p className="text-[10px] text-muted-foreground text-center">
                  Last transaction: {fmtDate(issue.lastTxDate)}
                </p>
              )}
            </div>

            {/* Diagnosis Card */}
            {diag && (
              <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">System Diagnosis</span>
                  <span className="text-[9px] text-muted-foreground italic ml-auto">Inferred — not a guaranteed fact</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    {confidenceBadge(diag.confidence)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{diag.likelyCause}</p>
                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{diag.explanation}</p>
                  </div>
                  <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Wrench className="w-3 h-3 text-primary" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Suggested Fix</span>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">{diag.suggestedFix}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Detail Tabs */}
            {diag && (
              <Tabs defaultValue="unmatched" className="space-y-3">
                <TabsList className="w-full">
                  <TabsTrigger value="unmatched" className="flex-1 text-xs">
                    <Flag className="w-3 h-3 mr-1" />
                    Flagged ({diag.unmatchedEntries.length})
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="flex-1 text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    Timeline
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="unmatched" className="space-y-2">
                  {diag.unmatchedEntries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-xs">
                      <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-success" />
                      No flagged entries — review timeline for clues
                    </div>
                  ) : (
                    diag.unmatchedEntries.map((e) => (
                      <div key={e.id} className="rounded-lg border border-border/40 p-3 space-y-1.5 bg-card hover:bg-muted/30 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {e.type === 'credit' ? (
                              <ArrowDownLeft className="w-3 h-3 text-success" />
                            ) : (
                              <ArrowUpRight className="w-3 h-3 text-destructive" />
                            )}
                            <span className={`text-sm font-semibold ${e.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                              {e.type === 'credit' ? '+' : '-'}{formatGHS(e.amount)}
                            </span>
                          </div>
                          {flagLabel(e.flag)}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{e.description}</p>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-mono">{e.reference}</span>
                          <span>{fmtDate(e.date)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="timeline" className="space-y-0">
                  <div className="rounded-lg border border-border/40 overflow-hidden bg-card">
                    <div className="max-h-[320px] overflow-y-auto">
                      {diag.balanceTimeline.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-xs">No transactions</div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Running Bal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diag.balanceTimeline.map((entry, i) => (
                              <tr
                                key={i}
                                className={`border-t border-border/20 ${entry.flagged ? 'bg-destructive/5' : ''}`}
                              >
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <div className="flex items-center gap-1">
                                    {entry.flagged && <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />}
                                    <span>{format(new Date(entry.date), 'dd MMM HH:mm')}</span>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">{entry.event}</p>
                                </td>
                                <td className={`px-3 py-2 text-right font-medium ${entry.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                                  {entry.type === 'credit' ? '+' : '-'}{formatGHS(entry.amount)}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-foreground">
                                  {formatGHS(entry.runningBalance)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                  {diag.balanceTimeline.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-2 px-1">
                      Final computed: {formatGHS(diag.balanceTimeline[diag.balanceTimeline.length - 1]?.runningBalance || 0)}
                      {' '}vs current: {formatGHS(issue.currentBalance)}
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {/* Admin Note */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground">Internal Note</span>
              </div>
              <Textarea
                placeholder="Add investigation notes..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="text-xs min-h-[60px] resize-none"
              />
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-foreground">Actions</span>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 h-9"
                  disabled={!!actionLoading}
                  onClick={() => persistIssue('in_review')}
                >
                  {actionLoading === 'in_review' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  Mark In Review
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 h-9"
                  disabled={!!actionLoading}
                  onClick={() => persistIssue('resolved')}
                >
                  {actionLoading === 'resolved' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Mark Resolved
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 h-9"
                  disabled={!!actionLoading}
                  onClick={() => persistIssue('ignored')}
                >
                  {actionLoading === 'ignored' ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  Ignore
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 h-9"
                  disabled={saving || !note.trim()}
                  onClick={async () => {
                    setSaving(true);
                    await persistIssue('open', note);
                    setSaving(false);
                  }}
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                  Save Note
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
