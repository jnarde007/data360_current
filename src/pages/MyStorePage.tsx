import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CustomerLayout } from '@/components/CustomerLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import { Store, Plus, Copy, ExternalLink, TrendingUp, ShoppingBag, Wallet, Users, Loader2, Eye, ArrowDownToLine, Upload, MousePointerClick, ShoppingCart, CheckCircle2, Clock, AlertTriangle, XCircle, PauseCircle, Download, GraduationCap } from 'lucide-react';
import { StoreOnboardingTour } from '@/components/store/StoreOnboardingTour';
import { exportRowsToCSV, csvTimestamp } from '@/lib/csv-export';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, CartesianGrid, Bar, BarChart, Pie, PieChart, Cell, Legend, Area, AreaChart } from 'recharts';

interface StoreRow {
  id: string; name: string; slug: string; description: string; logo_url: string; banner_url: string; status: string; created_at: string;
  contact_whatsapp?: string; contact_group_link?: string; contact_email?: string;
  afa_enabled?: boolean; afa_price?: number;
  rejection_reason?: string | null; rejected_at?: string | null;
  onboarding_completed?: boolean | null;
  onboarding_step?: number | null;
}
interface PriceItem { id: string; network: string; size: string; product: string; price: number; }
interface CheckerProduct { id: string; name: string; exam_type: string; price: number; status: string; }
interface StoreProduct { id: string; kind: 'data'|'checker'; price_item_id: string | null; checker_product_id: string | null; selling_price: number; active: boolean; }
interface WalletRow { available_balance: number; pending_balance: number; withdrawn_balance: number; locked_balance?: number; }
interface Withdrawal { id: string; source: 'payout' | 'legacy'; short_id?: string | null; amount: number; status: string; created_at: string; completed_at?: string | null; momo_number: string; momo_name: string; paystack_reference: string; admin_notes: string; failure_reason?: string | null; network?: string | null; }

const PERIODS = [
  { v: 'today', l: 'Today' },
  { v: 'week', l: 'This Week' },
  { v: 'month', l: 'This Month' },
  { v: 'year', l: 'This Year' },
  { v: 'custom', l: 'Custom Range' },
];

const SOURCE_COLORS = ['hsl(var(--primary))', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#64748b'];

function periodRange(period: string, from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (period === 'today') start.setHours(0, 0, 0, 0);
  else if (period === 'week') { start.setDate(now.getDate() - 6); start.setHours(0, 0, 0, 0); }
  else if (period === 'month') { start.setDate(1); start.setHours(0, 0, 0, 0); }
  else if (period === 'year') { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); }
  else if (period === 'custom' && from && to) {
    return { from: new Date(from + 'T00:00:00'), to: new Date(to + 'T23:59:59') };
  }
  return { from: start, to: end };
}

