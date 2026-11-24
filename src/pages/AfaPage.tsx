import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { usePaystack, PAYSTACK_FEE_RATE } from '@/hooks/use-paystack';
import { formatGHS } from '@/lib/utils';
import {
  Loader2, CreditCard, Wallet, UserPlus, Phone, MapPin, User, AlertTriangle,
  CheckCircle, History as HistoryIcon, Clock, PhoneCall,
} from 'lucide-react';
import { normalizePhone, isValidPhone } from '@/lib/validation';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';

interface AfaHistoryRow {
  id: string;
  short_id: string;
  full_name: string;
  registration_phone: string;
  total_amount: number;
  payment_method: string;
  payment_reference: string;
  status: string;
  admin_note: string;
  created_at: string;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  submitted:  { label: 'Submitted',  cls: 'bg-primary text-primary-foreground border-primary' },
  processing: { label: 'Processing', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30' },
  registered: { label: 'Registered', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30' },
  rejected:   { label: 'Rejected',   cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30' },
};

const paymentLabel = (m: string) =>
  m === 'wallet' ? 'Wallet' : m === 'paystack_direct' ? 'Paystack' : m;

const formatSubmittedAt = (value: string) => {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} • ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

export default function AfaPage() {
  const { toast } = useToast();
  const { user, refreshUser } = useAuth();
  const { paystackReady, paystackFailed, retryLoad, openPaystack } = usePaystack();

  const [price, setPrice] = useState<number>(0);
  const [loadingPrice, setLoadingPrice] = useState(true);

  const [fullName, setFullName] = useState('');
  const [registrationPhone, setRegistrationPhone] = useState('');
  const [location, setLocation] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [payMethod, setPayMethod] = useState<'wallet' | 'paystack' | null>(null);
  const [success, setSuccess] = useState<{ short_id: string } | null>(null);

  const [history, setHistory] = useState<AfaHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Load AFA price (size-agnostic — always pick latest MTN AFA Registration row)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('public_price_items' as any).select('price')
        .eq('product', 'AFA Registration').eq('network', 'MTN')
        .limit(1).maybeSingle();
      setPrice(Number((data as any)?.price || 0));
      setLoadingPrice(false);
    })();
  }, []);

  const loadHistory = useCallback(async () => {
    if (!user?.id) return;
    setLoadingHistory(true);
    const { data } = await supabase
      .from('afa_registrations')
      .select('id, short_id, full_name, registration_phone, total_amount, payment_method, payment_reference, status, admin_note, created_at')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false });
    setHistory((data || []) as AfaHistoryRow[]);
    setLoadingHistory(false);
  }, [user?.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useRealtimeRefresh(['afa_registrations' as any], loadHistory, 'afa-history-live');

  const fee = Math.round(price * PAYSTACK_FEE_RATE * 100) / 100;
  const paystackTotal = Math.round((price + fee) * 100) / 100;
  const walletBalance = Number(user?.wallet_balance || 0);
  const valid = fullName.trim().length >= 2 && isValidPhone(registrationPhone) && location.trim().length >= 2;

  const sendSubmittedSms = (shortId: string, registrationId: string) => {
    const buyerPhone = (user?.phone || '').replace(/[^0-9]/g, '');
    if (buyerPhone.length < 9) return;
    supabase.functions.invoke('send-sms', {
      body: {
        to: buyerPhone,
        message: `Your registration request has been received. Reference: ${shortId}. We will notify you once it is processed.`,
        event_type: 'afa_submitted',
        customer_id: user?.id,
        idempotency_key: `afa_submitted_${registrationId}`,
      },
    }).catch(() => {});
  };

  const submitWallet = async () => {
    if (!user?.id || !valid || submitting) return;
    if (walletBalance < price) {
      toast({ title: 'Insufficient wallet balance', description: `You need ${formatGHS(price)} but have ${formatGHS(walletBalance)}.`, variant: 'destructive' });
      return;
    }
    setPayMethod('wallet');
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('place_afa_wallet', {
        p_customer_id: user.id,
        p_full_name: fullName.trim(),
        p_registration_phone: normalizePhone(registrationPhone),
        p_location: location.trim(),
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.success) throw new Error(result?.error || 'Submission failed');
      await refreshUser();
      sendSubmittedSms(result.short_id, result.id);
      setSuccess({ short_id: result.short_id });
      loadHistory();
    } catch (e: any) {
      toast({ title: 'Submission failed', description: e.message, variant: 'destructive' });
      setPayMethod(null);
    } finally {
      setSubmitting(false);
    }
  };

  const submitPaystack = async () => {
    if (!user?.id || !valid || submitting) return;
    const reference = `AFA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    setPayMethod('paystack');
    setSubmitting(true);

    // Pre-create payment_attempt BEFORE opening Paystack so no successful
    // payment can ever exist without a local record (blind-sweep safety net).
    try {
      await supabase.from('payment_attempts' as any).insert({
        customer_id: user.id,
        paystack_reference: reference,
        attempt_type: 'afa',
        status: 'pending',
        amount: paystackTotal,
        buyer_type: 'registered',
        buyer_phone: normalizePhone(registrationPhone),
        buyer_email: user.email || '',
        metadata: {
          type: 'afa',
          buyer_type: 'registered',
          customer_id: user.id,
          full_name: fullName.trim(),
          registration_phone: normalizePhone(registrationPhone),
          location: location.trim(),
          paystack_total: paystackTotal,
        },
        event_log: [{ type: 'checkout_initiated', channel: 'afa_registered', timestamp: new Date().toISOString() }],
      });
    } catch (e) {
      console.error('[AfaPage] Failed to pre-create payment_attempt:', e);
    }
    openPaystack({
      email: user.email || 'user@data360.com',
      amountGHS: paystackTotal,
      reference,
      metadata: { type: 'afa', buyer_type: 'registered', customer_id: user.id },
      onSuccess: async (ref: string) => {
        try {
          const res = await supabase.functions.invoke('paystack-direct-afa', {
            body: {
              reference: ref,
              buyer_type: 'registered',
              customer_id: user.id,
              full_name: fullName.trim(),
              registration_phone: normalizePhone(registrationPhone),
              location: location.trim(),
            },
          });
          if (res.error) throw new Error(res.error.message);
          const result = res.data as any;
          if (result?.error) throw new Error(result.error);
          setSuccess({ short_id: result.short_id });
          loadHistory();
        } catch (e: any) {
          toast({ title: 'Verification issue', description: e.message, variant: 'warning' });
          setPayMethod(null);
        } finally {
          setSubmitting(false);
        }
      },
      onCancel: () => {
        setSubmitting(false);
        setPayMethod(null);
        toast({ title: 'Payment cancelled', description: 'No charges were made. You can try again.', variant: 'warning' });
      },
    });
  };

  const resetForm = () => {
    setSuccess(null);
    setPayMethod(null);
    setFullName('');
    setRegistrationPhone('');
    setLocation('');
  };

  return (
    <CustomerLayout>
      <div className="max-w-3xl lg:max-w-6xl mx-auto space-y-5 pb-24 lg:pb-0">
        {/* Header */}
        <Card className="overflow-hidden border-border/60 shadow-md">
          <div className="flex items-center gap-3 px-5 py-4 bg-yellow-500/10 border-b border-yellow-500/20">
            <div className="w-11 h-11 rounded-xl bg-yellow-500/20 text-yellow-600 dark:text-yellow-300 flex items-center justify-center shrink-0">
              <UserPlus className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-foreground tracking-tight">MTN AFA Registration</h1>
              <p className="text-xs text-muted-foreground">Register na kasa saaaa! Submit your details for AFA registration.</p>
            </div>
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        {/* Form */}
        {submitting && !success ? (
          <Card className="p-8 text-center space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
            <div>
              <h2 className="text-lg font-display font-bold">
                {payMethod === 'paystack' ? 'Opening secure Paystack checkout...' : 'Submitting AFA registration...'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {payMethod === 'paystack'
                  ? 'Please complete payment in the popup window.'
                  : 'Processing wallet payment. Please wait.'}
              </p>
            </div>
          </Card>
        ) : success ? (
          <Card className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle className="w-7 h-7 text-success" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold">AFA Registration Request Submitted</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Your AFA registration request has been received.
              </p>
              <p className="text-sm mt-2">
                Reference: <span className="font-mono font-semibold">{success.short_id}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">You will receive an SMS once it is processed.</p>
            </div>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button variant="outline" onClick={() => document.getElementById('afa-history')?.scrollIntoView({ behavior: 'smooth' })}>
                View AFA History
              </Button>
              <Button onClick={resetForm}>Register Another Number</Button>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="p-5 sm:p-6 space-y-4">
              {loadingPrice ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : price <= 0 ? (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">AFA price is not configured yet. Please try again later.</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs"><User className="w-3.5 h-3.5" /> Full Name</Label>
                    <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="As registered on Ghana Card" maxLength={80} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs"><Phone className="w-3.5 h-3.5" /> MTN Phone Number to Register</Label>
                    <Input type="tel" inputMode="numeric"
                      value={registrationPhone}
                      onChange={e => setRegistrationPhone(normalizePhone(e.target.value))}
                      placeholder="0241234567" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs"><MapPin className="w-3.5 h-3.5" /> Location</Label>
                    <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Accra, Kasoa" maxLength={80} />
                  </div>

                  <div className="rounded-xl bg-muted/50 border border-border/60 p-3.5">
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm text-muted-foreground">Registration fee</span>
                      <span className="text-base font-semibold">{formatGHS(price)}</span>
                    </div>
                  </div>

                  {paystackFailed && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs text-destructive">Payment gateway failed to load.</p>
                        <Button size="sm" variant="outline" onClick={retryLoad} className="mt-1.5 h-7 text-xs">Retry</Button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Button
                      onClick={submitWallet}
                      disabled={!valid || submitting || walletBalance < price || price <= 0}
                      className="h-12 bg-none bg-primary text-white hover:bg-primary/90 disabled:bg-primary/50 font-semibold flex flex-col gap-0 py-1.5 leading-tight"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <Wallet className="w-4 h-4" />
                        {walletBalance < price ? 'Insufficient balance' : 'Pay with Wallet'}
                      </span>
                      <span className="text-[11px] font-normal opacity-90">
                        {walletBalance < price
                          ? `Insufficient balance: ${formatGHS(walletBalance)}`
                          : `Balance: ${formatGHS(walletBalance)}`}
                      </span>
                    </Button>
                    <Button
                      onClick={submitPaystack}
                      disabled={!valid || submitting || !paystackReady || price <= 0}
                      variant="outline"
                      className="h-12 !bg-none !bg-emerald-600 hover:!bg-emerald-700 text-white hover:text-white border-0 shadow-none font-semibold flex flex-col gap-0 py-1.5 leading-tight"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        {!paystackReady ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                        Pay with Paystack
                      </span>
                      <span className="text-[11px] font-normal opacity-80">
                        Total: {formatGHS(paystackTotal)}
                      </span>
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        )}

        {/* History */}
        <section id="afa-history" className="space-y-3 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1">
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-display font-bold">My AFA Registrations</h2>
            <div className="flex-1 h-px bg-border/60" />
            <span className="text-xs text-muted-foreground">{history.length}</span>
          </div>

          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
              No AFA registrations yet. Submit one above to get started.
            </Card>
          ) : (
            <div className="space-y-3">
              {history.map(r => {
                const sb = STATUS_BADGE[r.status] || { label: r.status, cls: '' };
                return (
                  <Card key={r.id} className="p-4 border-border/70 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display font-semibold text-foreground truncate">{r.full_name}</p>
                        <p className="font-mono text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5"><PhoneCall className="w-3 h-3" />{r.registration_phone}</p>
                      </div>
                      <p className="font-display font-bold whitespace-nowrap">{formatGHS(Number(r.total_amount))}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/50">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className={sb.cls}>{sb.label}</Badge>
                        <span className="text-[11px] text-muted-foreground truncate">{formatSubmittedAt(r.created_at)}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{paymentLabel(r.payment_method)} · <span className="font-mono">{r.short_id}</span></span>
                    </div>
                    {r.admin_note && (
                      <div className="mt-3 rounded-xl px-3 py-2.5 bg-muted/40">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Registration Update</p>
                        <p className="text-xs text-foreground">{r.admin_note}</p>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
        </div>
      </div>
    </CustomerLayout>
  );
}
