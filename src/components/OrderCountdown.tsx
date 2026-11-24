import { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, X, Loader2, AlertTriangle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { serverNow, useServerTimeSync } from '@/hooks/use-server-time';

interface OrderCountdownProps {
  orderId: string;
  customerId: string;
  gracePeriodEndsAt: string;
  shortId: string;
  onCancelled?: () => void;
  onExpired?: () => void;
  /** If true, show inline helper text explaining the waiting period */
  showHelper?: boolean;
  /** If true, show a "Proceed Now" action with confirmation */
  allowProceedNow?: boolean;
  /** Called after user confirms proceed-now and it succeeds */
  onProceeded?: () => void;
}

const GRACE_PERIOD_TOTAL_SECONDS = 180; // 3 minutes

function parseExpiryMs(value: string | null | undefined): number {
  if (!value) return 0;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value;
  const fallback = Date.parse(normalized);
  return Number.isFinite(fallback) ? fallback : 0;
}

function computeRemainingSeconds(expiresAtMs: number): number {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return 0;
  const rawRemaining = Math.floor((expiresAtMs - serverNow()) / 1000);
  return Math.max(0, rawRemaining);
}

export function OrderCountdown({
  orderId,
  customerId,
  gracePeriodEndsAt,
  shortId,
  onCancelled,
  onExpired,
  showHelper = false,
  allowProceedNow = false,
  onProceeded,
}: OrderCountdownProps) {
  const { ready: timeReady } = useServerTimeSync();
  const hasExpiredRef = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [proceeding, setProceeding] = useState(false);
  const [showProceedConfirm, setShowProceedConfirm] = useState(false);
  const [isCrossNetwork, setIsCrossNetwork] = useState(false);
  const { toast } = useToast();

  // Cross-network orders must serve the full grace period — no "Proceed Now" skip.
  useEffect(() => {
    if (!allowProceedNow) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('orders')
        .select('network, detected_network')
        .eq('id', orderId)
        .maybeSingle();
      if (!active || !data) return;
      setIsCrossNetwork(!!data.detected_network && data.detected_network !== data.network);
    })();
    return () => { active = false; };
  }, [orderId, allowProceedNow]);


  useEffect(() => {
    hasExpiredRef.current = false;

    if (!timeReady) {
      setRemaining(null);
      return;
    }

    const expMs = parseExpiryMs(gracePeriodEndsAt);

    const tick = () => {
      const next = computeRemainingSeconds(expMs);
      setRemaining(next);
      if (next <= 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        onExpired?.();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [gracePeriodEndsAt, onExpired, orderId, timeReady]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-order', {
        body: { order_id: orderId, customer_id: customerId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: 'Order cancelled',
        description: `${shortId} has been cancelled and your wallet refunded.`,
      });
      onCancelled?.();
    } catch (err: any) {
      toast({ title: err?.message || 'Failed to cancel order', variant: 'destructive' });
    } finally {
      setCancelling(false);
    }
  }, [orderId, customerId, shortId, onCancelled, toast]);

  const handleProceedNow = useCallback(async () => {
    setProceeding(true);
    setShowProceedConfirm(false);
    try {
      // 1. Clear grace period so cron won't race
      const { data, error } = await supabase.rpc('proceed_order_now' as any, {
        p_customer_id: customerId,
        p_order_id: orderId,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.error) throw new Error(result.error);

      toast({
        title: 'Submitting order...',
        description: `${shortId} is being processed now.`,
        variant: 'success',
      });

      // 2. Immediately trigger delivery (fire-and-forget — cron is fallback)
      supabase.functions.invoke('deliver-order', {
        body: { order_id: orderId },
      }).catch(() => {
        // Non-critical — cron will pick it up
      });

      onProceeded?.();
    } catch (err: any) {
      toast({ title: err?.message || 'Failed to proceed', variant: 'destructive' });
    } finally {
      setProceeding(false);
    }
  }, [orderId, customerId, shortId, onProceeded, toast]);

  if (!timeReady || remaining === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Syncing timer...</span>
      </div>
    );
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progressPercent = Math.min(100, ((GRACE_PERIOD_TOTAL_SECONDS - remaining) / GRACE_PERIOD_TOTAL_SECONDS) * 100);

  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        <span>Grace period expired — order is being submitted</span>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Helper text */}
        {showHelper && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            This waiting period gives you time to review your order and cancel if you made a mistake.
          </p>
        )}

        {/* Timer bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-info" />
              <span className="text-xs text-muted-foreground">Time remaining</span>
            </div>
            <span className="text-sm font-mono font-bold text-info">{timeStr}</span>
          </div>
          <Progress value={progressPercent} className="h-1.5 bg-muted/50" />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5 text-destructive border-destructive/40 bg-destructive/5 hover:bg-destructive/10 hover:border-destructive/50"
            onClick={handleCancel}
            disabled={cancelling || proceeding}
          >
            <X className="w-3.5 h-3.5" />
            {cancelling ? 'Cancelling...' : 'Cancel Order'}
          </Button>

          {allowProceedNow && !isCrossNetwork && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/40"
              onClick={() => setShowProceedConfirm(true)}
              disabled={cancelling || proceeding}
            >
              <Zap className="w-3.5 h-3.5" />
              {proceeding ? 'Processing...' : 'Proceed Now'}
            </Button>
          )}
        </div>

        {allowProceedNow && isCrossNetwork && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            This is a cross-network order, so the full 3-minute waiting period applies and cannot be skipped.
          </p>
        )}

      </div>

      {/* Proceed Now confirmation dialog */}
      <AlertDialog open={showProceedConfirm} onOpenChange={setShowProceedConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Proceed immediately?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              If you proceed now, your order will begin processing immediately and <strong className="text-foreground">may no longer be cancellable</strong>. Only do this if you are certain the order details are correct.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleProceedNow} className="gradient-primary text-primary-foreground border-0">
              Yes, Proceed Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
