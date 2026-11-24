import { useEffect, useState, useCallback, useRef } from 'react';
import { CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

type Status = 'verified' | 'queued' | 'unverified' | 'unavailable';
const MTN_PREFIXES = ['024', '025', '053', '054', '055', '059'];
/** Max time checkout waits for the checker before continuing anyway. */
export const MTN_CHECK_TIMEOUT_MS = 2500;

export function isMtnCheckable(phone: string, network?: string | null) {
  const digits = (phone || '').replace(/\D/g, '');
  return (!network || network === 'MTN') && digits.length === 10 && MTN_PREFIXES.includes(digits.slice(0, 3));
}

/**
 * Background MTN number check. Reports `ready=false` only while a check is in flight
 * (at most MTN_CHECK_TIMEOUT_MS), then always fails open so checkout is never stuck.
 */
export function MtnVerifyBadge({ phone, network, onReadyChange }: {
  phone: string; network?: string | null; onReadyChange?: (ready: boolean) => void;
}) {
  const digits = (phone || '').replace(/\D/g, '');
  const eligible = isMtnCheckable(phone, network);
  const [state, setState] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);
  const readyRef = useRef(onReadyChange);
  readyRef.current = onReadyChange;

  const run = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    readyRef.current?.(false);
    const timeout = new Promise<null>(r => setTimeout(() => r(null), MTN_CHECK_TIMEOUT_MS));
    const call = supabase.functions.invoke('verify-mtn-number', { body: { phone: digits } })
      .then(({ data, error }) => (error || !data?.status ? null : (data.status as Status)))
      .catch(() => null);
    const result = await Promise.race([call, timeout]);
    if (id !== reqId.current) return;
    setState(result ?? 'unavailable');
    setLoading(false);
    readyRef.current?.(true);
  }, [digits]);

  useEffect(() => {
    setState(null);
    reqId.current++;
    setLoading(false);
    if (!eligible) { readyRef.current?.(true); return; }
    readyRef.current?.(false);
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [eligible, run]);

  if (!eligible) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> Checking MTN number…
      </div>
    );
  }
  if (!state || state === 'unavailable') return null; // silent fallback

  if (state === 'verified') {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-success">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> MTN number verified
      </div>
    );
  }

  const text = state === 'queued'
    ? 'MTN verification is in progress. You can still place your order — delivery may take a little longer.'
    : "This MTN number hasn't been verified yet. You can still place your order — delivery may take longer.";

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-xl border bg-primary/10 border-primary/20 text-foreground">
      <Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
      <p className="flex-1 min-w-0 text-[11px] leading-snug">{text}</p>
      <Button variant="link" type="button" onClick={run} disabled={loading} aria-label="Check again"
        className="h-auto p-0 shrink-0 text-[11px] font-medium gap-1 [&_svg]:size-3">
        <RefreshCw /> Check again
      </Button>
    </div>
  );
}
