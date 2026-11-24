import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/AdminLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Activity, Loader2 } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MODES = [
  { id: 'off', label: 'Off', help: 'Nothing is counted.' },
  { id: 'count', label: 'Counting only', help: 'Requests are counted. No limits are checked.' },
  { id: 'shadow', label: 'Shadow (would-block)', help: 'Limits are checked and would-be blocks recorded. Nothing is blocked.' },
] as const;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function AdminApiUsagePage() {
  const { user } = useAuth();
  const isSuper = user?.adminRole === 'Super Admin';
  const { toast } = useToast();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('admin_api_usage_report' as any, { p_from: from, p_to: to });
    if (error) toast({ title: 'Could not load usage', description: error.message, variant: 'destructive' });
    setData(data); setLoading(false);
  }, [days, toast]);
  useEffect(() => { load(); }, [load]);

  const setMode = async (mode: string): Promise<void> => {
    const { error } = await supabase.rpc('admin_set_api_monitor_mode' as any, { p_mode: mode });
    setPending(null);
    if (error) { toast({ title: 'Mode not changed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Monitoring mode updated' }); load();
  };

  const t = data?.totals ?? {};
  const max = Math.max(1, ...(data?.daily ?? []).map((d: any) => d.requests + d.invalid));
  const stats = [
    { label: 'API requests', value: t.requests ?? 0 },
    { label: 'Successful', value: t.successful ?? 0 },
    { label: 'Unsuccessful', value: t.unsuccessful ?? 0 },
    { label: 'Invalid-key attempts', value: data?.invalid_key_attempts ?? 0 },
    { label: 'Would have been blocked', value: t.would_block ?? 0 },
    { label: 'Active keys', value: t.active_keys ?? 0 },
  ];

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center"><Activity className="h-5 w-5" /></div>
            <div>
              <h1 className="text-xl font-display font-bold">API Usage</h1>
              <p className="text-sm text-muted-foreground">Developer API request monitoring. Days are UTC (same as Ghana time).</p>
            </div>
          </div>
          <div className="flex gap-1">
            {[1, 7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>{d === 1 ? 'Today' : `${d} days`}</Button>
            ))}
          </div>
        </div>

        {loading && !data ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : data && (<>
          <Card className="rounded-[20px] p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Mode:</span>
              <Badge variant="secondary">{MODES.find((m) => m.id === data.mode)?.label ?? data.mode}</Badge>
              <Badge variant="outline">Blocking: disabled</Badge>
              {data.counting_started_at && <span className="text-xs text-muted-foreground">Counting since {new Date(data.counting_started_at).toUTCString()}</span>}
              {data.shadow_started_at && <span className="text-xs text-muted-foreground">· Shadow since {new Date(data.shadow_started_at).toUTCString()}</span>}
            </div>
            {isSuper && (
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <Button key={m.id} size="sm" variant="outline" disabled={data.mode === m.id} onClick={() => setPending(m.id)} title={m.help}>{m.label}</Button>
                ))}
              </div>
            )}
            {data.monitor_failures > 0 && <p className="text-sm text-destructive">{data.monitor_failures} monitoring write failure(s) in this period. API requests were not affected.</p>}
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {stats.map((s) => (
              <Card key={s.label} className="rounded-[20px] p-3"><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-bold">{s.value}</p></Card>
            ))}
          </div>

          <Card className="rounded-[20px] p-4">
            <p className="text-sm font-medium mb-2">Daily requests (invalid-key attempts shaded)</p>
            <div className="flex items-end gap-[3px] h-28">
              {data.daily.map((d: any) => (
                <div key={d.date} className="flex-1 flex flex-col justify-end h-full" title={`${dayLabel(d.date)}: ${d.requests} requests, ${d.invalid} invalid, ${d.would_block} would-block`}>
                  <div className="rounded-t bg-destructive/40" style={{ height: `${(d.invalid / max) * 100}%` }} />
                  <div className="bg-primary/60" style={{ height: `${Math.max(d.requests ? 3 : 1, (d.requests / max) * 100)}%` }} />
                </div>
              ))}
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="rounded-[20px] p-4">
              <p className="text-sm font-medium mb-2">By endpoint</p>
              <Table><TableHeader><TableRow><TableHead>Endpoint</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="text-right">Unsuccessful</TableHead></TableRow></TableHeader>
                <TableBody>{data.by_endpoint.length ? data.by_endpoint.map((e: any) => (
                  <TableRow key={e.endpoint}><TableCell>{e.endpoint}</TableCell><TableCell className="text-right">{e.requests}</TableCell><TableCell className="text-right">{e.unsuccessful ?? 0}</TableCell></TableRow>
                )) : <TableRow><TableCell colSpan={3} className="text-muted-foreground">No requests recorded.</TableCell></TableRow>}</TableBody></Table>
            </Card>
            <Card className="rounded-[20px] p-4 space-y-2">
              <p className="text-sm font-medium">Results</p>
              <div className="flex flex-wrap gap-2">{Object.entries(data.by_outcome).map(([k, v]) => <Badge key={k} variant="outline">{k}: {String(v)}</Badge>)}</div>
              <p className="text-sm font-medium pt-2">Would-block by rule (shadow mode)</p>
              <div className="flex flex-wrap gap-2">{Object.keys(data.would_block_rules).length ? Object.entries(data.would_block_rules).map(([k, v]) => <Badge key={k} variant="outline">{k}: {String(v)}</Badge>) : <span className="text-xs text-muted-foreground">None</span>}</div>
            </Card>
          </div>

          {isSuper ? (<>
            <Card className="rounded-[20px] p-4">
              <p className="text-sm font-medium mb-2">Top API keys</p>
              <Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Key</TableHead><TableHead className="text-right">Today</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="text-right">Error rate</TableHead><TableHead className="text-right">Would-block</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>{data.top_keys.length ? data.top_keys.map((k: any, i: number) => {
                  const err = k.requests ? (k.unsuccessful ?? 0) / k.requests : 0;
                  const dailyCap = data.limits?.key?.read?.per_day ?? 5000;
                  const high = (k.today ?? 0) >= 0.8 * dailyCap || err > 0.2 || k.would_block > 0;
                  return (
                    <TableRow key={i}><TableCell>{k.customer_name}</TableCell><TableCell className="font-mono text-xs">{k.key_name} · {k.key_prefix}…{!k.is_active && ' (revoked)'}</TableCell>
                      <TableCell className="text-right">{k.today ?? 0}</TableCell><TableCell className="text-right">{k.requests}</TableCell><TableCell className="text-right">{(err * 100).toFixed(0)}%</TableCell><TableCell className="text-right">{k.would_block}</TableCell>
                      <TableCell>{high && <Badge variant="destructive">High usage</Badge>}</TableCell></TableRow>
                  );
                }) : <TableRow><TableCell colSpan={7} className="text-muted-foreground">No key activity.</TableCell></TableRow>}</TableBody></Table>
            </Card>
            <Card className="rounded-[20px] p-4 space-y-2">
              <p className="text-sm font-medium">Current limits (not enforced)</p>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                {(['key', 'customer'] as const).map((sc) => (
                  <div key={sc} className="rounded-2xl border p-3">
                    <p className="font-medium mb-1">{sc === 'key' ? 'Per API key' : 'Per customer (all keys)'}</p>
                    {(['read', 'purchase'] as const).map((cl) => { const l = data.limits?.[sc]?.[cl] ?? {}; return (
                      <p key={cl} className="text-muted-foreground">{cl === 'read' ? 'Reads' : 'Purchases'}: {l.burst_10s}/10s · {l.per_minute}/min · {l.per_day}/day</p>); })}
                  </div>
                ))}
              </div>
            </Card>
          </>) : <p className="text-xs text-muted-foreground">Managers see aggregate totals only. Per-customer and per-key details are limited to Super Admins.</p>}
        </>)}
      </div>
      <ConfirmDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}
        title="Change monitoring mode?" description={MODES.find((m) => m.id === pending)?.help ?? ''}
        confirmLabel="Change mode" onConfirm={async () => { if (pending) await setMode(pending); }} />
    </AdminLayout>
  );
}
