import { useCallback, useEffect, useMemo, useState } from 'react';
import { hideProvider } from '@/lib/hide-provider';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { formatGHS } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Loader2, Search, Wallet, CreditCard, Smartphone, CheckCircle2, XCircle, Clock, RotateCcw,
} from 'lucide-react';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

interface RefundRow {
  id: string;
  order_id: string | null;
  refund_destination: string;
  refund_amount: number;
  total_refunded: number;
  status: string;
  refund_reason: string | null;
  momo_number: string | null;
  provider_name: string | null;
  provider_reference: string | null;
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
  failed: { label: 'Being reviewed', className: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
  refund_failed: { label: 'Being reviewed', className: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
  reversed: { label: 'Reversed', className: 'bg-muted text-muted-foreground border-border', icon: XCircle },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground border-border', icon: XCircle },
};

const DEST_META: Record<string, { label: string; hint: string; icon: typeof Wallet }> = {
  wallet: { label: 'Wallet credit', hint: 'Refunded straight into your DATA360 wallet balance.', icon: Wallet },
  paystack: { label: 'Original payment method', hint: 'Sent back to the card/MoMo account you paid with via Paystack.', icon: CreditCard },
  momo: { label: 'Mobile Money', hint: 'Paid out manually to your Mobile Money number.', icon: Smartphone },
};

const statusMeta = (s: string) => STATUS_META[s] ?? { label: s, className: 'bg-muted text-muted-foreground border-border', icon: Clock };
const destMeta = (d: string) => DEST_META[d] ?? { label: d || 'Pending decision', hint: '', icon: RotateCcw };

interface TimelineEntry { at?: string; event?: string; detail?: string }

const parseTimeline = (t: unknown): TimelineEntry[] =>
  Array.isArray(t) ? (t as TimelineEntry[]) : [];

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const maskPhone = (p?: string | null) =>
  p && p.length >= 6 ? `${p.slice(0, 4)}****${p.slice(-2)}` : p || '—';

export default function RefundsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<RefundRow | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('refunds')
      .select('id, order_id, refund_destination, refund_amount, total_refunded, status, refund_reason, momo_number, provider_name, provider_reference, created_at, completed_at, timeline, orders(short_id, recipient_phone, network, bundle_size)')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false });
    setRows(((data || []) as unknown) as RefundRow[]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['refunds'], load, 'customer-refunds-live');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.orders?.short_id || '').toLowerCase().includes(q) ||
      (r.provider_reference || '').toLowerCase().includes(q) ||
      (r.orders?.recipient_phone || '').includes(q)
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    const completed = rows.filter(r => ['completed', 'refunded'].includes(r.status));
    return {
      count: rows.length,
      inProgress: rows.filter(r => !['completed', 'refunded', 'cancelled', 'reversed'].includes(r.status)).length,
      amount: completed.reduce((s, r) => s + Number(r.total_refunded || r.refund_amount || 0), 0),
    };
  }, [rows]);

  if (loading) {
    return <CustomerLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></CustomerLayout>;
  }

  return (
    <CustomerLayout>
      <div className="space-y-6 sm:space-y-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">My Refunds</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every refund we process for you, where the money goes, and the full progress history.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          <Card className="rounded-3xl p-4 bg-primary/[0.06] border-primary/15">
            <p className="text-xs text-muted-foreground">Total refunds</p>
            <p className="text-2xl font-bold text-foreground mt-1">{totals.count}</p>
          </Card>
          <Card className="rounded-3xl p-4 bg-amber-500/[0.08] border-amber-500/20">
            <p className="text-xs text-muted-foreground">In progress</p>
            <p className="text-2xl font-bold text-foreground mt-1">{totals.inProgress}</p>
          </Card>
          <Card className="col-span-2 sm:col-span-1 rounded-3xl p-4 bg-emerald-500/[0.08] border-emerald-500/20">
            <p className="text-xs text-muted-foreground">Refunded to you</p>
            <p className="text-2xl font-bold text-foreground mt-1">{formatGHS(totals.amount)}</p>
          </Card>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order ID, phone or provider reference"
            className="pl-9 rounded-2xl"
          />
        </div>

        {filtered.length === 0 ? (
          <Card className="rounded-3xl p-10 text-center border-dashed">
            <RotateCcw className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium text-foreground">No refunds yet</p>
            <p className="text-sm text-muted-foreground mt-1">If an order can't be delivered, your refund will appear here automatically.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const s = statusMeta(r.status);
              const d = destMeta(r.refund_destination);
              const StatusIcon = s.icon;
              const DestIcon = d.icon;
              return (
                <Card
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setDetail(r); }}
                  className="rounded-3xl p-4 sm:p-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">
                          {r.orders?.short_id || 'Order'}
                        </span>
                        <Badge variant="outline" className={s.className}>
                          <StatusIcon className={`w-3 h-3 mr-1 ${r.status === 'processing' ? 'animate-spin' : ''}`} />
                          {s.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.orders ? `${r.orders.network} • ${r.orders.bundle_size} • ${maskPhone(r.orders.recipient_phone)}` : 'Order details unavailable'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <DestIcon className="w-3.5 h-3.5" /> {d.label}
                        {r.provider_reference ? <span className="ml-2">Ref: {r.provider_reference}</span> : null}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-foreground">{formatGHS(Number(r.refund_amount || 0))}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtDate(r.created_at)}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Refund details</DialogTitle>
            <DialogDescription>
              {detail?.orders?.short_id ? `For order ${detail.orders.short_id}` : 'Refund progress and destination'}
            </DialogDescription>
          </DialogHeader>

          {detail && (() => {
            const s = statusMeta(detail.status);
            const d = destMeta(detail.refund_destination);
            const StatusIcon = s.icon;
            const DestIcon = d.icon;
            const timeline = parseTimeline(detail.timeline);
            return (
              <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline" className={s.className}>
                    <StatusIcon className={`w-3 h-3 mr-1 ${detail.status === 'processing' ? 'animate-spin' : ''}`} />
                    {s.label}
                  </Badge>
                  <span className="text-xl font-bold text-foreground">{formatGHS(Number(detail.refund_amount || 0))}</span>
                </div>

                <div className="rounded-2xl bg-muted/40 p-4 space-y-1">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <DestIcon className="w-4 h-4" /> {d.label}
                  </p>
                  {d.hint && <p className="text-xs text-muted-foreground">{d.hint}</p>}
                  {detail.refund_destination === 'momo' && detail.momo_number && (
                    <p className="text-xs text-muted-foreground">To: {maskPhone(detail.momo_number)}</p>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Reference</dt>
                    <dd className="text-foreground break-all">{detail.provider_reference || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Requested</dt>
                    <dd className="text-foreground">{fmtDate(detail.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Completed</dt>
                    <dd className="text-foreground">{fmtDate(detail.completed_at)}</dd>
                  </div>
                  {detail.refund_reason && (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Reason</dt>
                      <dd className="text-foreground">{hideProvider(detail.refund_reason)}</dd>
                    </div>
                  )}
                </dl>

                <div>
                  <p className="text-sm font-semibold text-foreground mb-3">Timeline</p>
                  {timeline.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No progress updates recorded yet.</p>
                  ) : (
                    <ol className="relative border-l border-border/70 ml-2 space-y-4">
                      {timeline.map((t, i) => (
                        <li key={i} className="ml-4">
                          <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-primary" />
                          <p className="text-sm font-medium text-foreground capitalize">{hideProvider((t.event || 'update').replace(/_/g, ' '))}</p>
                          {t.detail && <p className="text-xs text-muted-foreground">{hideProvider(t.detail)}</p>}
                          <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(t.at)}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <Button variant="outline" className="w-full rounded-2xl" onClick={() => setDetail(null)}>Close</Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </CustomerLayout>
  );
}
