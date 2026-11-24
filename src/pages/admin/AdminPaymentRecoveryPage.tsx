import { useState, useCallback, useEffect } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import { DateFilter, type DatePreset, filterByDate } from '@/components/DateFilter';
import { BlindSweepMonitor } from '@/components/admin/BlindSweepMonitor';
import {
  Loader2, RefreshCw, Search, AlertTriangle,
  CheckCircle, XCircle, Clock, Eye, MessageSquare, Play, AlertCircle, Link2, User, UserX,
} from 'lucide-react';

interface PaymentAttempt {
  id: string;
  customer_id: string;
  paystack_reference: string;
  attempt_type: string;
  status: string;
  amount: number;
  currency: string;
  metadata: any;
  paystack_transaction_id: string | null;
  paystack_response: any;
  finalized_at: string | null;
  finalized_by: string | null;
  error_message: string | null;
  event_log: any[];
  created_at: string;
  updated_at: string;
  webhook_received_at: string | null;
  callback_received_at: string | null;
  last_verified_at: string | null;
  recovery_attempts: number;
  last_recovery_at: string | null;
  items_succeeded: number | null;
  items_total: number | null;
  buyer_type: string;
  buyer_phone: string;
  buyer_email: string;
  affiliate_code: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
}

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  pending: { variant: 'outline', label: 'Pending' },
  processing: { variant: 'outline', label: 'Processing' },
  completed: { variant: 'default', label: 'Completed' },
  partially_completed: { variant: 'secondary', label: 'Partial' },
  failed: { variant: 'destructive', label: 'Failed' },
  abandoned: { variant: 'secondary', label: 'Abandoned' },
  needs_review: { variant: 'destructive', label: 'Needs Review' },
};

