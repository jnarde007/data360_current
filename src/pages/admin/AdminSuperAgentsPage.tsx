import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/AdminLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/mock-data';
import { useAuth } from '@/contexts/AuthContext';
import { Crown, Loader2, Search, RotateCcw, Save } from 'lucide-react';

interface AgentRow {
  customer_id: string; full_name: string; email: string; phone: string;
  sa_status: 'active' | 'suspended' | 'revoked' | null;
  granted_at: string | null; granted_by_name: string | null;
  status_changed_at: string | null; status_changed_by_name: string | null;
}
interface PriceRow {
  id: string; network: string; size: string; price: number; cost_price: number;
  override_price: number | null; super_agent_price: number;
}
type Action = 'promote' | 'demote' | 'suspend' | 'reactivate';
const ACTION_LABEL: Record<Action, string> = { promote: 'Promote to Super Agent', demote: 'Demote to customer', suspend: 'Suspend', reactivate: 'Reactivate' };
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
const errMsg = (e: any) => (e?.message || 'Something went wrong').replace(/^[A-Z_]+: /, '');

function StatusBadge({ s }: { s: AgentRow['sa_status'] }) {
  if (s === 'active') return <Badge className="bg-success/15 text-success hover:bg-success/15">Active</Badge>;
  if (s === 'suspended') return <Badge className="bg-amber/15 text-amber hover:bg-amber/15">Suspended</Badge>;
  if (s === 'revoked') return <Badge variant="outline">Demoted</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Customer</Badge>;
}

function AgentsTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ row: AgentRow; action: Action } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_super_agents' as any, { p_search: q });
    if (error) toast({ title: 'Could not load', description: errMsg(error), variant: 'destructive' });
    setRows((data as AgentRow[]) || []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { const t = setTimeout(() => load(search.trim()), 300); return () => clearTimeout(t); }, [search, load]);

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_super_agent_status' as any, { p_customer_id: pending.row.customer_id, p_action: pending.action });
    setBusy(false);
    if (error) { toast({ title: 'Action failed', description: errMsg(error), variant: 'destructive' }); return; }
    toast({ title: 'Updated', description: `${pending.row.full_name}: ${ACTION_LABEL[pending.action]}` });
    setPending(null);
    load(search.trim());
  };

  const actionsFor = (r: AgentRow): Action[] =>
    r.sa_status === 'active' ? ['suspend', 'demote'] : r.sa_status === 'suspended' ? ['reactivate', 'demote'] : ['promote'];

  return (
    <Card className="p-4 space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search any customer by name, email, phone or username" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">{search.trim() ? 'Search results' : 'Showing customers who are or were Super Agents. Search to find others.'}</p>
      {loading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No customers found.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Granted</TableHead><TableHead>Last change</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.customer_id}>
                  <TableCell><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted-foreground">{r.email} · {r.phone}</div></TableCell>
                  <TableCell><StatusBadge s={r.sa_status} /></TableCell>
                  <TableCell className="text-xs">{r.granted_at ? <>{fmtDate(r.granted_at)}<div className="text-muted-foreground">by {r.granted_by_name || '—'}</div></> : '—'}</TableCell>
                  <TableCell className="text-xs">{r.status_changed_at && r.sa_status ? <>{fmtDate(r.status_changed_at)}<div className="text-muted-foreground">by {r.status_changed_by_name || '—'}</div></> : '—'}</TableCell>
                  <TableCell className="text-right space-x-2 whitespace-nowrap">
                    {actionsFor(r).map(a => (
                      <Button key={a} size="sm" variant={a === 'demote' || a === 'suspend' ? 'outline' : 'default'} onClick={() => setPending({ row: r, action: a })}>
                        {ACTION_LABEL[a]}
                      </Button>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={o => !o && setPending(null)}
        title={pending ? ACTION_LABEL[pending.action] : ''}
        description={pending ? `${pending.row.full_name} (${pending.row.email}). Their wallet, orders and history are not affected.` : ''}
        confirmLabel="Confirm"
        loading={busy}
        destructive={pending?.action === 'demote'}
        onConfirm={run}
      />
    </Card>
  );
}

function PricingTab() {
  const { toast } = useToast();
  const [items, setItems] = useState<PriceRow[]>([]);
  const [discount, setDiscount] = useState('0');
  const [savedDiscount, setSavedDiscount] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_super_agent_pricing' as any);
    if (error) { toast({ title: 'Could not load pricing', description: errMsg(error), variant: 'destructive' }); setLoading(false); return; }
    const d = data as { default_discount_pct: number; items: PriceRow[] };
    setItems((d.items || []).map(i => ({ ...i, price: Number(i.price), cost_price: Number(i.cost_price), super_agent_price: Number(i.super_agent_price), override_price: i.override_price == null ? null : Number(i.override_price) })));
    setSavedDiscount(Number(d.default_discount_pct)); setDiscount(String(Number(d.default_discount_pct)));
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const saveDiscount = async () => {
    const n = Number(discount);
    if (!Number.isFinite(n) || n < 0 || n >= 100) { toast({ title: 'Enter a discount between 0 and 99.99', variant: 'destructive' }); return; }
    setBusy('discount');
    const { error } = await supabase.rpc('admin_set_super_agent_default_discount' as any, { p_pct: n });
    setBusy(null);
    if (error) { toast({ title: 'Save failed', description: errMsg(error), variant: 'destructive' }); return; }
    toast({ title: 'Default discount saved' }); load();
  };

  const saveOverride = async (row: PriceRow, value: number | null) => {
    if (value !== null && (!Number.isFinite(value) || value <= 0)) { toast({ title: 'Enter a valid price', variant: 'destructive' }); return; }
    setBusy(row.id);
    const { error } = await supabase.rpc('admin_set_super_agent_override' as any, { p_price_item_id: row.id, p_price: value });
    setBusy(null);
    if (error) { toast({ title: 'Save failed', description: errMsg(error), variant: 'destructive' }); return; }
    setDrafts(d => { const n = { ...d }; delete n[row.id]; return n; });
    toast({ title: value === null ? 'Reset to automatic' : 'Override saved' }); load();
  };

  const grouped = useMemo(() => {
    const g: Record<string, PriceRow[]> = {};
    items.forEach(i => { (g[i.network] ||= []).push(i); });
    return g;
  }, [items]);

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="sa-discount">Default Super Agent discount (%)</label>
          <Input id="sa-discount" type="number" min={0} max={99.99} step="0.01" className="w-40" value={discount} onChange={e => setDiscount(e.target.value)} />
        </div>
        <Button onClick={saveDiscount} disabled={busy === 'discount' || Number(discount) === savedDiscount}>
          {busy === 'discount' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </Button>
        <p className="text-xs text-muted-foreground basis-full">Applied to the ordinary customer price for every bundle without an override. Prices never go below cost price or above the ordinary price.</p>
      </Card>
      {Object.entries(grouped).map(([network, rows]) => (
        <Card key={network} className="p-4">
          <h3 className="font-display font-bold mb-3">{network}</h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Bundle</TableHead><TableHead>Customer price</TableHead><TableHead>Cost</TableHead><TableHead>Super Agent price</TableHead><TableHead>Source</TableHead><TableHead>Override</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => {
                  const draft = drafts[r.id] ?? '';
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.size}</TableCell>
                      <TableCell>{formatGHS(r.price)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatGHS(r.cost_price)}</TableCell>
                      <TableCell className="font-semibold text-primary">{formatGHS(r.super_agent_price)}</TableCell>
                      <TableCell>{r.override_price != null ? <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Manual</Badge> : <Badge variant="outline">Automatic</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.01" min={0} className="w-24 h-8" placeholder={r.override_price != null ? String(r.override_price) : 'Set'} value={draft}
                            onChange={e => setDrafts(d => ({ ...d, [r.id]: e.target.value }))} aria-label={`Override ${network} ${r.size}`} />
                          <Button size="sm" disabled={!draft || busy === r.id} onClick={() => saveOverride(r, Number(draft))}>Save</Button>
                          {r.override_price != null && (
                            <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => saveOverride(r, null)} title="Reset to automatic"><RotateCcw className="h-3.5 w-3.5" /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function AdminSuperAgentsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.adminRole === 'Super Admin';
  if (!isSuperAdmin) {
    return (
      <AdminLayout>
        <Card className="p-8 text-center space-y-2 max-w-lg mx-auto mt-10">
          <Crown className="h-8 w-8 mx-auto text-amber" />
          <h1 className="text-lg font-display font-bold">Super Admin access required</h1>
          <p className="text-sm text-muted-foreground">Only Super Admins can manage Super Agents and their pricing.</p>
        </Card>
      </AdminLayout>
    );
  }
  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber/15 text-amber flex items-center justify-center"><Crown className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-display font-bold">Super Agents</h1>
            <p className="text-sm text-muted-foreground">Approve resellers and manage their special prices.</p>
          </div>
        </div>
        <Tabs defaultValue="agents">
          <TabsList><TabsTrigger value="agents">Super Agents</TabsTrigger><TabsTrigger value="pricing">Super Agent Pricing</TabsTrigger></TabsList>
          <TabsContent value="agents" className="mt-4"><AgentsTab /></TabsContent>
          <TabsContent value="pricing" className="mt-4"><PricingTab /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
