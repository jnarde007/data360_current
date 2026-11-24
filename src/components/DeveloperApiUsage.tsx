import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';

type Month = { month: string; purchases: number; amount_charged: number };
type Summary = { total_purchases: number; delivered: number; failed_or_rejected: number; pending_or_processing: number; total_amount_charged: number; current_month: Month; previous_month: Month };
type Day = { date: string; purchases: number; amount_charged: number; delivered: number; failed_or_rejected: number };

const ghs = (n: number) => `GH₵${Number(n || 0).toFixed(2)}`;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function DeveloperApiUsage() {
  const [data, setData] = useState<{ summary: Summary; history: Day[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden'>('loading');

  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    supabase.rpc('get_my_developer_api_usage', { p_from: from, p_to: to }).then(({ data, error }) => {
      const d = data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (error || !d?.available) return setState('hidden');
      setData({ summary: d.summary, history: d.history });
      setState('ready');
    });
  }, []);

  if (state !== 'ready' || !data) return null;
  const s = data.summary;
  const max = Math.max(1, ...data.history.map((d) => d.purchases));
  const stats = [
    { label: 'Total API purchases', value: s.total_purchases },
    { label: 'Delivered', value: s.delivered },
    { label: 'Failed / rejected', value: s.failed_or_rejected },
    { label: 'Pending / processing', value: s.pending_or_processing },
  ];

  return (
    <Card className="rounded-[20px] p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">API purchase usage</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((x) => (
          <div key={x.label} className="rounded-2xl bg-primary/10 p-3">
            <p className="text-xs text-muted-foreground">{x.label}</p>
            <p className="text-xl font-bold">{x.value}</p>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border p-3">
          <p className="text-xs text-muted-foreground">Total charged</p>
          <p className="text-lg font-bold">{ghs(s.total_amount_charged)}</p>
        </div>
        {[s.current_month, s.previous_month].map((m, i) => (
          <div key={m.month} className="rounded-2xl border p-3">
            <p className="text-xs text-muted-foreground">{i === 0 ? 'This month' : 'Last month'} · {monthLabel(m.month)}</p>
            <p className="text-lg font-bold">{ghs(m.amount_charged)}</p>
            <p className="text-xs text-muted-foreground">{m.purchases} purchase{m.purchases === 1 ? '' : 's'}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Daily purchases · {dayLabel(data.history[0]?.date)} – {dayLabel(data.history[data.history.length - 1]?.date)}</p>
        <div className="flex items-end gap-[3px] h-24">
          {data.history.map((d) => (
            <div key={d.date} title={`${dayLabel(d.date)}: ${d.purchases} purchase(s), ${ghs(d.amount_charged)}`}
              className="flex-1 rounded-t bg-primary/60" style={{ height: `${Math.max(4, (d.purchases / max) * 100)}%`, opacity: d.purchases ? 1 : 0.25 }} />
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Counts cover purchases made with your API key. Request counts are shown separately above.</p>
    </Card>
  );
}

type ReqUsage = {
  mode: string; counting_started_at: string | null;
  limits: { key: Record<'read' | 'purchase', { burst_10s: number; per_minute: number; per_day: number }> };
  totals: { requests: number; successful: number; unsuccessful: number };
  by_endpoint: { endpoint: string; requests: number }[];
  daily: { date: string; requests: number; unsuccessful: number }[];
  by_key: { name: string; key_prefix: string; is_active: boolean; requests: number }[];
};

/** Phase 9: request counts (distinct from purchase counts). Own data only. */
export function DeveloperApiRequestUsage() {
  const [d, setD] = useState<ReqUsage | null>(null);
  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc('get_my_api_request_usage' as any, { p_from: from, p_to: to }).then(({ data, error }) => {
      const r = data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!error && r?.available) setD(r);
    });
  }, []);
  if (!d) return null;
  const max = Math.max(1, ...d.daily.map((x) => x.requests));
  const l = d.limits?.key;
  return (
    <Card className="rounded-[20px] p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">API request usage · last 30 days</h2>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[['API requests', d.totals.requests], ['Successful', d.totals.successful], ['Unsuccessful', d.totals.unsuccessful]].map(([k, v]) => (
          <div key={k as string} className="rounded-2xl bg-primary/10 p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-xl font-bold">{v}</p></div>
        ))}
      </div>
      <div className="flex items-end gap-[3px] h-20">
        {d.daily.map((x) => (
          <div key={x.date} title={`${dayLabel(x.date)}: ${x.requests} request(s), ${x.unsuccessful} unsuccessful`}
            className="flex-1 rounded-t bg-primary/60" style={{ height: `${Math.max(4, (x.requests / max) * 100)}%`, opacity: x.requests ? 1 : 0.25 }} />
        ))}
      </div>
      {d.by_endpoint.length > 0 && (
        <div className="flex flex-wrap gap-2">{d.by_endpoint.map((e) => <span key={e.endpoint} className="text-xs rounded-full border px-2 py-1">{e.endpoint}: {e.requests}</span>)}</div>
      )}
      {d.by_key.length > 0 && (
        <div className="space-y-1">{d.by_key.map((k) => (
          <div key={k.key_prefix} className="flex justify-between text-sm"><span className="font-mono text-xs">{k.name} · {k.key_prefix}…{!k.is_active && ' (revoked)'}</span><span>{k.requests}</span></div>
        ))}</div>
      )}
      {l && <p className="text-xs text-muted-foreground">Planned per-key limits (not enforced yet): reads {l.read.per_minute}/min, {l.read.per_day}/day · purchases {l.purchase.per_minute}/min, {l.purchase.per_day}/day.</p>}
      <p className="text-xs text-muted-foreground">
        Requests are every call to the API, including retries and failed calls. They are different from purchases.
        {d.counting_started_at ? ` Counting started ${new Date(d.counting_started_at).toUTCString()}; earlier requests were never recorded.` : ''} Days are UTC (same as Ghana time).
      </p>
    </Card>
  );
}
