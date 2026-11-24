import { useState, useEffect, useCallback, useRef } from 'react';
import { CustomerLayout } from '@/components/CustomerLayout';
import { formatGHS } from '@/lib/mock-data';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Check, Loader2, Shield, Wallet, ArrowRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';


declare global {
  interface Window {
    PaystackPop: any;
  }
}

const PAYSTACK_FEE_RATE = 0.02;
const QUICK_AMOUNTS = [20, 50, 100, 200];

type PageState = 'form' | 'verifying' | 'success';

export default function TopupPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [pageState, setPageState] = useState<PageState>('form');
  const [submitting, setSubmitting] = useState(false);
  const [walletBalance, setWalletBalance] = useState(user?.wallet_balance || 0);
  const [paystackKey, setPaystackKey] = useState('');
  const [paystackLoaded, setPaystackLoaded] = useState(false);
  const [paystackFailed, setPaystackFailed] = useState(false);
  const [creditedAmount, setCreditedAmount] = useState(0);
  const [selectedQuick, setSelectedQuick] = useState<number | null>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef(0);

  const parsedAmount = parseFloat(amount) || 0;
  const fee = Math.round(parsedAmount * PAYSTACK_FEE_RATE * 100) / 100;
  const totalCharge = Math.round((parsedAmount + fee) * 100) / 100;

  useEffect(() => {
    loadPaystackKey();
    loadPaystackScript();
  }, []);

  const loadPaystackKey = async () => {
    const { data } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'paystack_public_key')
      .single();
    if (data?.value) setPaystackKey(data.value);
  };

  const loadPaystackScript = useCallback(() => {
    setPaystackFailed(false);

    // If script tag exists and PaystackPop is available, we're good
    const existing = document.getElementById('paystack-script');
    if (existing && window.PaystackPop) {
      setPaystackLoaded(true);
      return;
    }

    // Remove any stale/failed script tag so we can retry cleanly
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.id = 'paystack-script';
    script.src = 'https://js.paystack.co/v2/inline.js';

    const loadStart = Date.now();

    script.onload = () => {
      const elapsed = Date.now() - loadStart;
      console.info(`[Paystack] Script loaded in ${elapsed}ms`);
      setPaystackLoaded(true);
      setPaystackFailed(false);
      retryCountRef.current = 0;
    };

    script.onerror = () => {
      console.error(`[Paystack] Script failed to load (attempt ${retryCountRef.current + 1})`);
      script.remove();

      // Auto-retry up to 2 times with increasing delay
      if (retryCountRef.current < 2) {
        retryCountRef.current += 1;
        const delay = retryCountRef.current * 2000;
        console.info(`[Paystack] Retrying in ${delay}ms...`);
        setTimeout(loadPaystackScript, delay);
      } else {
        setPaystackFailed(true);
      }
    };

    document.head.appendChild(script);

    // Timeout fallback: if script hasn't loaded in 15s, mark as failed
    setTimeout(() => {
      if (!window.PaystackPop) {
        console.warn('[Paystack] Script load timed out after 15s');
        setPaystackFailed(true);
      }
    }, 15000);
  }, []);


  const verifyAndRecord = useCallback(async (reference: string, amt: number) => {
    setPageState('verifying');
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/verify-paystack`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference, customer_id: user?.customer_id || user?.id }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Verification failed');

      setCreditedAmount(amt);
      setWalletBalance(result.new_balance != null ? result.new_balance : walletBalance + amt);
      

      // Small delay so the verifying state is visible briefly
      await new Promise(r => setTimeout(r, 600));
      setPageState('success');
      setTimeout(() => successRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    } catch (err: any) {
      setPageState('form');
      toast({ title: 'Payment verification failed', description: err.message || 'We could not verify this transaction. Please contact support.', variant: 'destructive' });
    }
  }, [toast, user?.id, user?.customer_id, walletBalance]);

  // Prefill amount from dashboard shortcut (?amount=50)
  useEffect(() => {
    const v = Number(new URLSearchParams(window.location.search).get('amount'));
    if (v > 0 && v <= 10000) {
      setAmount(String(v));
      setSelectedQuick(QUICK_AMOUNTS.includes(v) ? v : null);
    }
  }, []);

  const handleQuickSelect = (val: number) => {
    setSelectedQuick(val);
    setAmount(String(val));
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value);
    const num = parseFloat(e.target.value);
    setSelectedQuick(QUICK_AMOUNTS.includes(num) ? num : null);
  };

  const handleReset = () => {
    setPageState('form');
    setAmount('');
    setSelectedQuick(null);
    setCreditedAmount(0);
  };

  const handleRetryPaystack = () => {
    retryCountRef.current = 0;
    setPaystackLoaded(false);
    setPaystackFailed(false);
    loadPaystackScript();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parsedAmount <= 0) {
      toast({ title: 'Invalid amount', description: 'Please enter a valid top-up amount greater than zero.', variant: 'destructive' });
      return;
    }
    if (!paystackKey) {
      toast({ title: 'Payment not configured', description: 'The payment gateway is not set up. Please contact support.', variant: 'destructive' });
      return;
    }
    if (paystackFailed) {
      toast({ title: 'Payment gateway unavailable', description: 'The payment provider could not be loaded. Tap "Retry" below to try again.', variant: 'destructive' });
      return;
    }
    if (!paystackLoaded || !window.PaystackPop) {
      return;
    }

    setSubmitting(true);

    const popup = new window.PaystackPop();
    popup.newTransaction({
      key: paystackKey,
      email: (user?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) ? user.email : 'customer@data360.com',
      amount: Math.round(totalCharge * 100),
      currency: 'GHS',
      metadata: {
        customer_id: user?.customer_id || user?.id,
        credit_amount: parsedAmount,
        custom_fields: [
          { display_name: 'Customer ID', variable_name: 'customer_id', value: user?.customer_id || user?.id },
          { display_name: 'Credit Amount', variable_name: 'credit_amount', value: String(parsedAmount) },
        ],
      },
      onSuccess: (transaction: any) => {
        setSubmitting(false);
        verifyAndRecord(transaction.reference, parsedAmount);
      },
      onCancel: () => {
        setSubmitting(false);
        toast({ title: 'Payment cancelled', variant: 'warning' });
      },
    });
  };

  // Verifying state — shown after Paystack returns, before backend confirms
  if (pageState === 'verifying') {
    return (
      <CustomerLayout>
        <div className="max-w-lg mx-auto flex flex-col items-center justify-center py-20 space-y-5 animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-display font-bold text-foreground">Verifying your payment...</h2>
            <p className="text-sm text-muted-foreground">Please wait while we confirm your top-up.</p>
          </div>
        </div>
      </CustomerLayout>
    );
  }

  // Success state — clean, focused, no other page content
  if (pageState === 'success') {
    return (
      <CustomerLayout>
        <div className="flex items-center justify-center py-12 sm:py-16">
          <Card ref={successRef} className="w-full max-w-md p-8 flex flex-col items-center space-y-6 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center">
              <Check className="w-8 h-8 text-success" strokeWidth={3} />
            </div>

            <div className="text-center space-y-1.5">
              <h2 className="text-xl font-display font-bold text-foreground">Payment Successful</h2>
              <p className="text-sm text-muted-foreground">Your wallet has been credited with {formatGHS(creditedAmount)}</p>
            </div>

            <div className="flex gap-3 w-full">
              <Button onClick={() => navigate('/wallet')} className="flex-1 gradient-primary text-primary-foreground border-0 gap-2">
                <Wallet className="w-4 h-4" />
                Go to Wallet
              </Button>
              <Button onClick={handleReset} variant="outline" className="flex-1">
                Top Up Again
              </Button>
            </div>
          </Card>
        </div>
      </CustomerLayout>
    );
  }

  // Normal form state
  return (
    <CustomerLayout>
      <div className="max-w-lg mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Top Up Wallet</h1>
          <p className="text-sm text-muted-foreground mt-1">Fund your wallet securely via Paystack</p>
        </div>


        <form onSubmit={handleSubmit} className="glass-card glow-border p-5 space-y-5">
          {/* Amount Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-foreground select-none">GH₵</span>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="Enter amount"
                value={amount}
                onChange={handleAmountChange}
                className="pl-12 h-12 text-lg font-semibold"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Quick Amount Chips */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick Amount</span>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleQuickSelect(val)}
                  disabled={submitting}
                  className={cn(
                    "h-10 rounded-xl text-sm font-semibold transition-all duration-200 border",
                    selectedQuick === val
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-secondary/50 text-foreground border-border hover:border-primary/40 hover:bg-secondary",
                    submitting && "opacity-50 pointer-events-none"
                  )}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Fee Breakdown */}
          {parsedAmount > 0 && (
          <div className="card-inner-panel p-4 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground/80">Top-up amount</span>
                <span className="text-foreground font-medium">GH₵ {parsedAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground/80">Processing fee (2%)</span>
                <span className="text-foreground font-medium">GH₵ {fee.toFixed(2)}</span>
              </div>
              <div className="card-divider pt-2.5 flex justify-between text-sm font-bold">
                <span className="text-foreground">Total charge</span>
                <span className="text-primary text-base">GH₵ {totalCharge.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="space-y-2">
            {paystackFailed ? (
              <div className="space-y-2">
                <p className="text-center text-sm text-destructive font-medium">
                  Payment gateway could not be loaded. This may be due to your network or browser settings.
                </p>
                <Button
                  type="button"
                  onClick={handleRetryPaystack}
                  className="w-full h-12 gap-2 text-base font-semibold rounded-xl"
                  variant="outline"
                >
                  <RefreshCw className="w-5 h-5" />
                  Retry Loading Payment
                </Button>
              </div>
            ) : (
              <Button
                type="submit"
                disabled={submitting || !paystackLoaded}
                className="w-full h-12 gradient-primary text-primary-foreground border-0 gap-2 text-base font-semibold rounded-xl"
              >
                {submitting ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Redirecting to Paystack...</>
                ) : !paystackLoaded ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Loading payment gateway...</>
                ) : (
                  <><ArrowRight className="w-5 h-5" /> Fund Wallet</>
                )}
              </Button>
            )}
            <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              Secure payment powered by Paystack
            </p>
          </div>
        </form>

      </div>
    </CustomerLayout>
  );
}
