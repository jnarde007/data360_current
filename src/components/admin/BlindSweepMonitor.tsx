import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Play, FlaskConical, RefreshCw, CheckCircle, XCircle, Clock, Search } from 'lucide-react';

interface BlindSweepRun {
  id: string;
  ran_at: string;
  hours_back: number;
  dry_run: boolean;
  scanned: number;
  already_local: number;
  recovered_topup: number;
  flagged_needs_review: number;
  skipped_unsafe: number;
  errors: number;
  succeeded: boolean;
  error_message: string | null;
  triggered_by: string;
  duration_ms: number | null;
}

const SCHEDULE_LABEL = 'Every 5 minutes';

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  onRecovered?: () => void;
}

export function BlindSweepMonitor({ onRecovered }: Props) {
  const { toast } = useToast();
  const [runs, setRuns] = useState<BlindSweepRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<'live' | 'dry' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('blind_sweep_runs' as any)
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(10);
    setRuns(((data || []) as unknown) as BlindSweepRun[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const trigger = async (mode: 'live' | 'dry') => {
    setRunning(mode);
    try {
      const res = await supabase.functions.invoke('paystack-blind-sweep', {
        body: {
          hours_back: 24,
          dry_run: mode === 'dry',
          triggered_by: mode === 'dry' ? 'admin_dry_run' : 'admin_manual',
        },
      });
      if (res.error) throw res.error;
      const d = res.data as any;
      toast({
        title: mode === 'dry' ? 'Dry run complete' : 'Blind sweep complete',
        description: `Scanned ${d?.scanned ?? 0} · Recovered ${d?.recovered_topup ?? 0} · Flagged ${d?.flagged_needs_review ?? 0}${mode === 'dry' ? ' (no changes written)' : ''}`,
      });
      await load();
      if (mode === 'live') onRecovered?.();
    } catch (e: any) {
      toast({ title: mode === 'dry' ? 'Dry run failed' : 'Blind sweep failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setRunning(null);
    }
  };

  const lastRun = runs[0];
  const lastSuccess = runs.find(r => r.succeeded && !r.dry_run);

  return (
    <Card>
      <CardContent className="p-5 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Search className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Paystack Blind Sweep</h2>
              <p className="text-xs text-muted-foreground">
                Auto-scans Paystack for successful payments missing locally · {SCHEDULE_LABEL}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => trigger('dry')} disabled={running !== null} className="gap-1.5">
              {running === 'dry' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              Dry Run
            </Button>
            <Button variant="default" size="sm" onClick={() => trigger('live')} disabled={running !== null} className="gap-1.5">
              {running === 'live' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run Now
            </Button>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Last run summary */}
        {lastRun ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label="Last Run" value={relTime(lastRun.ran_at)} hint={formatTime(lastRun.ran_at)} status={lastRun.succeeded ? 'ok' : 'error'} />
            <Stat label="Scanned" value={lastRun.scanned.toString()} />
            <Stat label="Already Local" value={lastRun.already_local.toString()} />
            <Stat label="Recovered" value={lastRun.recovered_topup.toString()} status={lastRun.recovered_topup > 0 ? 'ok' : undefined} />
            <Stat label="Needs Review" value={lastRun.flagged_needs_review.toString()} status={lastRun.flagged_needs_review > 0 ? 'warn' : undefined} />
            <Stat label="Errors" value={lastRun.errors.toString()} status={lastRun.errors > 0 ? 'error' : undefined} />
            <Stat label="Trigger" value={lastRun.triggered_by} hint={lastRun.dry_run ? 'dry run' : 'live'} />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-2">
            {loading ? 'Loading run history…' : 'No sweep runs recorded yet. The first cron tick will populate this.'}
          </div>
        )}

        {lastRun && !lastRun.succeeded && lastRun.error_message && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
            <strong>Last run failed:</strong> {lastRun.error_message}
          </div>
        )}

        {/* Recent history */}
        {runs.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent Runs</p>
            <div className="rounded-lg border border-border/50 divide-y divide-border/50 overflow-hidden">
              {runs.map(r => (
                <div key={r.id} className="grid grid-cols-12 gap-2 items-center px-3 py-2 text-xs hover:bg-muted/30">
                  <div className="col-span-3 flex items-center gap-2">
                    {r.succeeded ? <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                    <span className="text-foreground truncate">{formatTime(r.ran_at)}</span>
                  </div>
                  <div className="col-span-2 text-muted-foreground">
                    {r.dry_run && <Badge variant="outline" className="text-[10px] mr-1">dry</Badge>}
                    {r.triggered_by}
                  </div>
                  <div className="col-span-1 text-center text-muted-foreground">{r.scanned}</div>
                  <div className="col-span-1 text-center text-muted-foreground">{r.already_local}</div>
                  <div className={`col-span-1 text-center font-medium ${r.recovered_topup > 0 ? 'text-primary' : 'text-muted-foreground'}`}>{r.recovered_topup}</div>
                  <div className={`col-span-1 text-center font-medium ${r.flagged_needs_review > 0 ? 'text-warning' : 'text-muted-foreground'}`}>{r.flagged_needs_review}</div>
                  <div className={`col-span-1 text-center ${r.errors > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{r.errors}</div>
                  <div className="col-span-2 text-right text-muted-foreground flex items-center justify-end gap-1">
                    <Clock className="w-3 h-3" />
                    {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-12 gap-2 items-center px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20">
                <div className="col-span-3">Time</div>
                <div className="col-span-2">Trigger</div>
                <div className="col-span-1 text-center">Scan</div>
                <div className="col-span-1 text-center">Local</div>
                <div className="col-span-1 text-center">Recov</div>
                <div className="col-span-1 text-center">Review</div>
                <div className="col-span-1 text-center">Err</div>
                <div className="col-span-2 text-right">Duration</div>
              </div>
            </div>
          </div>
        )}

        {lastSuccess && (
          <p className="text-[11px] text-muted-foreground">
            Last successful live run: {relTime(lastSuccess.ran_at)} · scan window {lastSuccess.hours_back}h
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint, status }: { label: string; value: string; hint?: string; status?: 'ok' | 'warn' | 'error' }) {
  const color =
    status === 'ok' ? 'text-primary' :
    status === 'warn' ? 'text-warning' :
    status === 'error' ? 'text-destructive' :
    'text-foreground';
  return (
    <div className="rounded-lg bg-muted/30 border border-border/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold ${color} truncate`} title={hint || value}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground truncate">{hint}</p>}
    </div>
  );
}