export default function MyStorePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [tourOpen, setTourOpen] = useState(false);
  const justCreatedStoreIdRef = useRef<string | null>(null);
  const autoTourShownRef = useRef<Set<string>>(new Set());

  const loadStores = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase.from('stores' as any).select('*').neq('status', 'deleted').order('created_at', { ascending: false });
    const rows = (data as any) || [];
    setStores(rows);
    if (rows.length && !activeStoreId) {
      const live = rows.find((r: StoreRow) => r.status !== 'rejected');
      setActiveStoreId((live || rows[0]).id);
    }
    setLoading(false);
  }, [user?.id, activeStoreId]);

  useEffect(() => { loadStores(); }, [loadStores]);

  // Realtime: refresh when any of the user's stores change status (admin approval, etc.)
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`my-stores-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores', filter: `owner_id=eq.${user.id}` }, () => loadStores())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, loadStores]);

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim()) {
      toast({ title: 'Missing fields', description: 'Name and slug are required.', variant: 'destructive' });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.rpc('create_store' as any, {
      p_name: newName.trim(),
      p_slug: newSlug.trim().toLowerCase(),
      p_description: newDesc.trim(),
    });
    setCreating(false);
    if (error) {
      toast({ title: 'Could not create store', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Store submitted for approval', description: 'An admin will review your store shortly. You can set up products in the meantime.' });
    const newStoreId = (data as any)?.store_id || '';
    if (newStoreId) {
      supabase.functions.invoke('store-owner-notify', {
        body: { event: 'store_created', store_id: newStoreId },
      }).catch(() => {});
    }
    setNewName(''); setNewSlug(''); setNewDesc('');
    setActiveStoreId(newStoreId);
    justCreatedStoreIdRef.current = newStoreId;
    loadStores();
  };

  const activeStore = stores.find(s => s.id === activeStoreId);

  // Auto-launch the in-app onboarding tour AT MOST ONCE per store owner.
  // Robust guards (any one prevents auto-open):
  //   a) Stores not yet loaded from backend (avoids flashing for unauthenticated/loading state).
  //   b) Store is rejected or deleted.
  //   c) DB flag `onboarding_completed` is true (authoritative across devices).
  //   d) Local `localStorage` flag set (covers the case where DB write failed offline,
  //      and prevents reopening on every page refresh after the user dismissed it).
  //   e) Already auto-shown in this session (StrictMode / re-render guard).
  // Manual restart from Settings → Help & Tutorial clears (d) so the user can replay.
  useEffect(() => {
    if (loading) return;
    if (!activeStore) return;
    if (activeStore.status === 'rejected' || activeStore.status === 'deleted') return;
    if (activeStore.onboarding_completed) return;
    if (autoTourShownRef.current.has(activeStore.id)) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(`store_tour_seen_v1:${activeStore.id}`)) {
        autoTourShownRef.current.add(activeStore.id);
        return;
      }
    } catch { /* ignore storage errors */ }
    autoTourShownRef.current.add(activeStore.id);
    // Small delay so the dashboard renders behind it.
    const t = setTimeout(() => {
      setTourOpen(true);
      try { window.localStorage.setItem(`store_tour_seen_v1:${activeStore.id}`, '1'); } catch { /* noop */ }
    }, 350);
    return () => clearTimeout(t);
  }, [loading, activeStore?.id, activeStore?.status, activeStore?.onboarding_completed]);

  const handleRestartTour = useCallback(() => {
    if (activeStore?.id) {
      try { window.localStorage.removeItem(`store_tour_seen_v1:${activeStore.id}`); } catch { /* noop */ }
      autoTourShownRef.current.delete(activeStore.id);
    }
    setTourOpen(true);
  }, [activeStore?.id]);

  return (
    <CustomerLayout>
      <div className="space-y-6">
        {loading ? (
          <Card className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></Card>
        ) : stores.length === 0 ? (
          <Card className="p-6 space-y-4 max-w-2xl">
            <div className="flex items-center gap-3">
              <Store className="w-6 h-6 text-primary" />
              <h2 className="text-xl font-bold">Create Your First Store</h2>
            </div>
            <p className="text-sm text-muted-foreground">Sell data bundles at your own prices and earn the difference. Share your store link to start selling.</p>
            <CreateStoreForm
              name={newName} setName={setNewName} slug={newSlug} setSlug={setNewSlug}
              desc={newDesc} setDesc={setNewDesc} onCreate={handleCreate} loading={creating}
            />
          </Card>
        ) : activeStore?.status === 'rejected' ? (
          <div className="space-y-4 max-w-2xl">
            <StoreStatusCard store={activeStore} />
            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Store className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-bold">Create a New Store</h2>
              </div>
              <p className="text-sm text-muted-foreground">Fix the issue mentioned above and resubmit. Your new store will go through review again.</p>
              <CreateStoreForm
                name={newName} setName={setNewName} slug={newSlug} setSlug={setNewSlug}
                desc={newDesc} setDesc={setNewDesc} onCreate={handleCreate} loading={creating}
              />
            </Card>
          </div>
        ) : (
          <>
            {activeStore && (activeStore.status === 'pending' || activeStore.status === 'suspended') && (
              <StoreStatusCard store={activeStore} />
            )}

            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-purple/5 to-accent/10 p-4 sm:p-5">
              <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-16 -left-10 w-40 h-40 rounded-full bg-accent/20 blur-3xl pointer-events-none" />
              <div className="relative flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3 mr-auto">
                  <div className="icon-box icon-box-xl icon-box-primary shadow-sm">
                    <Store className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Your Store</div>
                    <div className="text-lg sm:text-xl font-bold text-foreground leading-tight">{activeStore?.name}</div>
                  </div>
                </div>
                {activeStore && activeStore.status === 'active' && (
                  <>
                    <Button size="sm" className="bg-gradient-to-r from-primary to-primary-glow text-primary-foreground border-0 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all" onClick={() => {
                      const url = `https://buy-data360.com/store/${activeStore.slug}`;
                      navigator.clipboard.writeText(url);
                      toast({ title: 'Link copied' });
                    }}>
                      <Copy className="w-4 h-4 mr-2" />Copy Link
                    </Button>
                    <Button asChild size="sm" className="bg-gradient-to-r from-accent to-amber text-accent-foreground border-0 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
                      <a href={`https://buy-data360.com/store/${activeStore.slug}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4 mr-2" />View Store
                      </a>
                    </Button>
                  </>
                )}
              </div>
            </div>

            {activeStore && (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="flex flex-wrap h-auto gap-1 p-1.5 bg-gradient-to-r from-primary/5 via-purple/5 to-accent/5 border border-border/50 rounded-xl">
                  <TabsTrigger value="dashboard" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-primary-glow data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">Dashboard</TabsTrigger>
                  <TabsTrigger value="orders" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-success data-[state=active]:to-teal data-[state=active]:text-white data-[state=active]:shadow-md transition-all">Orders</TabsTrigger>
                  <TabsTrigger value="products" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber data-[state=active]:to-accent data-[state=active]:text-white data-[state=active]:shadow-md transition-all">Products</TabsTrigger>
                  <TabsTrigger value="financial" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-success data-[state=active]:to-primary data-[state=active]:text-white data-[state=active]:shadow-md transition-all">Financial Overview</TabsTrigger>
                  <TabsTrigger value="transactions" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal data-[state=active]:to-info data-[state=active]:text-white data-[state=active]:shadow-md transition-all">Transactions</TabsTrigger>
                  <TabsTrigger value="analytics" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple data-[state=active]:to-primary data-[state=active]:text-white data-[state=active]:shadow-md transition-all">Performance Analytics</TabsTrigger>
                  <TabsTrigger value="settings" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-foreground/80 data-[state=active]:to-foreground data-[state=active]:text-background data-[state=active]:shadow-md transition-all">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="dashboard"><AnalyticsTab storeId={activeStore.id} mode="overview" /></TabsContent>
                <TabsContent value="orders"><StoreOrdersTab storeId={activeStore.id} /></TabsContent>
                <TabsContent value="products"><StoreProductsTab storeId={activeStore.id} /></TabsContent>
                <TabsContent value="financial"><StoreFinancialTab /></TabsContent>
                <TabsContent value="transactions"><StoreTransactionsTab storeId={activeStore.id} /></TabsContent>
                <TabsContent value="analytics"><StoreAnalyticsHub storeId={activeStore.id} /></TabsContent>
                <TabsContent value="settings"><StoreSettingsTab store={activeStore} onSaved={loadStores} onRestartTour={handleRestartTour} /></TabsContent>
              </Tabs>
            )}
          </>
        )}
      </div>
      {activeStore && activeStore.status !== 'rejected' && activeStore.status !== 'deleted' && (
        <StoreOnboardingTour
          store={activeStore}
          open={tourOpen}
          onOpenChange={setTourOpen}
          onNavigate={(tab) => { setActiveTab(tab); setTourOpen(false); }}
          onCompleted={loadStores}
        />
      )}
    </CustomerLayout>
  );
}

function CreateStoreForm({ name, setName, slug, setSlug, desc, setDesc, onCreate, loading }: any) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Store name</Label>
        <Input value={name} onChange={e => { setName(e.target.value); if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)); }} placeholder="e.g. Kofi Data Hub" />
      </div>
      <div>
        <Label>Store URL slug</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">/store/</span>
          <Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))} placeholder="kofi-data-hub" />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">3-40 chars, lowercase letters, numbers, hyphens.</p>
      </div>
      <div>
        <Label>Description (optional)</Label>
        <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does your store sell?" rows={2} />
      </div>
      <Button onClick={onCreate} disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
        Create Store
      </Button>
    </div>
  );
}

function StoreStatusCard({ store }: { store: StoreRow }) {
  if (store.status === 'pending') {
    return (
      <Card className="p-5 border-amber-500/40 bg-amber-500/10">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Pending review</div>
              <h3 className="text-lg font-bold mt-0.5">Your store is awaiting admin approval</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              "{store.name}" is hidden from buyers while an admin reviews it. We typically respond within 24 hours.
            </p>
            <div className="text-sm text-foreground/90">
              <div className="font-semibold mb-1">What you can do now:</div>
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                <li>Add products and set your selling prices under <span className="font-medium text-foreground">Products</span>.</li>
                <li>Polish your logo, banner and description under <span className="font-medium text-foreground">Settings</span>.</li>
                <li>Add WhatsApp and contact details so buyers can reach you once you're live.</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (store.status === 'rejected') {
    return (
      <Card className="p-5 border-destructive/40 bg-destructive/10">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-destructive">Not approved</div>
              <h3 className="text-lg font-bold mt-0.5">Your store was not approved</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              "{store.name}" was reviewed{store.rejected_at ? ` on ${new Date(store.rejected_at).toLocaleDateString()}` : ''} and could not be approved at this time.
            </p>
            {store.rejection_reason && (
              <div className="rounded-md border border-destructive/30 bg-background/60 p-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-destructive mb-1">Reason from admin</div>
                <p className="text-foreground/90 whitespace-pre-wrap">{store.rejection_reason}</p>
              </div>
            )}
            <div className="text-sm text-foreground/90">
              <div className="font-semibold mb-1">Next steps:</div>
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                <li>Address the reason above (update business details, contact info, or pricing as needed).</li>
                <li>Create a new store below — you can reuse your original handle and name.</li>
                <li>Reach out via Support if you need clarification.</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (store.status === 'suspended') {
    return (
      <Card className="p-5 border-destructive/40 bg-destructive/10">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
            <PauseCircle className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-destructive">Suspended</div>
              <h3 className="text-lg font-bold mt-0.5">Your store is currently suspended</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              "{store.name}" is hidden from buyers and cannot accept new orders. Please contact support for details on how to reactivate it.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}



function AnalyticsTab({ storeId, mode }: { storeId: string; mode: 'overview' | 'traffic' | 'funnel' | 'products' }) {
  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    const { from, to } = periodRange(period, customFrom, customTo);
    const { data, error } = await supabase.rpc('get_store_analytics' as any, {
      p_store_id: storeId, p_from: from.toISOString(), p_to: to.toISOString(),
    });
    if (!error) setData(data);
    if (showSpinner) setLoading(false);
  }, [storeId, period, customFrom, customTo]);

  useEffect(() => { load(true); }, [load]);

  // Realtime: refresh dashboard automatically when store activity changes
  useEffect(() => {
    if (!storeId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => load(false), 400);
    };
    const channel = supabase
      .channel(`store-analytics-${storeId}-${mode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders', filter: `store_id=eq.${storeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_visits', filter: `store_id=eq.${storeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_product_clicks', filter: `store_id=eq.${storeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_checkout_initiations', filter: `store_id=eq.${storeId}` }, refresh)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [storeId, mode, load]);

  const summary = data?.summary || {};
  const series = (data?.series || []).map((d: any) => ({ ...d, day: new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }));
  const trafficTrend = (data?.traffic_trend || []).map((d: any) => ({ ...d, day: new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }));
  const top = data?.top_products || [];
  const mostViewed = data?.most_viewed || [];
  const funnel = data?.funnel || {};
  const sources = data?.sources || [];
  const recent = data?.recent_orders || [];
  const visits = Number(funnel.visits || 0);
  const uniqueVisitors = Number(funnel.unique_visitors || 0);
  const clicks = Number(funnel.product_clicks || 0);
  const checkouts = Number(funnel.checkout_initiations || 0);
  const completed = Number(funnel.completed_orders || 0);
  const conv = visits > 0 ? ((completed / visits) * 100).toFixed(1) : '0';
  const avgSession = Number(summary.avg_session_seconds || 0);
  const returning = Number(summary.returning_visitors || 0);
  const returningPct = visits > 0 ? ((returning / visits) * 100).toFixed(1) : '0';
  const fmtSession = (s: number) => s >= 60 ? `${Math.floor(s/60)}m ${Math.round(s%60)}s` : `${Math.round(s)}s`;

  return (
    <div className="space-y-6 mt-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Period</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map(p => <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {period === 'custom' && (
          <>
            <div><Label className="text-xs">From</Label><Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></div>
          </>
        )}
      </div>

      {loading ? <Card className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card> : (
        <>
          {mode === 'overview' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Chip label="Visitors today" value={String(summary.visitors_today || 0)} tone="teal" />
                <Chip label="Visitors / 7d" value={String(summary.visitors_week || 0)} tone="purple" />
                <Chip label="Visitors / 30d" value={String(summary.visitors_month || 0)} tone="amber" />
                <Chip label="Conversion" value={`${Number(summary.conversion_rate || 0)}%`} tone="success" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Total Revenue" value={formatGHS(Number(summary.total_revenue || 0))} icon={TrendingUp} tone="primary" />
                <MetricCard label="Total Profit" value={formatGHS(Number(summary.total_profit || 0))} icon={TrendingUp} tone="success" />
                <MetricCard label="Orders" value={String(summary.successful_orders || 0)} icon={ShoppingBag} tone="teal" />
                <MetricCard label="Customers" value={String(summary.unique_customers || 0)} icon={Users} tone="purple" />
                <MetricCard label="Avg Order Value" value={formatGHS(Number(summary.avg_order_value || 0))} icon={ShoppingBag} tone="warning" />
                <MetricCard label="Visits" value={String(visits)} icon={Eye} tone="teal" />
                <MetricCard label="Product Clicks" value={String(clicks)} icon={MousePointerClick} tone="purple" />
                <MetricCard label="Avg Session" value={fmtSession(avgSession)} icon={Clock} tone="amber" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="p-4">
                  <h4 className="text-sm font-semibold mb-3">Revenue & Profit Over Time</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="day" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
                      <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
                <Card className="p-4">
                  <h4 className="text-sm font-semibold mb-3">Orders Over Time</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="day" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="orders" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Top Products</h4>
                {top.length === 0 ? <p className="text-sm text-muted-foreground">No sales yet.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Variant</TableHead><TableHead>Orders</TableHead><TableHead>Revenue</TableHead><TableHead>Profit</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {top.map((t: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{t.network}</TableCell><TableCell>{t.size}</TableCell>
                          <TableCell>{t.orders}</TableCell>
                          <TableCell>{formatGHS(Number(t.revenue))}</TableCell>
                          <TableCell className="text-primary font-semibold">{formatGHS(Number(t.profit))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Recent Orders</h4>
                {recent.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Order</TableHead><TableHead>Product</TableHead><TableHead>Buyer</TableHead><TableHead>Paid</TableHead><TableHead>Profit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {recent.map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                          <TableCell className="text-xs">{r.short_id || '—'}</TableCell>
                          <TableCell className="text-xs">{r.network} {r.size}</TableCell>
                          <TableCell className="text-xs">{r.buyer_phone}</TableCell>
                          <TableCell>{formatGHS(Number(r.amount_paid))}</TableCell>
                          <TableCell className="text-primary">{formatGHS(Number(r.profit))}</TableCell>
                          <TableCell><StatusBadge status={r.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </>
          )}

          {mode === 'traffic' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Visitors Today" value={String(summary.visitors_today || 0)} icon={Eye} tone="teal" />
                <MetricCard label="Visitors / 7d" value={String(summary.visitors_week || 0)} icon={Eye} tone="purple" />
                <MetricCard label="Visitors / 30d" value={String(summary.visitors_month || 0)} icon={Eye} tone="amber" />
                <MetricCard label="Unique Visitors (all-time)" value={String(summary.unique_visitors_total || 0)} icon={Users} tone="primary" />
                <MetricCard label="Returning visitors" value={`${returning} (${returningPct}%)`} icon={Users} tone="success" />
                <MetricCard label="Total Clicks" value={String(clicks)} icon={MousePointerClick} tone="purple" />
                <MetricCard label="Avg Session" value={fmtSession(avgSession)} icon={Clock} tone="amber" />
                <MetricCard label="Conversion Rate" value={`${Number(summary.conversion_rate || 0)}%`} icon={TrendingUp} tone="success" />
              </div>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Traffic Trend</h4>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={trafficTrend}>
                    <defs>
                      <linearGradient id="visGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="uniqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--teal))" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="hsl(var(--teal))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} />
                    <RTooltip />
                    <Legend />
                    <Area type="monotone" name="Visits" dataKey="visits" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#visGrad)" strokeWidth={2} />
                    <Area type="monotone" name="Unique Visitors" dataKey="unique_visitors" stroke="hsl(var(--teal))" fillOpacity={1} fill="url(#uniqGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Traffic Sources</h4>
                {sources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No visits in this period yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={sources} dataKey="visits" nameKey="source" cx="50%" cy="50%" outerRadius={80} label>
                          {sources.map((_: any, i: number) => <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />)}
                        </Pie>
                        <Legend />
                        <RTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <Table>
                      <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Visits</TableHead><TableHead>%</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {sources.map((s: any) => (
                          <TableRow key={s.source}>
                            <TableCell className="capitalize">{s.source}</TableCell>
                            <TableCell>{s.visits}</TableCell>
                            <TableCell>{visits ? ((Number(s.visits)/visits)*100).toFixed(1) : 0}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            </>
          )}

          {mode === 'products' && (
            <>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Most Viewed Products</h4>
                {mostViewed.length === 0 ? <p className="text-sm text-muted-foreground">No product views yet.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Variant</TableHead><TableHead>Views</TableHead><TableHead>Orders</TableHead><TableHead>Conversion</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {mostViewed.map((m: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{m.network}</TableCell>
                          <TableCell>{m.size}</TableCell>
                          <TableCell className="font-semibold">{m.clicks}</TableCell>
                          <TableCell>{m.orders}</TableCell>
                          <TableCell className="text-primary">{Number(m.conversion_pct).toFixed(1)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Top Sellers (by revenue)</h4>
                {top.length === 0 ? <p className="text-sm text-muted-foreground">No sales yet.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Variant</TableHead><TableHead>Orders</TableHead><TableHead>Revenue</TableHead><TableHead>Profit</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {top.map((t: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{t.network}</TableCell><TableCell>{t.size}</TableCell>
                          <TableCell>{t.orders}</TableCell>
                          <TableCell>{formatGHS(Number(t.revenue))}</TableCell>
                          <TableCell className="text-primary font-semibold">{formatGHS(Number(t.profit))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </>
          )}

          {mode === 'funnel' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <FunnelStep label="Visits" value={visits} pct={100} icon={Eye} tone="teal" />
                <FunnelStep label="Product Clicks" value={clicks} pct={visits ? (clicks/visits)*100 : 0} icon={MousePointerClick} tone="purple" />
                <FunnelStep label="Checkout Started" value={checkouts} pct={visits ? (checkouts/visits)*100 : 0} icon={ShoppingCart} tone="amber" />
                <FunnelStep label="Purchased" value={completed} pct={visits ? (completed/visits)*100 : 0} icon={CheckCircle2} tone="success" highlight />
              </div>
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Conversion Funnel</h4>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart layout="vertical" data={[
                    { stage: 'Visits', count: visits },
                    { stage: 'Clicks', count: clicks },
                    { stage: 'Checkout', count: checkouts },
                    { stage: 'Purchased', count: completed },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" fontSize={11} />
                    <YAxis dataKey="stage" type="category" fontSize={12} width={90} />
                    <RTooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card className="p-4 space-y-3">
                <h4 className="text-sm font-semibold">Funnel rates</h4>
                <RateRow label="Visit → Click" pct={visits ? (clicks/visits)*100 : 0} />
                <RateRow label="Click → Checkout" pct={clicks ? (checkouts/clicks)*100 : 0} />
                <RateRow label="Checkout → Purchase" pct={checkouts ? (completed/checkouts)*100 : 0} />
                <RateRow label="Overall Conversion" pct={Number(conv)} highlight />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function FunnelStep({ label, value, pct, icon: Icon, highlight, tone }: any) {
  const map: Record<string, { wrap: string; box: string; val: string; bar: string }> = {
    teal:    { wrap: 'border-teal/30 bg-gradient-to-br from-teal/10 to-teal/[0.02]',          box: 'icon-box icon-box-md icon-box-teal',      val: 'text-teal',    bar: 'bg-teal' },
    purple:  { wrap: 'border-purple/30 bg-gradient-to-br from-purple/10 to-purple/[0.02]',    box: 'icon-box icon-box-md icon-box-purple',    val: 'text-purple',  bar: 'bg-purple' },
    amber:   { wrap: 'border-amber/30 bg-gradient-to-br from-amber/10 to-amber/[0.02]',       box: 'icon-box icon-box-md icon-box-amber',     val: 'text-amber',   bar: 'bg-amber' },
    success: { wrap: 'border-success/40 bg-gradient-to-br from-success/15 to-success/[0.03]', box: 'icon-box icon-box-md icon-box-success',   val: 'text-success', bar: 'bg-success' },
  };
  const t = map[tone] || map.teal;
  const v = Math.max(0, Math.min(100, pct));
  return (
    <Card className={`p-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${t.wrap} ${highlight ? 'ring-1 ring-success/40' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={t.box}><Icon className="w-4 h-4" /></div>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${t.val}`}>{value}</p>
      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${t.bar} transition-all`} style={{ width: `${v}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">{v.toFixed(1)}% of visits</p>
    </Card>
  );
}

function RateRow({ label, pct, highlight }: any) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className={highlight ? 'text-primary font-bold' : 'font-semibold'}>{v.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${highlight ? 'bg-primary' : 'bg-primary/50'}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, highlight, tone }: any) {
  const tones: Record<string, { wrap: string; iconBox: string; value: string }> = {
    primary:     { wrap: 'border-primary/30 bg-gradient-to-br from-primary/10 to-primary/[0.02]', iconBox: 'icon-box icon-box-md icon-box-primary', value: 'text-primary' },
    success:     { wrap: 'border-success/30 bg-gradient-to-br from-success/10 to-success/[0.02]', iconBox: 'icon-box icon-box-md icon-box-success', value: 'text-success' },
    teal:        { wrap: 'border-teal/30 bg-gradient-to-br from-teal/10 to-teal/[0.02]', iconBox: 'icon-box icon-box-md icon-box-teal', value: 'text-teal' },
    purple:      { wrap: 'border-purple/30 bg-gradient-to-br from-purple/10 to-purple/[0.02]', iconBox: 'icon-box icon-box-md icon-box-purple', value: 'text-purple' },
    amber:       { wrap: 'border-amber/30 bg-gradient-to-br from-amber/10 to-amber/[0.02]', iconBox: 'icon-box icon-box-md icon-box-amber', value: 'text-amber' },
    warning:     { wrap: 'border-warning/30 bg-gradient-to-br from-warning/10 to-warning/[0.02]', iconBox: 'icon-box icon-box-md icon-box-warning', value: 'text-warning' },
    destructive: { wrap: 'border-destructive/30 bg-gradient-to-br from-destructive/10 to-destructive/[0.02]', iconBox: 'icon-box icon-box-md icon-box-destructive', value: 'text-destructive' },
  };
  const t = tones[tone] || (highlight ? tones.primary : null);
  return (
    <Card className={`p-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${t ? t.wrap : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={t ? t.iconBox : 'icon-box icon-box-md icon-box-muted'}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      <p className={`text-xl font-bold ${t ? t.value : 'text-foreground'}`}>{value}</p>
    </Card>
  );
}

type DraftRow = { key: string; kind: 'data' | 'checker'; productId: string; label1: string; label2: string; basePrice: number; price: string; active: boolean; origPrice: number; origActive: boolean; existed: boolean; };

const NETWORK_TABS: { value: string; label: string }[] = [
  { value: 'MTN', label: 'MTN' },
  { value: 'AirtelTigo', label: 'AirtelTigo' },
  { value: 'Telecel', label: 'Telecel' },
];

function StoreProductsTab({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<PriceItem[]>([]);
  const [checkers, setCheckers] = useState<CheckerProduct[]>([]);
  const [mine, setMine] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'data' | 'checker'>('data');
  const [network, setNetwork] = useState<string>('MTN');
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [pi, cp, sp] = await Promise.all([
      supabase.from('public_price_items' as any).select('*').eq('product', 'Data').order('network').order('price'),
      supabase.from('checker_products' as any).select('id, name, exam_type, price, status').eq('status', 'active').order('name'),
      supabase.from('store_products' as any).select('*').eq('store_id', storeId),
    ]);
    const piRows: PriceItem[] = (pi.data as any) || [];
    const cpRows: CheckerProduct[] = (cp.data as any) || [];
    const spRows: StoreProduct[] = (sp.data as any) || [];
    setItems(piRows);
    setCheckers(cpRows);
    setMine(spRows);
    const dataMap = Object.fromEntries(spRows.filter(m => m.kind === 'data').map(m => [m.price_item_id!, m]));
    const checkerMap = Object.fromEntries(spRows.filter(m => m.kind === 'checker').map(m => [m.checker_product_id!, m]));
    const next: Record<string, DraftRow> = {};
    piRows.forEach(p => {
      const sp = dataMap[p.id];
      next[`data:${p.id}`] = {
        key: `data:${p.id}`, kind: 'data', productId: p.id, label1: p.network, label2: p.size, basePrice: Number(p.price),
        price: sp ? String(sp.selling_price) : String(p.price),
        active: sp ? sp.active : true,
        origPrice: sp ? Number(sp.selling_price) : Number(p.price),
        origActive: sp ? sp.active : true,
        existed: !!sp,
      };
    });
    cpRows.forEach(c => {
      const sp = checkerMap[c.id];
      next[`checker:${c.id}`] = {
        key: `checker:${c.id}`, kind: 'checker', productId: c.id, label1: c.name, label2: c.exam_type, basePrice: Number(c.price),
        price: sp ? String(sp.selling_price) : String(c.price),
        active: sp ? sp.active : true,
        origPrice: sp ? Number(sp.selling_price) : Number(c.price),
        origActive: sp ? sp.active : true,
        existed: !!sp,
      };
    });
    setDrafts(next);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: refresh when products change for this store
  useEffect(() => {
    if (!storeId) return;
    const channel = supabase
      .channel(`store-products-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_products', filter: `store_id=eq.${storeId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId, load]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setDrafts(d => ({ ...d, [key]: { ...d[key], ...patch } }));
  };

  const dirtyKeys = useMemo(() => {
    return Object.values(drafts).filter(r => {
      const priceChanged = (parseFloat(r.price) || 0) !== r.origPrice;
      const activeChanged = r.active !== r.origActive;
      // also save newly-touched rows that don't exist yet but differ from base, OR active state different
      if (!r.existed) {
        return priceChanged || !r.active; // creating only when changed from defaults
      }
      return priceChanged || activeChanged;
    }).map(r => r.key);
  }, [drafts]);


  const saveAll = async () => {
    if (dirtyKeys.length === 0) { toast({ title: 'No changes to save' }); return; }
    setSaving(true);
    const results = await Promise.all(dirtyKeys.map(k => {
      const r = drafts[k];
      const p = parseFloat(r.price) || 0;
      return supabase.rpc('upsert_store_product' as any, {
        p_store_id: storeId, p_kind: r.kind, p_product_id: r.productId, p_selling_price: p, p_active: r.active,
      }).then(({ error }) => ({ key: k, error }));
    }));
    setSaving(false);
    const failed = results.filter(r => r.error);
    if (failed.length) {
      toast({ title: `${failed.length} failed`, description: failed[0].error?.message, variant: 'destructive' });
    } else {
      toast({ title: `Saved ${results.length} change${results.length > 1 ? 's' : ''}` });
    }
    load();
  };

  const resetAll = () => {
    setDrafts(d => {
      const next = { ...d };
      Object.values(next).forEach(r => {
        next[r.key] = { ...r, price: String(r.origPrice), active: r.origActive };
      });
      return next;
    });
  };

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  const networkRows = Object.values(drafts).filter(r => r.kind === 'data' && r.label1 === network);
  const checkerRows = Object.values(drafts).filter(r => r.kind === 'checker');

  return (
    <Card className="p-4 mt-4">
      <h4 className="text-sm font-semibold mb-1">Choose products and set your selling price</h4>
      <p className="text-xs text-muted-foreground mb-4">Your selling price must be at least the platform base price. Your profit per sale is the difference. Edit anything and click <span className="font-semibold">Save changes</span> at the bottom.</p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mb-3">
        <TabsList>
          <TabsTrigger value="data">Data Bundles</TabsTrigger>
          <TabsTrigger value="checker">Results Checkers</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'data' && (
        <>
          <Tabs value={network} onValueChange={setNetwork} className="mb-3">
            <TabsList>
              {NETWORK_TABS.map(n => <TabsTrigger key={n.value} value={n.value}>{n.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>


          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Size</TableHead><TableHead>Base Price</TableHead><TableHead>Your Price (GHS)</TableHead><TableHead>Profit</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
              <TableBody>
                {networkRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">No bundles available for {network}.</TableCell></TableRow>}
                {networkRows.map(r => <DraftRowView key={r.key} row={r} onChange={(p) => updateRow(r.key, p)} />)}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {tab === 'checker' && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Exam</TableHead><TableHead>Base Price</TableHead><TableHead>Your Price (GHS)</TableHead><TableHead>Profit</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
            <TableBody>
              {checkerRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">No active checker products available.</TableCell></TableRow>}
              {checkerRows.map(r => <DraftRowView key={r.key} row={r} showLabels onChange={(p) => updateRow(r.key, p)} />)}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="sticky bottom-0 mt-4 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-t flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {dirtyKeys.length > 0 ? <span className="text-foreground font-semibold">{dirtyKeys.length} unsaved change{dirtyKeys.length > 1 ? 's' : ''}</span> : 'All changes saved'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={resetAll} disabled={saving || dirtyKeys.length === 0}>Discard</Button>
          <Button onClick={saveAll} disabled={saving || dirtyKeys.length === 0}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Save changes{dirtyKeys.length > 0 ? ` (${dirtyKeys.length})` : ''}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DraftRowView({ row, onChange, showLabels }: { row: DraftRow; onChange: (patch: Partial<DraftRow>) => void; showLabels?: boolean }) {
  const priceNum = parseFloat(row.price) || 0;
  const profit = priceNum - row.basePrice;
  const dirty = priceNum !== row.origPrice || row.active !== row.origActive;
  const belowBase = priceNum < row.basePrice;
  return (
    <TableRow className={dirty ? 'bg-primary/5' : ''}>
      {showLabels && <TableCell>{row.label1}</TableCell>}
      <TableCell>{showLabels ? row.label2 : row.label2}</TableCell>
      <TableCell>{formatGHS(row.basePrice)}</TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.01"
          value={row.price}
          onChange={e => onChange({ price: e.target.value })}
          className={`w-28 ${belowBase ? 'border-destructive' : ''}`}
        />
      </TableCell>
      <TableCell className={profit < 0 ? 'text-destructive' : profit > 0 ? 'text-primary font-semibold' : 'text-muted-foreground'}>
        {formatGHS(profit)}
      </TableCell>
      <TableCell><Switch checked={row.active} onCheckedChange={(v) => onChange({ active: v })} /></TableCell>
    </TableRow>
  );
}

function StoreOrdersTab({ storeId }: { storeId: string }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('store_orders' as any)
      .select('*, price_items(network, size), checker_products(name, exam_type), orders(short_id, status)')
      .eq('store_id', storeId).order('created_at', { ascending: false }).limit(200);
    setOrders((data as any) || []);
    setLoading(false);
  }, [storeId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!storeId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(), 300); };
    const channel = supabase
      .channel(`store-orders-tab-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders', filter: `store_id=eq.${storeId}` }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [storeId, load]);

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  const handleExport = () => {
    const rows = orders.map((o: any) => ({
      date: new Date(o.created_at).toISOString(),
      order_id: o.orders?.short_id || '',
      product: o.kind === 'checker' ? (o.checker_products?.name || 'Checker') : `${o.price_items?.network || ''} ${o.price_items?.size || ''}`.trim(),
      buyer_phone: o.buyer_phone || '',
      amount_paid: Number(o.amount_paid || 0).toFixed(2),
      profit: Number(o.profit || 0).toFixed(2),
      status: o.status,
    }));
    exportRowsToCSV(`store-orders-${csvTimestamp()}.csv`, rows, [
      { key: 'date', label: 'Date' },
      { key: 'order_id', label: 'Order ID' },
      { key: 'product', label: 'Product' },
      { key: 'buyer_phone', label: 'Buyer Phone' },
      { key: 'amount_paid', label: 'Amount Paid (GHS)' },
      { key: 'profit', label: 'Profit (GHS)' },
      { key: 'status', label: 'Status' },
    ]);
  };

  return (
    <Card className="p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold">Orders</h4>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={!orders.length}>
          <Download className="w-4 h-4 mr-2" />Export CSV
        </Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead>Buyer</TableHead><TableHead>Paid</TableHead><TableHead>Profit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {orders.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No orders yet.</TableCell></TableRow>}
          {orders.map((o: any) => (
            <TableRow key={o.id}>
              <TableCell className="text-xs">{new Date(o.created_at).toLocaleString()}</TableCell>
              <TableCell className="text-xs">{o.kind === 'checker' ? (o.checker_products?.name || 'Checker') : `${o.price_items?.network || ''} ${o.price_items?.size || ''}`}</TableCell>
              <TableCell className="text-xs">{o.buyer_phone}</TableCell>
              <TableCell>{formatGHS(Number(o.amount_paid))}</TableCell>
              <TableCell className="text-primary">{formatGHS(Number(o.profit))}</TableCell>
              <TableCell><StatusBadge status={o.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function RequestStorePayoutCard({ available, hasPending, onDone }: { available: number; hasPending: boolean; onDone: () => void }) {
  const { toast } = useToast();
  // Minimum comes from the same platform setting the backend enforces
  // (payout_min_store). Fallback of 20 only covers the moment before the
  // setting loads or a failed read — the backend check always wins.
  const [minPayout, setMinPayout] = useState<number | null>(null);
  const MIN = minPayout ?? 20;
  const [amount, setAmount] = useState('');
  const [momo, setMomo] = useState('');
  const [name, setName] = useState('');
  const [network, setNetwork] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ amount: number; short_id: string; created_at: string } | null>(null);
  const idemRef = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('key, value')
      .eq('key', 'payout_min_store')
      .maybeSingle()
      .then(({ data }) => {
        const v = Number((data as any)?.value);
        if (Number.isFinite(v) && v > 0) setMinPayout(v);
      });
  }, []);

  const submit = async () => {
    if (inFlight.current) return;
    setError(null);
    const amt = Number(amount);
    const num = momo.replace(/\D/g, '');
    if (!amt || amt <= 0) return setError('Enter a valid amount.');
    if (amt < MIN) return setError(`Minimum payout is GHS ${MIN}.`);
    if (amt > available) return setError('Insufficient available balance.');
    if (!/^0[235]\d{8}$/.test(num)) return setError('Enter a valid 10-digit Mobile Money number starting with 0.');
    if (name.trim().length < 2) return setError('Enter the name on the Mobile Money account.');
    if (!network) return setError('Choose a Mobile Money network.');
    inFlight.current = true;
    setSubmitting(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('request_store_payout' as any, {
        p_amount: amt, p_momo_number: num, p_momo_name: name.trim(), p_network: network, p_idempotency_key: idemRef.current,
      });
      const d = data as any;
      if (rpcErr || !d?.success) {
        setError(d?.error || 'Could not submit your request. Please try again.');
        return;
      }
      setResult({ amount: Number(d.amount ?? amt), short_id: d.short_id || '', created_at: d.created_at || new Date().toISOString() });
      toast({ title: 'Withdrawal request submitted successfully.' });
      idemRef.current = crypto.randomUUID();
      setAmount('');
      onDone();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-semibold text-sm">Request Payout</p>
        <p className="text-xs text-muted-foreground">Sent to your Mobile Money after admin approval. Minimum GHS {MIN}.</p>
      </div>
      {result && (
        <div className="rounded-xl bg-success/10 border border-success/20 p-3 text-xs space-y-0.5">
          <p className="font-semibold text-success">Withdrawal request submitted successfully.</p>
          <p>Amount: {formatGHS(result.amount)}{result.short_id && <> · Ref: <span className="font-mono">{result.short_id}</span></>}</p>
          <p>Status: Pending admin approval · {new Date(result.created_at).toLocaleString()}</p>
        </div>
      )}
      {hasPending ? (
        <p className="text-xs text-muted-foreground">You have a payout request in progress. You can request another once it finishes.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Amount (GHS)</Label>
            <Input type="number" inputMode="decimal" min={MIN} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Available ${formatGHS(available)}`} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Network</Label>
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger><SelectValue placeholder="Choose network" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MTN">MTN MoMo</SelectItem>
                <SelectItem value="VOD">Telecel Cash</SelectItem>
                <SelectItem value="ATL">AirtelTigo Money</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mobile Money number</Label>
            <Input inputMode="numeric" maxLength={10} value={momo} onChange={e => setMomo(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="0241234567" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Account name</Label>
            <Input value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="Name on MoMo account" />
          </div>
          {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
          <Button className="sm:col-span-2" disabled={submitting || available < MIN} onClick={submit}>
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> : 'Request Payout'}
          </Button>
          {available < MIN && <p className="text-xs text-muted-foreground sm:col-span-2">You need at least GHS {MIN} available to request a payout.</p>}
        </div>
      )}
    </Card>
  );
}

function StoreFinancialTab() {
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const load = useCallback(async () => {
    const [w, payouts, legacy] = await Promise.all([
      supabase.from('store_wallets' as any).select('*').maybeSingle(),
      supabase.from('payouts')
        .select('id, short_id, amount, status, created_at, completed_at, momo_number, momo_name, paystack_transfer_reference, admin_note, failure_reason, network')
        .eq('payout_type', 'store')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('store_withdrawals' as any).select('*').order('created_at', { ascending: false }).limit(200),
    ]);

    setWallet((w.data as any) || { available_balance: 0, pending_balance: 0, withdrawn_balance: 0, locked_balance: 0 });

    const payoutRows: Withdrawal[] = (((payouts.data as any[]) || []) as any[]).map(p => ({
      id: p.id,
      source: 'payout',
      short_id: p.short_id,
      amount: Number(p.amount),
      status: p.status,
      created_at: p.created_at,
      completed_at: p.completed_at,
      momo_number: p.momo_number || '',
      momo_name: p.momo_name || '',
      paystack_reference: p.paystack_transfer_reference || '',
      admin_notes: p.admin_note || '',
      failure_reason: p.failure_reason,
      network: p.network,
    }));
    const legacyRows: Withdrawal[] = (((legacy.data as any[]) || []) as any[]).map((l: any) => ({
      id: l.id,
      source: 'legacy',
      amount: Number(l.amount),
      status: l.status,
      created_at: l.created_at,
      momo_number: l.momo_number || '',
      momo_name: l.momo_name || '',
      paystack_reference: l.paystack_reference || '',
      admin_notes: l.admin_notes || '',
    }));
    setWithdrawals([...payoutRows, ...legacyRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime: refresh wallet + withdrawals when admin completes/rejects payouts
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(), 300); };
    const channel = supabase
      .channel(`store-earnings`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_wallets' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_withdrawals' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payouts' }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [load]);

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Available" value={formatGHS(Number(wallet?.available_balance || 0))} icon={Wallet} tone="success" />
        <MetricCard label="Locked" value={formatGHS(Number(wallet?.locked_balance || 0))} icon={Wallet} tone="info" />
        <MetricCard label="Pending Settlement" value={formatGHS(Number(wallet?.pending_balance || 0))} icon={Wallet} tone="amber" />
        <MetricCard label="Withdrawn" value={formatGHS(Number(wallet?.withdrawn_balance || 0))} icon={ArrowDownToLine} tone="purple" />
      </div>
      <RequestStorePayoutCard
        available={Number(wallet?.available_balance || 0)}
        hasPending={withdrawals.some(w => w.source === 'payout' && ['pending_approval', 'approved', 'processing'].includes(w.status))}
        onDone={load}
      />
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold">Payout History</h4>
          <Button size="sm" variant="outline" disabled={!withdrawals.length} onClick={() => {
            exportRowsToCSV(`store-payouts-${csvTimestamp()}.csv`, withdrawals.map(w => ({
              date: new Date(w.created_at).toISOString(),
              amount: Number(w.amount).toFixed(2),
              momo_number: w.momo_number,
              momo_name: w.momo_name,
              network: w.network || '',
              status: w.status,
              reference: w.paystack_reference || '',
              source: w.source,
              notes: w.admin_notes || '',
              failure_reason: w.failure_reason || '',
            })), [
              { key: 'date', label: 'Date' },
              { key: 'amount', label: 'Amount (GHS)' },
              { key: 'momo_number', label: 'MoMo Number' },
              { key: 'momo_name', label: 'MoMo Name' },
              { key: 'network', label: 'Network' },
              { key: 'status', label: 'Status' },
              { key: 'reference', label: 'Paystack Ref' },
              { key: 'source', label: 'Source' },
              { key: 'notes', label: 'Notes' },
              { key: 'failure_reason', label: 'Failure Reason' },
            ]);
          }}>
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>MoMo</TableHead><TableHead>Status</TableHead><TableHead>Paystack Ref</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
          <TableBody>
            {withdrawals.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No payouts yet.</TableCell></TableRow>}
            {withdrawals.map(w => (
              <TableRow key={`${w.source}-${w.id}`}>
                <TableCell className="text-xs">{new Date(w.created_at).toLocaleString()}</TableCell>
                <TableCell>{formatGHS(Number(w.amount))}</TableCell>
                <TableCell className="text-xs">{w.momo_number} {w.network && <span className="text-muted-foreground">({w.network})</span>}<br /><span className="text-muted-foreground">{w.momo_name}</span></TableCell>
                <TableCell><StatusBadge status={w.status} /></TableCell>
                <TableCell className="text-xs font-mono">{w.paystack_reference || '—'}</TableCell>
                <TableCell className="text-xs">{w.failure_reason || w.admin_notes || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function StoreSettingsTab({ store, onSaved, onRestartTour }: { store: StoreRow; onSaved: () => void; onRestartTour?: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [name, setName] = useState(store.name);
  const [desc, setDesc] = useState(store.description || '');
  const [logo, setLogo] = useState(store.logo_url || '');
  const [banner, setBanner] = useState(store.banner_url || '');
  const [whatsapp, setWhatsapp] = useState(store.contact_whatsapp || '');
  const [groupLink, setGroupLink] = useState(store.contact_group_link || '');
  const [email, setEmail] = useState(store.contact_email || '');
  const [afaEnabled, setAfaEnabled] = useState<boolean>(!!store.afa_enabled);
  const [afaPrice, setAfaPrice] = useState<string>(String(store.afa_price ?? ''));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [bannerProgress, setBannerProgress] = useState(0);
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(store.name); setDesc(store.description || '');
    setLogo(store.logo_url || ''); setBanner(store.banner_url || '');
    setWhatsapp(store.contact_whatsapp || '');
    setGroupLink(store.contact_group_link || '');
    setEmail(store.contact_email || '');
    setAfaEnabled(!!store.afa_enabled);
    setAfaPrice(String(store.afa_price ?? ''));
  }, [store.id]);

  // Size + MIME limits (kept in sync with the helper text shown to users).
  const MAX_LOGO_BYTES = 2 * 1024 * 1024;       // 2 MB
  const MAX_BANNER_BYTES = 5 * 1024 * 1024;     // 5 MB
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  const ALLOWED_LABEL = 'JPG, PNG, WebP, GIF or SVG';

  const formatBytes = (n: number) =>
    n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

  const upload = async (file: File, bucket: 'store-logos' | 'store-banners', kind: 'logo'|'banner') => {
    if (!user?.id) return;
    const maxBytes = kind === 'logo' ? MAX_LOGO_BYTES : MAX_BANNER_BYTES;
    const kindLabel = kind === 'logo' ? 'Logo' : 'Banner';

    // 1) Type validation
    if (!file.type.startsWith('image/') || !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast({
        title: 'Unsupported file type',
        description: `${kindLabel} must be ${ALLOWED_LABEL}. You uploaded ${file.type || 'an unknown file type'}.`,
        variant: 'destructive',
      });
      return;
    }
    // 2) Size validation
    if (file.size > maxBytes) {
      toast({
        title: 'File too large',
        description: `${kindLabel} must be ${formatBytes(maxBytes)} or smaller. Your file is ${formatBytes(file.size)}.`,
        variant: 'destructive',
      });
      return;
    }

    const setBusy = kind === 'logo' ? setUploadingLogo : setUploadingBanner;
    const setProgress = kind === 'logo' ? setLogoProgress : setBannerProgress;
    setBusy(true);
    setProgress(5);

    // Simulated progress — Supabase storage-js doesn't expose XHR progress yet,
    // so we ramp toward 90% while the request is in flight, then snap to 100%.
    const ramp = setInterval(() => {
      setProgress(p => (p < 90 ? p + Math.max(1, Math.round((90 - p) / 8)) : p));
    }, 180);

    try {
      // Storage RLS keys uploads by the auth user id (auth.uid()), not the customer id.
      const { data: authData } = await supabase.auth.getUser();
      const authUid = authData.user?.id || user.auth_user_id;
      if (!authUid) {
        throw new Error('Not signed in. Please refresh and try again.');
      }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${authUid}/${store.id}-${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      const url = signed?.signedUrl || '';
      if (kind === 'logo') setLogo(url); else setBanner(url);
      setProgress(100);
      toast({ title: `${kindLabel} uploaded`, description: 'Click Save Changes to apply it to your store.' });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err?.message || 'Please try again.', variant: 'destructive' });
      setProgress(0);
    } finally {
      clearInterval(ramp);
      setBusy(false);
      // Let the bar linger at 100% briefly before resetting.
      setTimeout(() => setProgress(p => (p === 100 ? 0 : p)), 1200);
    }
  };

  const save = async () => {
    if (email && !email.includes('@')) {
      toast({ title: 'Invalid email', description: 'Please enter a valid email address.', variant: 'destructive' });
      return;
    }
    const afaPriceNum = afaEnabled ? parseFloat(afaPrice || '0') : 0;
    if (afaEnabled && (!afaPriceNum || afaPriceNum <= 0)) {
      toast({ title: 'AFA price required', description: 'Set a price greater than 0 to enable AFA.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('stores' as any).update({
      name, description: desc, logo_url: logo, banner_url: banner,
      contact_whatsapp: whatsapp.trim(),
      contact_group_link: groupLink.trim(),
      contact_email: email.trim(),
      afa_enabled: afaEnabled,
      afa_price: afaPriceNum,
    }).eq('id', store.id);
    setSaving(false);
    if (error) toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    else { setSavedAt(Date.now()); toast({ title: 'Saved' }); onSaved(); }
  };

  // Auto-clear the "Saved" indicator after a few seconds.
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);

  return (
    <>
    <Card className="p-4 space-y-4 mt-4 max-w-2xl">
      <div><Label>Store Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
      <div><Label>Slug</Label><Input value={store.slug} disabled /><p className="text-[11px] text-muted-foreground mt-1">Slug cannot be changed.</p></div>
      <div><Label>Description</Label><Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="A short tagline shown beneath your store name." /></div>

      <div className="space-y-2">
        <Label>Store Logo</Label>
        <div className="flex items-center gap-3">
          {logo ? <img src={logo} alt="logo" className="w-16 h-16 rounded-xl object-cover border" /> : <div className="w-16 h-16 rounded-xl bg-muted" />}
          <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, 'store-logos', 'logo'); e.target.value = ''; }} />
          <Button variant="outline" size="sm" onClick={() => logoInput.current?.click()} disabled={uploadingLogo}>
            {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
            {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
          </Button>
          {logo && !uploadingLogo && <Button variant="ghost" size="sm" onClick={() => setLogo('')}>Remove</Button>}
        </div>
        {(uploadingLogo || logoProgress > 0) && (
          <div className="space-y-1">
            <Progress value={logoProgress} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              {logoProgress >= 100 && !uploadingLogo ? (
                <><CheckCircle2 className="w-3 h-3 text-success" /> Upload complete — click Save Changes to apply.</>
              ) : (
                <>Uploading logo… {logoProgress}%</>
              )}
            </p>
          </div>
        )}
        <Input value={logo} onChange={e => setLogo(e.target.value)} placeholder="Or paste an image URL" />
        <p className="text-[11px] text-muted-foreground">{ALLOWED_LABEL}. Max {formatBytes(MAX_LOGO_BYTES)}. Square ratio recommended.</p>
      </div>

      <div className="space-y-2">
        <Label>Store Banner</Label>
        <div className="space-y-2">
          {banner && <img src={banner} alt="banner" className="w-full h-32 rounded-xl object-cover border" />}
          <div className="flex items-center gap-3">
            <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, 'store-banners', 'banner'); e.target.value = ''; }} />
            <Button variant="outline" size="sm" onClick={() => bannerInput.current?.click()} disabled={uploadingBanner}>
              {uploadingBanner ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              {uploadingBanner ? 'Uploading…' : 'Upload Banner'}
            </Button>
            {banner && !uploadingBanner && <Button variant="ghost" size="sm" onClick={() => setBanner('')}>Remove</Button>}
          </div>
          {(uploadingBanner || bannerProgress > 0) && (
            <div className="space-y-1">
              <Progress value={bannerProgress} className="h-1.5" />
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                {bannerProgress >= 100 && !uploadingBanner ? (
                  <><CheckCircle2 className="w-3 h-3 text-success" /> Upload complete — click Save Changes to apply.</>
                ) : (
                  <>Uploading banner… {bannerProgress}%</>
                )}
              </p>
            </div>
          )}
          <Input value={banner} onChange={e => setBanner(e.target.value)} placeholder="Or paste an image URL" />
        </div>
        <p className="text-[11px] text-muted-foreground">{ALLOWED_LABEL}. Max {formatBytes(MAX_BANNER_BYTES)}. Recommended banner ratio: 4:1.</p>
      </div>

      <div className="border-t pt-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Contact Info</h3>
          <p className="text-[11px] text-muted-foreground">Shown on your public store so buyers can reach you.</p>
        </div>
        <div>
          <Label>WhatsApp Number</Label>
          <Input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="e.g. +233543761951 or 0543761951" />
          <p className="text-[11px] text-muted-foreground mt-1">A "Chat on WhatsApp" link will appear on your store.</p>
        </div>
        <div>
          <Label>WhatsApp Group / Channel Link (optional)</Label>
          <Input value={groupLink} onChange={e => setGroupLink(e.target.value)} placeholder="https://chat.whatsapp.com/... or https://whatsapp.com/channel/..." />
        </div>
        <div>
          <Label>Contact Email (optional)</Label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
      </div>

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">MTN AFA Registration</h3>
            <p className="text-[11px] text-muted-foreground">Offer AFA Registration on your store at your own price.</p>
          </div>
          <Switch checked={afaEnabled} onCheckedChange={setAfaEnabled} />
        </div>
        {afaEnabled && (
          <div>
            <Label>AFA Selling Price (GHS)</Label>
            <Input type="number" inputMode="decimal" step="0.01" min="0" value={afaPrice} onChange={e => setAfaPrice(e.target.value)} placeholder="e.g. 18.00" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={save} disabled={saving || uploadingLogo || uploadingBanner}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
        {(uploadingLogo || uploadingBanner) && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Waiting for upload to finish…
          </span>
        )}
        {savedAt && !saving && !uploadingLogo && !uploadingBanner && (
          <span className="text-xs text-success flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> All changes saved
          </span>
        )}
      </div>
    </Card>
    <Card className="p-4 mt-4 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Help & Tutorial</h3>
            <p className="text-[12px] text-muted-foreground">Restart the in-app walkthrough that explains products, orders, earnings and sharing your store.</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => onRestartTour?.()} disabled={!onRestartTour}>
          Restart tour
        </Button>
      </div>
    </Card>
    <NotificationPreferencesPanel ownerUserId={user?.id || ''} />
    </>
  );
}

// ── Notification Preferences ────────────────────────────────────────────
function NotificationPreferencesPanel({ ownerUserId }: { ownerUserId: string }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    new_order_in_app: true,
    profit_unlocked_in_app: true,
    profit_digest_sms: true,
    marketing: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const customerIdRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!ownerUserId) return;
      const { data } = await supabase
        .from('customers')
        .select('id, notification_preferences')
        .eq('auth_user_id', ownerUserId)
        .maybeSingle();
      if (data) {
        customerIdRef.current = (data as any).id;
        setPrefs(p => ({ ...p, ...(((data as any).notification_preferences as any) || {}) }));
      }
      setLoading(false);
    })();
  }, [ownerUserId]);

  const save = async (next: Record<string, boolean>) => {
    setPrefs(next);
    if (!customerIdRef.current) return;
    setSaving(true);
    const { error } = await supabase
      .from('customers')
      .update({ notification_preferences: next as any })
      .eq('id', customerIdRef.current);
    setSaving(false);
    if (error) toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
  };

  const Row = ({ k, label, desc, locked }: { k: string; label: string; desc: string; locked?: boolean }) => (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch
        checked={locked ? true : !!prefs[k]}
        disabled={locked || saving}
        onCheckedChange={(v) => !locked && save({ ...prefs, [k]: v })}
      />
    </div>
  );

  if (loading) return null;

  return (
    <Card className="p-4 space-y-2 mt-4 max-w-2xl">
      <div className="mb-2">
        <h4 className="text-sm font-semibold">Notification Preferences</h4>
        <p className="text-xs text-muted-foreground">Critical security and financial events always notify you — they can't be turned off.</p>
      </div>
      <Row k="new_order_in_app" label="New order (in-app)" desc="Bell notification each time you receive a paid order." />
      <Row k="profit_unlocked_in_app" label="Profit unlocked (in-app)" desc="Bell notification when an order is delivered and profit becomes available." />
      <Row k="profit_digest_sms" label="Daily profit summary (SMS)" desc="One SMS per day summarising profit unlocked. Replaces per-order SMS." />
      <Row k="marketing" label="Marketing & tips" desc="Occasional product updates, growth tips and announcements." />
      <div className="pt-3 border-t mt-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Always on</p>
        <Row k="_lock_security" label="Security alerts" desc="Login alerts, account changes." locked />
        <Row k="_lock_store" label="Store approval / rejection / suspension" desc="Critical store status changes." locked />
        <Row k="_lock_withdrawals" label="Withdrawals & payouts" desc="Requests, payouts paid, payout failures." locked />
        <Row k="_lock_first_sale" label="First sale celebration" desc="One-time SMS when your store gets its first paid order." locked />
      </div>
    </Card>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone: 'teal'|'purple'|'amber'|'success'|'primary' }) {
  const map: Record<string, string> = {
    teal: 'border-teal/30 bg-teal/10 text-teal',
    purple: 'border-purple/30 bg-purple/10 text-purple',
    amber: 'border-amber/30 bg-amber/10 text-amber',
    success: 'border-success/30 bg-success/10 text-success',
    primary: 'border-primary/30 bg-primary/10 text-primary',
  };
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${map[tone]}`}>
      <span className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  );
}

function StoreAnalyticsHub({ storeId }: { storeId: string }) {
  const [sub, setSub] = useState<'traffic' | 'funnel' | 'products'>('traffic');
  return (
    <div className="mt-4 space-y-4">
      <Tabs value={sub} onValueChange={(v) => setSub(v as any)}>
        <TabsList>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
        </TabsList>
      </Tabs>
      <AnalyticsTab storeId={storeId} mode={sub} />
    </div>
  );
}

function StoreTransactionsTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [orders, withdrawals] = await Promise.all([
      supabase.from('store_orders' as any).select('id, created_at, amount_paid, profit, status, kind, buyer_phone, price_items(network, size), checker_products(name, exam_type), orders(short_id)').eq('store_id', storeId).order('created_at', { ascending: false }).limit(500),
      supabase.from('store_withdrawals' as any).select('id, created_at, amount, status, momo_number, momo_name, paystack_reference, admin_notes').order('created_at', { ascending: false }).limit(200),
    ]);
    const orderRows = ((orders.data as any[]) || []).map((o: any) => ({
      kind: 'sale' as const,
      id: o.id,
      created_at: o.created_at,
      label: o.kind === 'checker' ? (o.checker_products?.name || 'Checker') : `${o.price_items?.network || ''} ${o.price_items?.size || ''}`.trim(),
      reference: o.orders?.short_id || '—',
      counterparty: o.buyer_phone || '',
      credit: o.status === 'delivered' ? Number(o.profit || 0) : 0,
      debit: 0,
      gross: Number(o.amount_paid || 0),
      status: o.status,
    }));
    const wdRows = ((withdrawals.data as any[]) || []).map((w: any) => ({
      kind: 'withdrawal' as const,
      id: w.id,
      created_at: w.created_at,
      label: 'Withdrawal to MoMo',
      reference: w.paystack_reference || '—',
      counterparty: `${w.momo_number || ''} ${w.momo_name ? `(${w.momo_name})` : ''}`.trim(),
      credit: 0,
      debit: w.status === 'rejected' || w.status === 'failed' ? 0 : Number(w.amount || 0),
      gross: Number(w.amount || 0),
      status: w.status,
    }));
    const merged = [...orderRows, ...wdRows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setRows(merged);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!storeId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => load(), 300); };
    const channel = supabase
      .channel(`store-transactions-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders', filter: `store_id=eq.${storeId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_withdrawals' }, refresh)
      .subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [storeId, load]);

  const handleExport = () => {
    exportRowsToCSV(`store-transactions-${csvTimestamp()}.csv`, rows.map(r => ({
      date: new Date(r.created_at).toISOString(),
      type: r.kind,
      label: r.label,
      reference: r.reference,
      counterparty: r.counterparty,
      credit: r.credit.toFixed(2),
      debit: r.debit.toFixed(2),
      status: r.status,
    })), [
      { key: 'date', label: 'Date' },
      { key: 'type', label: 'Type' },
      { key: 'label', label: 'Description' },
      { key: 'reference', label: 'Reference' },
      { key: 'counterparty', label: 'Counterparty' },
      { key: 'credit', label: 'Credit (GHS)' },
      { key: 'debit', label: 'Debit (GHS)' },
      { key: 'status', label: 'Status' },
    ]);
  };

  if (loading) return <Card className="p-8 text-center mt-4"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></Card>;

  return (
    <Card className="p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold">Financial Transactions</h4>
          <p className="text-xs text-muted-foreground">Profit credits from sales and debits from withdrawal payouts.</p>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={!rows.length}>
          <Download className="w-4 h-4 mr-2" />Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Credit</TableHead>
              <TableHead>Debit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No transactions yet.</TableCell></TableRow>}
            {rows.map(r => (
              <TableRow key={`${r.kind}-${r.id}`}>
                <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-xs capitalize">{r.kind === 'sale' ? 'Sale' : 'Withdrawal'}</TableCell>
                <TableCell className="text-xs">{r.label}<div className="text-[10px] text-muted-foreground">{r.counterparty}</div></TableCell>
                <TableCell className="text-xs font-mono">{r.reference}</TableCell>
                <TableCell className="text-success font-semibold">{r.credit > 0 ? formatGHS(r.credit) : '—'}</TableCell>
                <TableCell className="text-destructive font-semibold">{r.debit > 0 ? formatGHS(r.debit) : '—'}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
