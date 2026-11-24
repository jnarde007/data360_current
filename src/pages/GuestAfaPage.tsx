import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { usePaystack, PAYSTACK_FEE_RATE, DEFAULT_PAYSTACK_EMAIL, buildBuyerPaystackEmail } from '@/hooks/use-paystack';
import { formatGHS } from '@/lib/utils';
import { Loader2, CreditCard, UserPlus, Phone, MapPin, User, AlertTriangle } from 'lucide-react';
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';
import GuestShell from '@/components/GuestShell';

export default function GuestAfaPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { paystackReady, paystackFailed, retryLoad, openPaystack } = usePaystack();

  // Affiliate persistence
  const affiliateCode = useMemo(() => {
    const fromUrl = searchParams.get('ref') || searchParams.get('affiliate') || '';
    if (fromUrl) { try { sessionStorage.setItem('guest_affiliate', fromUrl); } catch {} }
    try { return fromUrl || sessionStorage.getItem('guest_affiliate') || ''; } catch { return fromUrl; }
  }, [searchParams]);

  const [price, setPrice] = useState<number>(0);
  const [loadingPrice, setLoadingPrice] = useState(true);

  const [fullName, setFullName] = useState('');
  const [registrationPhone, setRegistrationPhone] = useState('');
  const [location, setLocation] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('public_price_items' as any)
        .select('price')
        .eq('product', 'AFA Registration')
        .eq('network', 'MTN')
        .limit(1)
        .maybeSingle();
      setPrice(Number((data as any)?.price || 0));
      setLoadingPrice(false);
    })();
  }, []);

  const fee = Math.round(price * PAYSTACK_FEE_RATE * 100) / 100;
  const total = Math.round((price + fee) * 100) / 100;

  const valid = fullName.trim().length >= 2
    && isValidPhone(registrationPhone)
    && location.trim().length >= 2
    && isValidPhone(buyerPhone);

  const handleCheckout = async () => {
    if (!valid) {
      toast({ title: 'Please fill all fields', description: 'Name, registration phone, location and your contact number are required.', variant: 'warning' });
      return;
    }
    if (price <= 0) {
      toast({ title: 'Service unavailable', description: 'AFA price not configured. Please try again later.', variant: 'destructive' });
      return;
    }

    const reference = `AFA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    setSubmitting(true);

    // Pre-create payment_attempt BEFORE opening Paystack — invariant: every
    // successful Paystack payment has a local payment_attempts row.
    try {
      await supabase.from('payment_attempts' as any).insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        paystack_reference: reference,
        attempt_type: 'afa',
        status: 'pending',
        amount: total,
        buyer_type: 'guest',
        buyer_phone: normalizePhone(buyerPhone),
        buyer_email: buildBuyerPaystackEmail(buyerPhone),
        affiliate_code: affiliateCode || '',
        metadata: {
          type: 'afa',
          buyer_type: 'guest',
          full_name: fullName.trim(),
          registration_phone: normalizePhone(registrationPhone),
          location: location.trim(),
          buyer_phone: normalizePhone(buyerPhone),
          affiliate_code: affiliateCode || '',
          paystack_total: total,
        },
        event_log: [{ type: 'checkout_initiated', channel: 'afa_guest', timestamp: new Date().toISOString() }],
      });
    } catch (e) {
      console.error('[GuestAfaPage] Failed to pre-create payment_attempt:', e);
    }

    openPaystack({
      email: buildBuyerPaystackEmail(buyerPhone),
      amountGHS: total,
      reference,
      metadata: { type: 'afa', buyer_type: 'guest', buyer_phone: buyerPhone, affiliate_code: affiliateCode },
      onSuccess: async (ref: string) => {
        try {
          const res = await supabase.functions.invoke('paystack-direct-afa', {
            body: {
              reference: ref,
              buyer_type: 'guest',
              full_name: fullName.trim(),
              registration_phone: normalizePhone(registrationPhone),
              location: location.trim(),
              buyer_phone: normalizePhone(buyerPhone),
              buyer_email: buildBuyerPaystackEmail(buyerPhone),
              affiliate_code: affiliateCode,
            },
          });
          if (res.error) throw new Error(res.error.message);
          const result = res.data as any;
          if (result?.error) throw new Error(result.error);
          const params = new URLSearchParams();
          params.set('kind', 'afa');
          params.set('short_id', result.short_id);
          if (result.tracking_token) params.set('token', result.tracking_token);
          navigate(`/guest/success?${params.toString()}`);
        } catch (e: any) {
          toast({ title: 'Verification issue', description: e.message || 'Please track your registration to confirm.', variant: 'warning' });
          setSubmitting(false);
        }
      },
      onCancel: () => {
        setSubmitting(false);
        toast({ title: 'Payment cancelled', description: 'No charges were made. You can try again.', variant: 'warning' });
      },
    });
  };

  if (loadingPrice) {
    return (
      <GuestShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </GuestShell>
    );
  }

  if (submitting) {
    return (
      <GuestShell>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Processing your registration…</p>
        </div>
      </GuestShell>
    );
  }

  return (
    <GuestShell>
      <div className="max-w-lg mx-auto space-y-4 pb-12">
        <Card className="overflow-hidden border-border/60 shadow-md">
          <div className="flex items-center gap-3 px-5 py-4 bg-yellow-500/10 border-b border-yellow-500/20">
            <div className="w-11 h-11 rounded-xl bg-yellow-500/20 text-yellow-600 dark:text-yellow-300 flex items-center justify-center shrink-0">
              <UserPlus className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-foreground tracking-tight">MTN AFA Registration</h1>
              <p className="text-xs text-muted-foreground">Register na kasa saaaa! · No account needed.</p>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs"><User className="w-3.5 h-3.5" /> Full Name</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="As registered on Ghana Card" maxLength={80} />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs"><Phone className="w-3.5 h-3.5" /> MTN Phone Number to Register</Label>
              <Input
                type="tel" inputMode="numeric"
                value={registrationPhone}
                onChange={e => setRegistrationPhone(normalizePhone(e.target.value))}
                placeholder="0241234567"
              />
              
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs"><MapPin className="w-3.5 h-3.5" /> Location</Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Accra, Kasoa" maxLength={80} />
            </div>

            <div className="border-t border-border/60 pt-4 space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs"><Phone className="w-3.5 h-3.5" /> Your Contact Number</Label>
              <Input
                type="tel" inputMode="numeric"
                value={buyerPhone}
                onChange={e => setBuyerPhone(normalizePhone(e.target.value))}
                placeholder="So we can reach you about this registration"
              />
            </div>

            <div className="rounded-xl bg-muted/50 border border-border/60 p-3.5 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Registration fee</span>
                <span className="font-medium text-foreground">{formatGHS(price)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Processing fee (2%)</span>
                <span className="font-medium text-foreground">{formatGHS(fee)}</span>
              </div>
              <div className="flex justify-between items-baseline border-t border-border/40 pt-2">
                <span className="text-sm font-semibold text-foreground">Total</span>
                <span className="text-lg font-bold text-primary">{formatGHS(total)}</span>
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

            <Button
              onClick={handleCheckout}
              disabled={!valid || !paystackReady || price <= 0}
              className="w-full h-12 bg-emerald-600 text-white hover:bg-emerald-700 font-semibold gap-2"
            >
              {!paystackReady ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Submit & Pay
            </Button>

            <p className="text-[11px] text-center text-muted-foreground">
              Already have an account?{' '}
              <Link to="/auth" className="text-primary hover:underline">Sign in</Link> to pay with your wallet.
            </p>
          </div>
        </Card>
      </div>
    </GuestShell>
  );
}
