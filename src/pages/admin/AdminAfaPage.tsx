import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/AdminLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import { Loader2, UserPlus, Search, CheckCircle2, XCircle, ArrowUp, ArrowDown, ArrowUpDown, Eye, ChevronUp, UserRound, BadgeCheck, ReceiptText, Database, CalendarClock, Phone, Mail, MapPin } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';

interface AfaRow {
  id: string;
  short_id: string;
  customer_id?: string | null;
  full_name: string;
  registration_phone: string;
  location: string;
  buyer_phone: string;
  buyer_email: string;
  status: string;
  total_amount: number;
  payment_method: string;
  payment_reference?: string;
  buyer_type: string;
  admin_note: string;
  created_at: string;
}

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted', color: 'bg-primary text-primary-foreground border-primary' },
  { value: 'processing', label: 'Processing', color: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30' },
  { value: 'registered', label: 'Registered', color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30' },
  { value: 'rejected', label: 'Rejected', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30' },
];

type SortKey = 'created_at' | 'total_amount' | 'status';
type SortDir = 'asc' | 'desc';
const SORT_STORAGE_KEY = 'admin_afa_sort_v1';
// Status priority for sorting (most urgent first)
const STATUS_RANK: Record<string, number> = { submitted: 0, processing: 1, registered: 2, rejected: 3 };

const formatPlacedAt = (value: string) => {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
};

export default function AdminAfaPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AfaRow[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AfaRow | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Quick-action confirmation
  const [quickTarget, setQuickTarget] = useState<{ row: AfaRow; status: 'registered' | 'rejected' } | null>(null);
  const [quickWorking, setQuickWorking] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Load persisted sort preference once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.key) setSortKey(parsed.key);
        if (parsed?.dir) setSortDir(parsed.dir);
      }
    } catch {}
  }, []);

  // Persist whenever it changes
  useEffect(() => {
    try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir })); } catch {}
  }, [sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Sensible defaults: dates newest-first, amount high-first, status urgent-first
      setSortDir(key === 'status' ? 'asc' : 'desc');
    }
  };

  const load = async () => {
    setLoading(true);
    let q = supabase.from('afa_registrations').select('*').order('created_at', { ascending: false });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data } = await q;
    const list = (data || []) as AfaRow[];
    setRows(list);

    const ids = Array.from(new Set(list.map(r => r.customer_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, full_name')
        .in('id', ids);
      const map: Record<string, string> = {};
      (customers || []).forEach((c: any) => { map[c.id] = c.full_name; });
      setCustomerNames(map);
    } else {
      setCustomerNames({});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = rows
    .filter(r => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return r.short_id.toLowerCase().includes(s)
        || r.full_name.toLowerCase().includes(s)
        || r.registration_phone.includes(s)
        || r.buyer_phone.includes(s)
        || r.location.toLowerCase().includes(s)
        || ((r.customer_id && customerNames[r.customer_id]) || '').toLowerCase().includes(s);
    })
    .slice()
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'created_at') {
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      }
      if (sortKey === 'total_amount') {
        return (Number(a.total_amount) - Number(b.total_amount)) * dir;
      }
      // status
      const ra = STATUS_RANK[a.status] ?? 99;
      const rb = STATUS_RANK[b.status] ?? 99;
      return (ra - rb) * dir;
    });

  const openEdit = (r: AfaRow) => {
    setEditing(r);
    setEditStatus(r.status);
    setEditNote(r.admin_note || '');
  };

  // Statuses that require server-side side-effects (refund / SMS).
  const requiresEdgeFunction = (s: string) => s === 'registered' || s === 'rejected';

  const callStatusEdge = async (id: string, newStatus: 'registered' | 'rejected', note?: string) => {
    const { data, error } = await supabase.functions.invoke('process-afa-status', {
      body: { registration_id: id, new_status: newStatus, admin_note: note },
    });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (requiresEdgeFunction(editStatus)) {
        await callStatusEdge(editing.id, editStatus as 'registered' | 'rejected', editNote);
      } else {
        const { error } = await supabase.from('afa_registrations').update({
          status: editStatus,
          admin_note: editNote,
          processed_at: new Date().toISOString(),
        }).eq('id', editing.id);
        if (error) throw error;
      }
      const verbMsg = editStatus === 'registered'
        ? 'Marked as registered. SMS sent to buyer.'
        : editStatus === 'rejected'
          ? 'Marked as rejected. Refund processed.'
          : `Marked as ${editStatus}.`;
      toast({ title: 'Updated', description: `${editing.short_id}: ${verbMsg}` });
      setEditing(null);
      load();
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const quickUpdate = (r: AfaRow, newStatus: 'registered' | 'rejected') => {
    setQuickTarget({ row: r, status: newStatus });
  };

  const runQuickUpdate = async () => {
    if (!quickTarget) return;
    const { row: r, status: newStatus } = quickTarget;
    setQuickWorking(true);
    try {
      await callStatusEdge(r.id, newStatus);
      toast({
        title: newStatus === 'registered' ? 'Approved' : 'Rejected',
        description: newStatus === 'registered'
          ? `${r.short_id}: SMS dispatched to buyer.`
          : `${r.short_id}: Refund processed (${r.buyer_type === 'guest' ? 'Paystack' : 'wallet'}).`,
      });
      load();
      setQuickTarget(null);
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    } finally {
      setQuickWorking(false);
    }
  };

  const statusBadge = (status: string) => {
    const opt = STATUS_OPTIONS.find(o => o.value === status);
    return <Badge variant="outline" className={opt?.color || ''}>{opt?.label || status}</Badge>;
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/15 text-yellow-600 dark:text-yellow-300 flex items-center justify-center">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold">AFA REGISTRATION</h1>
            <p className="text-sm text-muted-foreground">MTN AFA registration requests awaiting approval or rejection.</p>
          </div>
        </div>

        <Card className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by ID, name, phone, location" className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>

        {/* Sortable header chips — persist across filter changes */}
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-xs font-medium text-muted-foreground mr-1">Sort by:</span>
          {([
            { key: 'created_at', label: 'Date' },
            { key: 'total_amount', label: 'Amount' },
            { key: 'status', label: 'Status' },
          ] as { key: SortKey; label: string }[]).map(s => {
            const active = sortKey === s.key;
            const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
            return (
              <Button
                key={s.key}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => toggleSort(s.key)}
                className={`h-8 rounded-full gap-1.5 px-3 text-xs ${
                  active
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:border-primary/30'
                }`}
                aria-pressed={active}
              >
                {s.label}
                <Icon className="w-3.5 h-3.5" />
              </Button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">No AFA registrations found.</Card>
        ) : (
          <div className="space-y-2">
            {filtered.map(r => {
              const isOpen = expanded.has(r.id);
              const isFinal = r.status === 'registered' || r.status === 'rejected';
              const placedAt = formatPlacedAt(r.created_at);
              return (
              <Card key={r.id} className="overflow-hidden border-border/70 hover:shadow-md transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-muted/25 border-b border-border/60">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {statusBadge(r.status)}
                    <div>
                      <p className="font-mono text-sm font-semibold text-foreground">{r.short_id}</p>
                      <p className="text-[11px] text-muted-foreground">AFA registration reference</p>
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-sm font-bold text-foreground">{formatGHS(r.total_amount)}</p>
                    <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">{placedAt.date}</span> • {placedAt.time}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/60">
                  <section className="p-4">
                    <div className="flex items-center gap-2 mb-3 text-primary">
                      <UserRound className="w-4 h-4" />
                      <h3 className="text-xs font-bold uppercase tracking-wider">Placed By</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div className="col-span-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Customer Name</p>
                        <p className="font-semibold">{(r.customer_id && customerNames[r.customer_id]) || (r.buyer_type === 'guest' ? 'Guest' : '—')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Buyer Type</p>
                        <p className="font-medium capitalize">{r.buyer_type || '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.buyer_type === 'guest' ? 'Guest Number' : 'Customer Number'}</p>
                        <p className="font-mono">{r.buyer_phone || '—'}</p>
                      </div>
                      {r.buyer_email && (
                        <div className="col-span-2 min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Buyer Email</p>
                          <p className="break-all">{r.buyer_email}</p>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="p-4">
                    <div className="flex items-center gap-2 mb-3 text-warning">
                      <BadgeCheck className="w-4 h-4" />
                      <h3 className="text-xs font-bold uppercase tracking-wider">Beneficiary / Registration Details</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Beneficiary Name</p>
                        <p className="font-semibold">{r.full_name}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Registration Number</p>
                        <p className="font-mono">{r.registration_phone}</p>
                      </div>
                    </div>
                  </section>
                </div>

                {isOpen && (
                  <div className="grid grid-cols-1 md:grid-cols-2 border-t border-border/60 divide-y md:divide-y-0 md:divide-x divide-border/60 bg-muted/10">
                    <section className="p-4">
                      <div className="flex items-center gap-2 mb-3 text-primary">
                        <ReceiptText className="w-4 h-4" />
                        <h3 className="text-xs font-bold uppercase tracking-wider">Order & Payment</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</p><p className="font-semibold">{formatGHS(r.total_amount)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment Method</p><p className="capitalize">{r.payment_method?.replace(/_/g, ' ') || '—'}</p></div>
                        {r.payment_reference && <div className="col-span-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment Reference</p><p className="font-mono break-all">{r.payment_reference}</p></div>}
                      </div>
                    </section>
                    <section className="p-4">
                      <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                        <Database className="w-4 h-4" />
                        <h3 className="text-xs font-bold uppercase tracking-wider">System Information</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Internal ID</p><p className="font-mono">{r.short_id}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</p><p>{placedAt.date}<br/><span className="text-xs text-muted-foreground">{placedAt.time}</span></p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Location</p><p>{r.location || '—'}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Status</p><p className="capitalize">{r.status}</p></div>
                        {r.admin_note && <div className="col-span-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin Note</p><p className="italic">{r.admin_note}</p></div>}
                      </div>
                    </section>
                  </div>
                )}

                <div className="px-4 py-3 border-t border-border/60 flex flex-wrap gap-2 justify-end items-center bg-card">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleExpand(r.id)}
                    className="h-9 gap-1.5 mr-auto text-muted-foreground hover:text-foreground"
                    aria-label={isOpen ? 'Hide details' : 'Show details'}
                  >
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {isOpen ? 'Hide details' : 'Details'}
                  </Button>
                  {isFinal ? (
                    <span className="text-[10px] font-medium text-muted-foreground italic px-2 py-1 rounded bg-muted/50 border border-border/50">
                      Final status — locked
                    </span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={() => quickUpdate(r, 'registered')}
                        className="h-9 bg-success text-success-foreground hover:bg-success/90 gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => quickUpdate(r, 'rejected')}
                        className="h-9 border-destructive/40 text-destructive hover:bg-destructive/10 gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </Button>
                      <Button size="sm" variant="outline" className="h-9" onClick={() => openEdit(r)}>Edit</Button>
                    </>
                  )}
                </div>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update {editing?.short_id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Status</label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Admin Note (optional)</label>
              <Textarea value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Internal note about this registration" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!quickTarget}
        onOpenChange={(o) => { if (!o) setQuickTarget(null); }}
        title={quickTarget?.status === 'registered'
          ? 'Approve AFA registration?'
          : 'Reject and refund AFA registration?'}
        description={quickTarget ? (
          quickTarget.status === 'registered' ? (
            <>This will mark <strong>{quickTarget.row.short_id}</strong> as Registered and send a confirmation SMS to the buyer. This action cannot be undone.</>
          ) : (
            <>This will mark <strong>{quickTarget.row.short_id}</strong> as Rejected and process the refund ({quickTarget.row.buyer_type === 'guest' ? 'Paystack' : 'wallet'}). This action cannot be undone.</>
          )
        ) : ''}
        confirmLabel={quickTarget?.status === 'registered' ? 'Approve & Notify' : 'Reject & Refund'}
        destructive={quickTarget?.status === 'rejected'}
        loading={quickWorking}
        onConfirm={runQuickUpdate}
      />
    </AdminLayout>
  );
}