function formatTs(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function eventIcon(type: string) {
  if (type.includes('finalized') || type.includes('completed')) return <CheckCircle className="w-3 h-3 text-primary shrink-0" />;
  if (type.includes('failed') || type.includes('error') || type.includes('abandoned')) return <XCircle className="w-3 h-3 text-destructive shrink-0" />;
  if (type.includes('admin')) return <MessageSquare className="w-3 h-3 text-primary shrink-0" />;
  if (type.includes('webhook') || type.includes('callback')) return <RefreshCw className="w-3 h-3 text-muted-foreground shrink-0" />;
  if (type.includes('orphan') || type.includes('attach')) return <Link2 className="w-3 h-3 text-warning shrink-0" />;
  return <Clock className="w-3 h-3 text-muted-foreground shrink-0" />;
}

export default function AdminPaymentRecoveryPage() {
  const { toast } = useToast();
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [buyerTypeFilter, setBuyerTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customDate, setCustomDate] = useState<Date | undefined>();
  const [processing, setProcessing] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<PaymentAttempt | null>(null);
  const [noteDialog, setNoteDialog] = useState<PaymentAttempt | null>(null);
  const [noteText, setNoteText] = useState('');
  const [attachDialog, setAttachDialog] = useState<PaymentAttempt | null>(null);
  const [attachCandidates, setAttachCandidates] = useState<PaymentAttempt[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);

  const loadAttempts = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('payment_attempts' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (typeFilter !== 'all') query = query.eq('attempt_type', typeFilter);
      if (buyerTypeFilter === 'guest') query = query.eq('buyer_type', 'guest');
      else if (buyerTypeFilter === 'registered') query = query.eq('buyer_type', 'registered');

      const { data } = await query;
      const items = ((data || []) as unknown) as PaymentAttempt[];

      // Enrich registered attempts with customer info
      const registeredItems = items.filter(a => a.buyer_type !== 'guest' && a.customer_id);
      const customerIds = [...new Set(registeredItems.map(a => a.customer_id))];
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, full_name, email, phone')
          .in('id', customerIds);
        const custMap = new Map((customers || []).map((c: any) => [c.id, c]));
        for (const item of items) {
          const c = custMap.get(item.customer_id);
          if (c) {
            item.customer_name = c.full_name;
            item.customer_email = c.email;
            item.customer_phone = c.phone;
          } else if (item.buyer_type === 'guest') {
            item.customer_name = item.buyer_phone || 'Guest';
            item.customer_email = item.buyer_email || '';
          }
        }
      } else {
        // All items might be guest
        for (const item of items) {
          if (item.buyer_type === 'guest') {
            item.customer_name = item.buyer_phone || 'Guest';
            item.customer_email = item.buyer_email || '';
          }
        }
      }

      setAttempts(items);
    } catch {
      toast({ title: 'Failed to load payment attempts', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, buyerTypeFilter, toast]);

  useEffect(() => { loadAttempts(); }, [loadAttempts]);

  const filtered = attempts.filter(a => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matches =
        a.paystack_reference.toLowerCase().includes(q) ||
        (a.customer_name || '').toLowerCase().includes(q) ||
        (a.customer_email || '').toLowerCase().includes(q) ||
        (a.customer_phone || '').toLowerCase().includes(q) ||
        (a.buyer_phone || '').toLowerCase().includes(q) ||
        (a.buyer_email || '').toLowerCase().includes(q) ||
        (a.affiliate_code || '').toLowerCase().includes(q) ||
        a.amount.toString().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const displayed = filterByDate(filtered, a => a.created_at, datePreset, customDate);

  const handleVerifyAndReprocess = async (attempt: PaymentAttempt) => {
    setProcessing(attempt.id);
    try {
      const res = await supabase.functions.invoke('finalize-payment', {
        body: { reference: attempt.paystack_reference, source: 'admin' },
      });
      if (res.error) throw new Error(res.error.message);
      const result = res.data as any;
      if (result?.error) throw new Error(result.error);

      if (result?.already_processed) {
        toast({ title: 'Already processed', description: result.message || 'This payment was already finalized.' });
      } else if (result?.partial_failure) {
        toast({ title: 'Partial success', description: result.message });
      } else {
        toast({ title: 'Payment reprocessed', description: result.message || 'Payment finalized successfully.' });
      }
      loadAttempts();
    } catch (e: any) {
      toast({ title: 'Reprocessing failed', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };

  const handleMarkReviewed = async (attempt: PaymentAttempt) => {
    const existing = Array.isArray(attempt.event_log) ? attempt.event_log : [];
    await supabase.from('payment_attempts' as any).update({
      status: 'failed',
      error_message: 'Manually marked as reviewed by admin',
      event_log: [...existing, { type: 'admin_reviewed', timestamp: new Date().toISOString() }],
      updated_at: new Date().toISOString(),
    }).eq('id', attempt.id);
    toast({ title: 'Marked as reviewed' });
    loadAttempts();
  };

  const handleAddNote = async () => {
    if (!noteDialog || !noteText.trim()) return;
    const existing = Array.isArray(noteDialog.event_log) ? noteDialog.event_log : [];
    await supabase.from('payment_attempts' as any).update({
      event_log: [...existing, { type: 'admin_note', note: noteText.trim(), timestamp: new Date().toISOString() }],
      updated_at: new Date().toISOString(),
    }).eq('id', noteDialog.id);
    setNoteDialog(null);
    setNoteText('');
    toast({ title: 'Note added' });
    loadAttempts();
  };

  const handleRunRecovery = async () => {
    setProcessing('recovery');
    try {
      const res = await supabase.functions.invoke('recover-stale-payments');
      const data = res.data as any;
      toast({ title: 'Recovery complete', description: `Recovered: ${data?.recovered || 0}, Failed: ${data?.failed || 0}, Abandoned: ${data?.abandoned || 0}` });
      loadAttempts();
    } catch (e: any) {
      toast({ title: 'Recovery failed', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };


  // ── Orphan Attach Flow ──
  const handleOpenAttach = async (orphan: PaymentAttempt) => {
    setAttachDialog(orphan);
    setAttachLoading(true);
    try {
      const tenMinAgo = new Date(new Date(orphan.created_at).getTime() - 10 * 60 * 1000).toISOString();
      const tenMinAfter = new Date(new Date(orphan.created_at).getTime() + 10 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from('payment_attempts' as any)
        .select('*')
        .eq('attempt_type', orphan.attempt_type)
        .in('status', ['pending', 'failed', 'abandoned'])
        .gte('created_at', tenMinAgo)
        .lte('created_at', tenMinAfter)
        .neq('id', orphan.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const candidates = ((data || []) as unknown as PaymentAttempt[]).filter(c => {
        const amountMatch = Math.abs(c.amount - orphan.amount) < 1;
        const customerMatch = c.customer_id === orphan.customer_id;
        return amountMatch || customerMatch;
      });

      const customerIds = [...new Set(candidates.map(c => c.customer_id))];
      if (customerIds.length > 0) {
        const { data: custs } = await supabase.from('customers').select('id, full_name, email').in('id', customerIds);
        const custMap = new Map((custs || []).map((c: any) => [c.id, c]));
        for (const c of candidates) {
          const cust = custMap.get(c.customer_id);
          if (cust) { c.customer_name = cust.full_name; c.customer_email = cust.email; }
        }
      }

      setAttachCandidates(candidates);
    } catch {
      toast({ title: 'Failed to find candidates', variant: 'destructive' });
    } finally {
      setAttachLoading(false);
    }
  };

  const handleAttachOrphan = async (orphan: PaymentAttempt, target: PaymentAttempt) => {
    setProcessing(orphan.id);
    try {
      const orphanLog = Array.isArray(orphan.event_log) ? orphan.event_log : [];
      const targetLog = Array.isArray(target.event_log) ? target.event_log : [];
      const now = new Date().toISOString();

      await supabase.from('payment_attempts' as any).update({
        paystack_reference: orphan.paystack_reference,
        paystack_transaction_id: orphan.paystack_transaction_id,
        paystack_response: orphan.paystack_response || (orphan.metadata as any)?.paystack_response,
        webhook_received_at: orphan.webhook_received_at,
        status: 'pending',
        error_message: null,
        event_log: [
          ...targetLog,
          { type: 'orphan_attached', orphan_id: orphan.id, orphan_reference: orphan.paystack_reference, original_reference: target.paystack_reference, timestamp: now },
        ],
        updated_at: now,
      }).eq('id', target.id);

      await supabase.from('payment_attempts' as any).update({
        status: 'failed',
        error_message: `Attached to attempt ${target.id} (ref: ${target.paystack_reference})`,
        event_log: [
          ...orphanLog,
          { type: 'orphan_resolved', attached_to_id: target.id, attached_to_reference: target.paystack_reference, timestamp: now },
        ],
        updated_at: now,
      }).eq('id', orphan.id);

      const res = await supabase.functions.invoke('finalize-payment', {
        body: { reference: orphan.paystack_reference, source: 'admin' },
      });
      const result = res.data as any;

      if (result?.success || result?.already_processed) {
        toast({ title: 'Orphan attached and finalized', description: result.message || 'Payment recovered successfully.' });
      } else {
        toast({ title: 'Attached but finalization needs review', description: result?.error || result?.message || 'Check the attempt details.' });
      }

      setAttachDialog(null);
      loadAttempts();
    } catch (e: any) {
      toast({ title: 'Attach failed', description: e.message, variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };

  const pendingCount = attempts.filter(a => a.status === 'pending').length;
  const reviewCount = attempts.filter(a => a.status === 'needs_review').length;
  const partialCount = attempts.filter(a => a.status === 'partially_completed').length;
  const guestCount = attempts.filter(a => a.buyer_type === 'guest').length;

  const isOrphan = (a: PaymentAttempt) =>
    a.status === 'needs_review' &&
    a.event_log?.some((e: any) => e.type === 'webhook_orphan');

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Payment Recovery</h1>
            <p className="text-sm text-muted-foreground">Monitor, diagnose, and recover Paystack checkout payments</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={handleRunRecovery} disabled={processing === 'recovery'} className="gap-1.5">
              {processing === 'recovery' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run Recovery
            </Button>
            <Button variant="outline" onClick={loadAttempts} disabled={loading} className="gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>

        {/* Blind Sweep monitoring */}
        <BlindSweepMonitor onRecovered={loadAttempts} />

        {/* Stats — clickable filters */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <Card className={`cursor-pointer transition hover:border-foreground/20 ${statusFilter === 'all' ? 'border-foreground/30' : ''}`} onClick={() => setStatusFilter('all')}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{attempts.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer transition hover:border-warning/40 ${statusFilter === 'pending' ? 'border-warning/40' : ''}`} onClick={() => setStatusFilter('pending')}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-warning">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer transition hover:border-destructive/40 ${statusFilter === 'needs_review' ? 'border-destructive/40 ring-2 ring-destructive/20' : ''}`} onClick={() => setStatusFilter('needs_review')}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-destructive">{reviewCount}</p>
              <p className="text-xs text-muted-foreground">Needs Review</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer transition hover:border-warning/40 ${statusFilter === 'partially_completed' ? 'border-warning/40' : ''}`} onClick={() => setStatusFilter('partially_completed')}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-warning">{partialCount}</p>
              <p className="text-xs text-muted-foreground">Partial</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer transition hover:border-primary/40 ${statusFilter === 'completed' ? 'border-primary/40' : ''}`} onClick={() => setStatusFilter('completed')}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-primary">{attempts.filter(a => a.status === 'completed').length}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer transition hover:border-warning/40 ${buyerTypeFilter === 'guest' ? 'border-warning/40' : ''}`} onClick={() => setBuyerTypeFilter(buyerTypeFilter === 'guest' ? 'all' : 'guest')}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-warning">{guestCount}</p>
              <p className="text-xs text-muted-foreground">Guest</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Ref, name, email, phone, affiliate..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
              <SelectItem value="partially_completed">Partial</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="abandoned">Abandoned</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="data_direct">Data</SelectItem>
              <SelectItem value="checker_direct">Checker</SelectItem>
            </SelectContent>
          </Select>
          <Select value={buyerTypeFilter} onValueChange={setBuyerTypeFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Buyer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buyers</SelectItem>
              <SelectItem value="registered">Registered</SelectItem>
              <SelectItem value="guest">Guest</SelectItem>
            </SelectContent>
          </Select>
          <DateFilter datePreset={datePreset} customDate={customDate} onPresetChange={setDatePreset} onCustomDateChange={setCustomDate} />
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : displayed.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No payment attempts found</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayed.map(a => {
                      const badge = STATUS_BADGE[a.status] || { variant: 'outline' as const, label: a.status };
                      const isPartial = a.items_total != null && a.items_succeeded != null && a.items_succeeded < a.items_total && a.items_succeeded > 0;
                      const orphan = isOrphan(a);
                      const isGuest = a.buyer_type === 'guest';
                      return (
                        <TableRow key={a.id} className={orphan ? 'bg-warning/10' : a.status === 'needs_review' ? 'bg-destructive/5' : isPartial ? 'bg-warning/5' : ''}>
                          <TableCell className="font-mono text-xs max-w-[140px] truncate">
                            {orphan && <Badge variant="outline" className="text-[9px] mr-1 border-warning text-warning">Orphan</Badge>}
                            {a.paystack_reference}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium">{a.customer_name || '—'}</div>
                            <div className="text-muted-foreground">{a.customer_email || a.buyer_email || ''}</div>
                          </TableCell>
                          <TableCell>
                            {isGuest ? (
                              <Badge variant="outline" className="text-[9px] gap-0.5 border-warning/40 text-warning bg-warning/10">
                                <UserX className="w-2.5 h-2.5" /> Guest
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] gap-0.5 border-primary/40 text-primary bg-primary/10">
                                <User className="w-2.5 h-2.5" /> Reg
                              </Badge>
                            )}
                            {a.affiliate_code && (
                              <Badge variant="outline" className="text-[9px] ml-1 border-purple-500/40 text-purple-500 bg-purple-500/10">
                                {a.affiliate_code}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {a.attempt_type === 'data_direct' ? 'Data' : 'Checker'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-semibold">{formatGHS(a.amount)}</TableCell>
                          <TableCell>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {a.items_total != null ? (
                              <span className={isPartial ? 'text-warning font-medium' : ''}>
                                {a.items_succeeded ?? 0}/{a.items_total}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{a.finalized_by || '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatTs(a.created_at)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDetailItem(a)} title="View details">
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                              {['pending', 'needs_review', 'failed', 'partially_completed'].includes(a.status) && (
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleVerifyAndReprocess(a)}
                                  disabled={processing === a.id} title="Verify & reprocess">
                                  {processing === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                </Button>
                              )}
                              {orphan && (
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-warning" onClick={() => handleOpenAttach(a)} title="Attach to pending attempt">
                                  <Link2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setNoteDialog(a); setNoteText(''); }} title="Add note">
                                <MessageSquare className="w-3.5 h-3.5" />
                              </Button>
                              {a.status === 'needs_review' && (
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleMarkReviewed(a)} title="Mark reviewed">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailItem} onOpenChange={() => setDetailItem(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payment Attempt Details</DialogTitle></DialogHeader>
          {detailItem && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono text-xs break-all">{detailItem.paystack_reference}</span>
                <span className="text-muted-foreground">Type</span>
                <span>{detailItem.attempt_type === 'data_direct' ? 'Data Order' : 'Checker Purchase'}</span>
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatGHS(detailItem.amount)}</span>
                <span className="text-muted-foreground">Status</span>
                <Badge variant={STATUS_BADGE[detailItem.status]?.variant || 'outline'} className="w-fit">
                  {STATUS_BADGE[detailItem.status]?.label || detailItem.status}
                </Badge>
                <span className="text-muted-foreground">Buyer Type</span>
                <span>{detailItem.buyer_type === 'guest' ? (
                  <Badge variant="outline" className="text-[9px] gap-0.5 border-warning/40 text-warning bg-warning/10"><UserX className="w-2.5 h-2.5" /> Guest</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] gap-0.5 border-primary/40 text-primary bg-primary/10"><User className="w-2.5 h-2.5" /> Registered</Badge>
                )}</span>
                <span className="text-muted-foreground">Customer</span>
                <span>{detailItem.customer_name || detailItem.customer_id}</span>
                {detailItem.buyer_type === 'guest' && detailItem.buyer_phone && <>
                  <span className="text-muted-foreground">Buyer Phone</span>
                  <span className="font-mono text-xs">{detailItem.buyer_phone}</span>
                </>}
                {detailItem.buyer_type === 'guest' && detailItem.buyer_email && <>
                  <span className="text-muted-foreground">Buyer Email</span>
                  <span className="text-xs">{detailItem.buyer_email}</span>
                </>}
                {detailItem.affiliate_code && <>
                  <span className="text-muted-foreground">Affiliate</span>
                  <Badge variant="outline" className="text-[9px] w-fit border-purple-500/40 text-purple-500 bg-purple-500/10">{detailItem.affiliate_code}</Badge>
                </>}
                {detailItem.items_total != null && <>
                  <span className="text-muted-foreground">Items</span>
                  <span className={(detailItem.items_succeeded ?? 0) < (detailItem.items_total ?? 0) ? 'text-warning font-medium' : ''}>
                    {detailItem.items_succeeded ?? 0} / {detailItem.items_total} succeeded
                  </span>
                </>}
                <span className="text-muted-foreground">Finalized By</span>
                <span>{detailItem.finalized_by || '—'}</span>
                <span className="text-muted-foreground">Paystack TX ID</span>
                <span className="font-mono text-xs">{detailItem.paystack_transaction_id || '—'}</span>
              </div>

              {/* Partial failure detail */}
              {detailItem.status === 'partially_completed' && detailItem.event_log && (
                <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    <span className="text-sm font-semibold text-warning">Partial Failure</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {detailItem.items_succeeded}/{detailItem.items_total} items succeeded.
                    {detailItem.buyer_type === 'guest'
                      ? ' Guest refund has been queued (refund_pending) — process via Refunds.'
                      : ' Failed-item amount has been auto-credited to the customer\'s wallet.'}
                  </p>
                  {detailItem.event_log
                    .filter((e: any) => e.type === 'finalized' && e.item_results)
                    .slice(-1)
                    .map((e: any, i: number) => (
                      <div key={i} className="space-y-1">
                        {(e.item_results || []).map((r: any, j: number) => (
                          <div key={j} className={`text-[11px] flex justify-between px-2 py-1 rounded ${r.success ? 'bg-primary/5' : 'bg-destructive/5'}`}>
                            <span>Item {r.index + 1}: {r.success ? (r.already_processed ? 'Already done' : 'OK') : 'Failed'}</span>
                            {r.error && <span className="text-destructive">{r.error}</span>}
                            {r.order_id && <span className="font-mono text-[10px] text-muted-foreground">{r.order_id.substring(0, 8)}</span>}
                          </div>
                        ))}
                      </div>
                    ))
                  }
                </div>
              )}

              {/* Timeline */}
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Timeline</p>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatTs(detailItem.created_at)}</span>
                  <span className="text-muted-foreground">Webhook Received</span>
                  <span>{formatTs(detailItem.webhook_received_at)}</span>
                  <span className="text-muted-foreground">Callback Received</span>
                  <span>{formatTs(detailItem.callback_received_at)}</span>
                  <span className="text-muted-foreground">Last Verified</span>
                  <span>{formatTs(detailItem.last_verified_at)}</span>
                  <span className="text-muted-foreground">Recovery Attempts</span>
                  <span>{detailItem.recovery_attempts || 0}{detailItem.last_recovery_at ? ` (last: ${formatTs(detailItem.last_recovery_at)})` : ''}</span>
                  <span className="text-muted-foreground">Finalized At</span>
                  <span>{formatTs(detailItem.finalized_at)}</span>
                </div>
              </div>

              {detailItem.error_message && (
                <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs">
                  <AlertCircle className="w-3.5 h-3.5 inline mr-1.5" />
                  {detailItem.error_message}
                </div>
              )}

              {detailItem.metadata && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Order Metadata</p>
                  <pre className="text-[10px] bg-muted/30 p-2 rounded overflow-auto max-h-32">{JSON.stringify(detailItem.metadata, null, 2)}</pre>
                </div>
              )}

              {Array.isArray(detailItem.event_log) && detailItem.event_log.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Event Log</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {detailItem.event_log.map((ev: any, i: number) => {
                      const isError = ev.type?.includes('failed') || ev.type?.includes('error') || ev.type?.includes('abandoned');
                      const isNote = ev.type === 'admin_note';
                      const isAttach = ev.type?.includes('orphan') || ev.type?.includes('attach');
                      return (
                        <div key={i} className={`text-[11px] p-2 rounded-lg border flex gap-2 ${isError ? 'border-destructive/20 bg-destructive/5' : isNote ? 'border-primary/20 bg-primary/5' : isAttach ? 'border-warning/20 bg-warning/5' : 'border-border bg-muted/20'}`}>
                          {eventIcon(ev.type || '')}
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-2">
                              <span className="font-medium text-foreground capitalize">{(ev.type || '').replace(/_/g, ' ')}</span>
                              <span className="text-muted-foreground text-[10px] shrink-0">{ev.timestamp ? formatTs(ev.timestamp) : ''}</span>
                            </div>
                            {ev.source && <span className="text-muted-foreground">via {ev.source}</span>}
                            {ev.note && <p className="text-foreground mt-0.5">{ev.note}</p>}
                            {ev.error && <p className="text-destructive mt-0.5">{ev.error}</p>}
                            {ev.reason && <p className="text-warning mt-0.5">Reason: {ev.reason}</p>}
                            {ev.paystack_status && <p className="text-muted-foreground mt-0.5">Paystack: {ev.paystack_status}</p>}
                            {ev.orphan_reference && <p className="text-muted-foreground mt-0.5">Orphan ref: <span className="font-mono">{ev.orphan_reference}</span></p>}
                            {ev.matched_attempt_id && <p className="text-muted-foreground mt-0.5">Matched: {ev.matched_attempt_id.substring(0, 8)}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Note dialog */}
      <Dialog open={!!noteDialog} onOpenChange={() => setNoteDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Note</DialogTitle></DialogHeader>
          <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Enter note..." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialog(null)}>Cancel</Button>
            <Button onClick={handleAddNote} disabled={!noteText.trim()}>Save Note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach Orphan dialog */}
      <Dialog open={!!attachDialog} onOpenChange={() => setAttachDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-warning" />
              Attach Orphan Payment
            </DialogTitle>
          </DialogHeader>
          {attachDialog && (
            <div className="space-y-4 text-sm">
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                <p className="text-xs text-muted-foreground mb-1">Orphan webhook payment:</p>
                <p className="font-mono text-xs">{attachDialog.paystack_reference}</p>
                <p className="mt-1">{formatGHS(attachDialog.amount)} • {attachDialog.attempt_type === 'data_direct' ? 'Data' : 'Checker'}
                  {attachDialog.buyer_type === 'guest' && ' • Guest'}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                Select a matching pending attempt to attach this payment to.
              </p>

              {attachLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : attachCandidates.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-xs">No matching candidates found in the ±10 minute window.</div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {attachCandidates.map(c => {
                    const amountMatch = Math.abs(c.amount - attachDialog.amount) < 1;
                    const customerMatch = c.customer_id === attachDialog.customer_id;
                    return (
                      <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
                        <div>
                          <p className="font-mono text-xs">{c.paystack_reference}</p>
                          <p className="text-xs text-muted-foreground">{c.customer_name || c.customer_id.substring(0, 8)} • {formatGHS(c.amount)}</p>
                          <div className="flex gap-1 mt-1">
                            {amountMatch && <Badge variant="outline" className="text-[9px]">Amount ✓</Badge>}
                            {customerMatch && <Badge variant="outline" className="text-[9px]">Customer ✓</Badge>}
                            <Badge variant="outline" className="text-[9px]">{c.status}</Badge>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => handleAttachOrphan(attachDialog, c)}
                          disabled={processing === attachDialog.id}>
                          {processing === attachDialog.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                          Attach
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
