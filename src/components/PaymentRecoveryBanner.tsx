import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, XCircle, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { formatGHS } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface PaymentRecoveryBannerProps {
  attemptType: 'data_direct' | 'checker_direct';
  onRecovered?: () => void;
}

export function PaymentRecoveryBanner({ attemptType, onRecovered }: PaymentRecoveryBannerProps) {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState<any>(null);
  const [status, setStatus] = useState<'idle' | 'auto_checking' | 'checking' | 'recovered' | 'partial' | 'failed' | 'dismissed'>('idle');
  const [recoveryResult, setRecoveryResult] = useState<any>(null);
  const autoChecked = useRef(false);

  // Load pending attempt
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('payment_attempts' as any)
      .select('*')
      .eq('customer_id', user.id)
      .eq('attempt_type', attemptType)
      .in('status', ['pending', 'processing', 'partially_completed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }: any) => {
        if (data?.[0]) {
          const age = Date.now() - new Date(data[0].created_at).getTime();
          if (age > 30000) setPending(data[0]);
        }
      });
  }, [user?.id, attemptType]);

  // Automatic background check
  useEffect(() => {
    if (!pending || autoChecked.current || status !== 'idle') return;
    autoChecked.current = true;
    setStatus('auto_checking');

    supabase.functions.invoke('finalize-payment', {
      body: { reference: pending.paystack_reference, source: 'callback' },
    }).then(res => {
      const result = res.data as any;
      if (result?.success || result?.already_processed || result?.finalized) {
        if (result?.partial_failure) {
          setStatus('partial');
          setRecoveryResult(result);
        } else {
          setStatus('recovered');
          setRecoveryResult(result);
        }
        refreshUser();
        onRecovered?.();
      } else {
        setStatus('idle');
      }
    }).catch(() => {
      setStatus('idle');
    });
  }, [pending, status, toast, refreshUser, onRecovered]);

  const handleVerify = useCallback(async () => {
    if (!pending) return;
    setStatus('checking');
    try {
      const res = await supabase.functions.invoke('finalize-payment', {
        body: { reference: pending.paystack_reference, source: 'callback' },
      });
      if (res.error) throw new Error(res.error.message);
      const result = res.data as any;
      if (result?.error) throw new Error(result.error);

      if (result?.success || result?.already_processed || result?.finalized) {
        if (result?.partial_failure) {
          setStatus('partial');
          setRecoveryResult(result);
        } else {
          setStatus('recovered');
          setRecoveryResult(result);
        }
        refreshUser();
        onRecovered?.();
      } else {
        setStatus('failed');
      }
    } catch {
      setStatus('failed');
    }
  }, [pending, toast, refreshUser, onRecovered]);

  if (!pending || status === 'dismissed') return null;

  if (status === 'recovered') {
    return (
      <Alert className="border-primary/30 bg-primary/5 mb-4">
        <CheckCircle className="w-4 h-4 text-primary" />
        <AlertTitle className="text-sm font-semibold">Payment recovered!</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-1">
          Your payment of <strong>{formatGHS(pending.amount)}</strong> was verified and your {attemptType === 'data_direct' ? 'order' : 'purchase'} has been created.
          <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={() => setStatus('dismissed')} className="h-7 text-xs">
              Dismiss
            </Button>
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
          {recoveryResult?.items_succeeded}/{recoveryResult?.items_total} items from your payment of <strong>{formatGHS(pending.amount)}</strong> were processed.
          Some items could not be fulfilled — please contact support for assistance with the remaining items.
          <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={() => setStatus('dismissed')} className="h-7 text-xs">
              Dismiss
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'auto_checking') {
    return (
      <Alert className="border-primary/30 bg-primary/5 mb-4">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <AlertTitle className="text-sm font-semibold">Checking payment status...</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-1">
          We detected an incomplete payment. Checking with the payment gateway now.
        </AlertDescription>
      </Alert>
    );
  }

  const isChecking = status === 'checking';
  const isFailed = status === 'failed';

  return (
    <Alert className="border-warning/50 bg-warning/5 mb-4">
      {isChecking ? (
        <Loader2 className="w-4 h-4 animate-spin text-warning" />
      ) : isFailed ? (
        <XCircle className="w-4 h-4 text-muted-foreground" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-warning" />
      )}
      <AlertTitle className="text-sm font-semibold">
        {isChecking ? 'Checking payment status...' : isFailed ? 'Payment not yet confirmed' : 'Incomplete payment detected'}
      </AlertTitle>
      <AlertDescription className="text-xs text-muted-foreground mt-1">
        {isChecking ? (
          'Please wait while we verify your payment with Paystack.'
        ) : isFailed ? (
          <span>The payment of <strong>{formatGHS(pending.amount)}</strong> may still be processing. You can try again later or dismiss this.</span>
        ) : (
          <span>A payment of <strong>{formatGHS(pending.amount)}</strong> was started but not completed. Click below to check its status.</span>
        )}
        {!isChecking && (
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={handleVerify} disabled={isChecking} className="h-7 text-xs gap-1">
              <RefreshCw className="w-3 h-3" /> {isFailed ? 'Retry' : 'Check Status'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStatus('dismissed')} className="h-7 text-xs">
              Dismiss
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
