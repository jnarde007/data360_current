import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeAdminFunction } from '@/lib/admin-functions';
import { AdminLayout } from '@/components/AdminLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import {
  Loader2, RefreshCw, Search, Wallet, CreditCard, Smartphone, CheckCircle2, XCircle, Clock,
} from 'lucide-react';

interface RefundRow {
  id: string;
  order_id: string | null;
  customer_id: string | null;
  buyer_type: string;
  refund_destination: string;
  refund_method: string;
  customer_has_wallet: boolean;
  refund_amount: number;
  total_refunded: number;
  status: string;
  refund_reason: string | null;
  error_message: string | null;
  admin_note: string | null;
  momo_number: string | null;
  provider_name: string | null;
  provider_reference: string | null;
  paystack_refund_id: string | null;
  created_at: string;
  completed_at: string | null;
  timeline: unknown;
  orders?: { short_id: string; recipient_phone: string; network: string; bundle_size: string } | null;
}

const STATUS_META: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30', icon: Clock },
  refund_pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30', icon: Clock },
  processing: { label: 'Processing', className: 'bg-primary text-primary-foreground border-primary', icon: Loader2 },
  completed: { label: 'Refunded', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30', icon: CheckCircle2 },
  refunded: { label: 'Refunded', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30', icon: CheckCircle2 },
  failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
  refund_failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
  reversed: { label: 'Reversed', className: 'bg-muted text-muted-foreground border-border', icon: XCircle },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground border-border', icon: XCircle },
};

const DEST_META: Record<string, { label: string; icon: typeof Wallet }> = {
  wallet: { label: 'Wallet', icon: Wallet },
  paystack: { label: 'Paystack', icon: CreditCard },
  momo: { label: 'Mobile Money', icon: Smartphone },
};

export default function AdminRefundsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [detail, setDetail] = useState<RefundRow | null>(null);
  const [momoTarget, setMomoTarget] = useState<RefundRow | null>(null);
  const [momoNumber, setMomoNumber] = useState('');
  const [momoNote, setMomoNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('refunds')
      .select('*, orders(short_id, recipient_phone, network, bundle_size)')
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Failed to load refunds', description: error.message, variant: 'destructive' });
    } else {
      setRows((data as unknown as RefundRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const statusOk =
        statusFilter === 'all' ||
        (statusFilter === 'completed' && ['completed', 'refunded'].includes(r.status)) ||
        (statusFilter === 'failed' && ['failed', 'refund_failed'].includes(r.status)) ||
        (statusFilter === 'pending' && ['pending', 'refund_pending', 'processing'].includes(r.status));
      if (!statusOk) return false;
      if (!q) return true;
      return [
        r.orders?.short_id, r.orders?.recipient_phone, r.momo_number,
        r.provider_reference, r.paystack_refund_id, r.refund_destination,
      ].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const done = rows.filter(r => ['completed', 'refunded'].includes(r.status));
    return {
      total: rows.length,
      refunded: done.reduce((s, r) => s + Number(r.total_refunded || r.refund_amount), 0),
      pending: rows.filter(r => ['pending', 'refund_pending', 'processing'].includes(r.status)).length,
      failed: rows.filter(r => ['failed', 'refund_failed'].includes(r.status)).length,
    };
  }, [rows]);

  const retry = async (row: RefundRow) => {
    if (!row.order_id) return;
    setBusy(true);
    const { data, error } = await invokeAdminFunction('process-order-refund', {
      order_id: row.order_id,
      provider_name: row.provider_name || 'Portal-02',
      provider_reference: row.provider_reference || '',
      reason: 'Admin retry',
    });
    setBusy(false);
    if (error || data?.error) {
      toast({ title: 'Retry failed', description: error?.message || data?.error, variant: 'destructive' });
    } else {
      toast({ title: 'Refund reprocessed', description: `Destination: ${data?.destination || 'unknown'}` });
      load();
    }
  };

  const approveMomo = async () => {
    if (!momoTarget) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_approve_momo_refund', {
      p_refund_id: momoTarget.id,
      p_momo_number: momoNumber.replace(/\s+/g, ''),
      p_admin_note: momoNote,
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) {
      toast({ title: 'Could not approve', description: error?.message || res?.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Mobile Money refund approved', description: 'Pay out manually, then mark it completed.' });
    setMomoTarget(null);
    load();
  };

  const setStatus = async (row: RefundRow, status: string) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_set_refund_status', {
      p_refund_id: row.id, p_status: status, p_admin_note: '',
    });
    setBusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) {
      toast({ title: 'Update failed', description: error?.message || res?.error, variant: 'destructive' });
      return;
    }
    load();
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const meta = STATUS_META[status] || STATUS_META.pending;
    return <Badge variant="outline" className={meta.className}>{meta.label}</Badge>;
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Refunds</h1>
            <p className="text-sm text-muted-foreground">
              Automatic provider refunds, their destination and settlement state.
            </p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4"><p className="text-xs text-muted-foreground">Total refunds</p><p className="text-lg font-semibold">{totals.total}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Amount refunded</p><p className="text-lg font-semibold">{formatGHS(totals.refunded)}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">In progress</p><p className="text-lg font-semibold text-amber-600">{totals.pending}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Needs attention</p><p className="text-lg font-semibold text-destructive">{totals.failed}</p></Card>
        </div>

        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search order ID, phone, reference…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">In progress</SelectItem>
                <SelectItem value="completed">Refunded</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No refunds found.</p>
          ) : (
            <>
            {/* Mobile cards */}
            <div className="md:hidden space-y-2.5">
              {filtered.map(r => {
                const dest = DEST_META[r.refund_destination] || DEST_META.wallet;
                const DestIcon = dest.icon;
                const isFailed = ['failed', 'refund_failed'].includes(r.status);
                const isOpen = ['processing', 'pending', 'refund_pending'].includes(r.status);
                return (
                  <div key={r.id} className="rounded-2xl border border-border bg-card p-3.5 space-y-2.5" onClick={() => setDetail(r)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold text-foreground">{r.orders?.short_id || '—'}</p>
                        <p className="text-[11px] text-muted-foreground">{r.orders?.recipient_phone}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <DestIcon className="w-3.5 h-3.5" /> {dest.label} · <span className="capitalize">{r.customer_has_wallet ? 'Registered' : r.buyer_type}</span>
                      </span>
                      <span className="font-semibold text-foreground">{formatGHS(Number(r.refund_amount))}</span>
                    </div>
                    <p className="text-[10.5px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                    {(isFailed || isOpen) && (
                      <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                        {isFailed && (
                          <>
                            <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => retry(r)}>Retry</Button>
                            <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={() => { setMomoTarget(r); setMomoNumber(r.momo_number || ''); setMomoNote(''); }}>MoMo</Button>
                          </>
                        )}
                        {isOpen && (
                          <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => setStatus(r, 'completed')}>Mark paid</Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const dest = DEST_META[r.refund_destination] || DEST_META.wallet;
                    const DestIcon = dest.icon;
                    const isFailed = ['failed', 'refund_failed'].includes(r.status);
                    return (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                        <TableCell className="font-mono text-xs">
                          {r.orders?.short_id || '—'}
                          <div className="text-[11px] text-muted-foreground">{r.orders?.recipient_phone}</div>
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {r.customer_has_wallet ? 'Registered' : r.buyer_type}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <DestIcon className="w-3.5 h-3.5 text-muted-foreground" /> {dest.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatGHS(Number(r.refund_amount))}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-end gap-2">
                            {isFailed && (
                              <>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => retry(r)}>Retry</Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setMomoTarget(r);
                                    setMomoNumber(r.momo_number || '');
                                    setMomoNote('');
                                  }}
                                >
                                  MoMo
                                </Button>
                              </>
                            )}
                            {['processing', 'pending', 'refund_pending'].includes(r.status) && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(r, 'completed')}>
                                Mark paid
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
            </>
          )}
        </Card>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Refund {detail?.orders?.short_id || ''}</DialogTitle>
            <DialogDescription>Full audit trail for this refund.</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Amount</p><p className="font-medium">{formatGHS(Number(detail.refund_amount))}</p></div>
                <div><p className="text-xs text-muted-foreground">Destination</p><p className="font-medium capitalize">{detail.refund_destination}</p></div>
                <div><p className="text-xs text-muted-foreground">Provider</p><p className="font-medium">{detail.provider_name || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Provider ref</p><p className="font-mono text-xs">{detail.provider_reference || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Paystack refund</p><p className="font-mono text-xs">{detail.paystack_refund_id || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">MoMo number</p><p className="font-mono text-xs">{detail.momo_number || '—'}</p></div>
              </div>
              {detail.error_message && (
                <p className="text-xs text-destructive">{detail.error_message}</p>
              )}
              {detail.admin_note && <p className="text-xs text-muted-foreground">Note: {detail.admin_note}</p>}
              <div className="rounded-xl border border-border/60 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Timeline</p>
                {(Array.isArray(detail.timeline) ? detail.timeline : []).map((t: any, i: number) => (
                  <div key={i} className="text-xs flex gap-2">
                    <span className="text-muted-foreground shrink-0">{new Date(t.at).toLocaleString()}</span>
                    <span className="font-medium">{t.event}</span>
                    <span className="text-muted-foreground">{t.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* MoMo fallback dialog */}
      <Dialog open={!!momoTarget} onOpenChange={o => !o && setMomoTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Mobile Money refund</DialogTitle>
            <DialogDescription>
              Only use this when the Paystack refund cannot go through. The system blocks approval
              if a Paystack refund is still in flight.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="momo">Mobile Money number</Label>
              <Input id="momo" value={momoNumber} onChange={e => setMomoNumber(e.target.value)} placeholder="0201234567" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Admin note</Label>
              <Input id="note" value={momoNote} onChange={e => setMomoNote(e.target.value)} placeholder="Reason / reference" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMomoTarget(null)}>Cancel</Button>
            <Button onClick={approveMomo} disabled={busy || momoNumber.replace(/\D/g, '').length < 9}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Approve
            </Button>
          </DialogFooter>
        </DialogContent>

      </Dialog>
    </AdminLayout>
  );
}
