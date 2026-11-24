import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Copy, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface WindowState {
  enabled: boolean;
  expiresAt: string | null;
  note: string | null;
  approvedBy: string | null;
  killSwitch: boolean;
}

export function DiagnosticsApprovalCard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.adminRole === 'Super Admin';
  const { toast } = useToast();

  const [state, setState] = useState<WindowState>({ enabled: false, expiresAt: null, note: null, approvedBy: null, killSwitch: false });
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState('15');
  const [reason, setReason] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', [
        'diagnostics_live_calls_allowed',
        'diagnostics_live_calls_expires_at',
        'diagnostics_live_calls_note',
        'diagnostics_live_calls_approved_by',
        'disable_provider_diagnostics',
      ]);
    const m: Record<string, string> = {};
    (data || []).forEach((r: { key: string; value: string }) => { m[r.key] = r.value; });
    setState({
      enabled: m.diagnostics_live_calls_allowed === 'true',
      expiresAt: m.diagnostics_live_calls_expires_at || null,
      note: m.diagnostics_live_calls_note || null,
      approvedBy: m.diagnostics_live_calls_approved_by || null,
      killSwitch: m.disable_provider_diagnostics === 'true',
    });
    setLoading(false);
  };

  const toggleKillSwitch = async (disabled: boolean) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_disable_provider_diagnostics', { _disabled: disabled });
      if (error) throw error;
      setToken(null);
      await load();
      toast({
        title: disabled ? 'Kill switch ENABLED' : 'Kill switch disabled',
        description: disabled
          ? 'All provider diagnostic calls are now globally blocked.'
          : 'Diagnostic calls can resume (still require approval).',
        variant: disabled ? 'destructive' : 'success',
      });
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);


  if (!isSuperAdmin) return null;

  const expiryMs = state.expiresAt ? new Date(state.expiresAt).getTime() : 0;
  const active = state.enabled && expiryMs > now;
  const remainingSec = active ? Math.max(0, Math.floor((expiryMs - now) / 1000)) : 0;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');

  const openWindow = async () => {
    setBusy(true);
    try {
      const d = parseInt(duration, 10);
      if (!Number.isFinite(d) || d < 1 || d > 60) {
        toast({ title: 'Invalid duration', description: 'Duration must be 1–60 minutes.', variant: 'destructive' });
        return;
      }
      if (reason.trim().length < 5) {
        toast({ title: 'Reason required', description: 'Provide a short reason (5+ chars).', variant: 'destructive' });
        return;
      }
      const { data, error } = await supabase.rpc('set_diagnostics_window', {
        _enabled: true,
        _duration_minutes: d,
        _note: reason.trim(),
      });
      if (error) throw error;
      const tok = (data as { confirmation_token?: string } | null)?.confirmation_token || null;
      setToken(tok);
      setReason('');
      await load();
      toast({ title: 'Diagnostics window opened', description: 'A one-time confirmation token has been issued.', variant: 'success' });
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const closeWindow = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_diagnostics_window', {
        _enabled: false,
        _duration_minutes: 1,
        _note: 'closed',
      });
      if (error) throw error;
      setToken(null);
      await load();
      toast({ title: 'Diagnostics window closed' });
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const rotateToken = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('rotate_diagnostics_token');
      if (error) throw error;
      const tok = (data as { confirmation_token?: string } | null)?.confirmation_token || null;
      setToken(tok);
      toast({ title: 'New confirmation token issued' });
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card glow-border p-5 space-y-4 border-amber-500/40">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h2 className="text-lg font-display font-semibold text-foreground">Provider Diagnostics Approval</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Live calls to provider APIs (iGet, Portal-02) from admin diagnostics are <strong>blocked by default</strong>.
            Open a short, time-boxed window with a reason to enable read-only probes. <strong>Real order placement
            via diagnostics is permanently disabled</strong> and cannot be unlocked by this window.
          </p>
        </div>
      </div>

      <div className={`rounded-lg p-3 border ${state.killSwitch ? 'bg-destructive/10 border-destructive/40' : 'bg-muted/30 border-border'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium text-foreground">Global kill switch</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {state.killSwitch
                ? 'ENABLED — every provider diagnostic call is blocked, regardless of approval.'
                : 'Disabled. Enable to instantly block all diagnostic calls and close any open window.'}
            </div>
          </div>
          <Button
            size="sm"
            variant={state.killSwitch ? 'outline' : 'destructive'}
            onClick={() => toggleKillSwitch(!state.killSwitch)}
            disabled={busy}
          >
            {state.killSwitch ? 'Disable kill switch' : 'Enable kill switch'}
          </Button>
        </div>
      </div>


      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : active ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-success/10 border border-success/30 p-3 text-sm">
            <div className="font-medium text-foreground">Window open · expires in <span className="font-mono">{mm}:{ss}</span></div>
            {state.note && <div className="text-xs text-muted-foreground mt-1">Reason: {state.note}</div>}
          </div>

          {token ? (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/40 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">
                <KeyRound className="w-4 h-4" /> One-time confirmation token (shown once)
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background/60 px-2 py-1 text-xs font-mono">{token}</code>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(token); toast({ title: 'Copied' }); }}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Required for each diagnostic call. It is consumed on use — rotate to get a new one.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
              <Lock className="w-3.5 h-3.5" /> Token has been used or hidden. Rotate to issue a new one.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={rotateToken} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              Rotate token
            </Button>
            <Button size="sm" variant="destructive" onClick={closeWindow} disabled={busy}>
              Close window now
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3">
            <div>
              <Label className="text-xs">Duration (min)</Label>
              <Input type="number" min={1} max={60} value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Reason (required)</Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Investigating iGet balance discrepancy for ticket #1234"
                className="mt-1 resize-none"
              />
            </div>
          </div>
          <Button onClick={() => setConfirmOpen(true)} disabled={busy} className="gap-2">
            <AlertTriangle className="w-4 h-4" /> Open diagnostics window
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open live diagnostics window?</AlertDialogTitle>
            <AlertDialogDescription>
              This authorizes <strong>read-only</strong> live calls to provider APIs (balance, status lookup)
              for the next {duration} minute(s). Every call is audited. Real order placement remains disabled
              regardless of this window.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={openWindow}>Yes, open window</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
