import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { formatGHS } from '@/lib/utils';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'guest_pending_payment';

export interface GuestPendingPayment {
  reference: string;
  amount: number;
  buyer_phone: string;
  network?: string;
  bundle?: string;
  recipient?: string;
  created_at: number;
}

export function setGuestPendingPayment(p: GuestPendingPayment) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
}

export function clearGuestPendingPayment() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function getGuestPendingPayment(): GuestPendingPayment | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    // Ignore entries older than 30 minutes
    if (!p?.created_at || Date.now() - p.created_at > 30 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return p as GuestPendingPayment;
  } catch {
    return null;
  }
}

interface Props {
  onRecovered?: (result: any, pending: GuestPendingPayment) => void;
}

/**
 * Lightweight in-page recovery surface for guest checkout.
 * Detects an in-flight guest reference stored in localStorage and lets
 * the user verify it without leaving the buy page. Calls the existing
 * `guest-finalize` path — never creates a new payment_attempt.
 */
export function GuestPaymentRecoveryBanner({ onRecovered }: Props) {
  const [pending, setPending] = useState<GuestPendingPayment | null>(null);
  const [status, setStatus] = useState<'idle' | 'auto_checking' | 'checking' | 'recovered' | 'partial' | 'failed' | 'dismissed'>('idle');
  const [trackingToken, setTrackingToken] = useState<string>('');
  const autoChecked = useRef(false);

  useEffect(() => {
    const p = getGuestPendingPayment();
    if (p) setPending(p);
  }, []);

  const verify = useCallback(async (auto: boolean) => {
    if (!pending) return;
    setStatus(auto ? 'auto_checking' : 'checking');
    try {
      const res = await supabase.functions.invoke('guest-finalize', {
        body: { reference: pending.reference, buyer_phone: pending.buyer_phone, expected_amount: pending.amount },
      });
      const result = res.data as any;
      if (res.error) throw new Error(res.error.message);
      if (result?.error) throw new Error(result.error);

      if (result?.success || result?.already_processed || result?.orders?.length) {
        const token = result?.tracking_tokens
          ? Object.values(result.tracking_tokens)[0] as string
          : (result?.tracking_token || '');
        if (token) setTrackingToken(String(token));

        setStatus(result?.partial_failure ? 'partial' : 'recovered');
        clearGuestPendingPayment();
        onRecovered?.(result, pending);
      } else {
        setStatus('failed');
      }
    } catch {
      setStatus('failed');
    }
  }, [pending, onRecovered]);

  // Auto-check once if attempt is older than 30s
  useEffect(() => {
    if (!pending || autoChecked.current) return;
    const age = Date.now() - pending.created_at;
    if (age < 30000) return;
    autoChecked.current = true;
    verify(true);
  }, [pending, verify]);

  if (!pending || status === 'dismissed') return null;

  const dismiss = () => {
    clearGuestPendingPayment();
    setStatus('dismissed');
  };

  if (status === 'recovered') {
    return (
      <Alert className="border-success/40 bg-success/5 mb-4">
        <CheckCircle className="w-4 h-4 text-success" />
        <AlertTitle className="text-sm font-semibold">Payment confirmed</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-1">
          Your previous payment of <strong>{formatGHS(pending.amount)}</strong> went through and your order was created.
          <div className="flex gap-2 mt-2">
            {trackingToken && (
              <Link to={`/guest/track?token=${trackingToken}`}>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <ExternalLink className="w-3 h-3" /> Track Order
                </Button>
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={dismiss} className="h-7 text-xs">Dismiss</Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'partial') {
    return (
      <Alert className="border-warning/50 bg-warning/5 mb-4">
        <AlertCircle className="w-4 h-4 text-warning" />
        <AlertTitle className="text-sm font-semibold">Partial payment recovery</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-1">
          Some items from your payment of <strong>{formatGHS(pending.amount)}</strong> were processed. Please contact support for the remaining items.
          <div className="flex gap-2 mt-2">
            {trackingToken && (
              <Link to={`/guest/track?token=${trackingToken}`}>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <ExternalLink className="w-3 h-3" /> Track Order
                </Button>
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={dismiss} className="h-7 text-xs">Dismiss</Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'auto_checking' || status === 'checking') {
    return (
      <Alert className="border-primary/30 bg-primary/5 mb-4">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <AlertTitle className="text-sm font-semibold">Checking your previous payment…</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-1">
          We're confirming a recent payment of <strong>{formatGHS(pending.amount)}</strong> with the gateway.
        </AlertDescription>
      </Alert>
    );
  }

  // idle / failed
  return (
    <Alert className="border-warning/50 bg-warning/5 mb-4">
      <AlertTriangle className="w-4 h-4 text-warning" />
      <AlertTitle className="text-sm font-semibold">
        {status === 'failed' ? 'Payment not yet confirmed' : 'Incomplete payment detected'}
      </AlertTitle>
      <AlertDescription className="text-xs text-muted-foreground mt-1">
        {status === 'failed' ? (
          <span>The payment of <strong>{formatGHS(pending.amount)}</strong> may still be processing. Try again or track this order.</span>
        ) : (
          <span>A payment of <strong>{formatGHS(pending.amount)}</strong> was started but not completed. Check the status now.</span>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          <Button size="sm" variant="outline" onClick={() => verify(false)} className="h-7 text-xs gap-1">
            <RefreshCw className="w-3 h-3" /> Check payment status
          </Button>
          <Link to={`/guest/track?ref=${pending.reference}`}>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <ExternalLink className="w-3 h-3" /> Track this order
            </Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={dismiss} className="h-7 text-xs">Dismiss</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
