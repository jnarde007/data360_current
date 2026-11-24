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
import { Loader2, CreditCard, GraduationCap, Phone, AlertTriangle, Plus, Minus } from 'lucide-react';
import { normalizePhone, isValidPhone } from '@/lib/validation';
import GuestShell from '@/components/GuestShell';

interface CheckerProduct {
  id: string;
  name: string;
  exam_type: string;
  price: number;
  status: string;
}

export default function GuestCheckerPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { paystackReady, paystackFailed, retryLoad, openPaystack } = usePaystack();

  const affiliateCode = useMemo(() => {
    const fromUrl = searchParams.get('ref') || searchParams.get('affiliate') || '';
    if (fromUrl) { try { sessionStorage.setItem('guest_affiliate', fromUrl); } catch {} }
    try { return fromUrl || sessionStorage.getItem('guest_affiliate') || ''; } catch { return fromUrl; }
  }, [searchParams]);

  const [products, setProducts] = useState<CheckerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [buyerPhone, setBuyerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('checker_products_public')
        .select('id, name, exam_type, price, status')
        .eq('status', 'active')
        .order('name');
      const list = (data || []) as CheckerProduct[];
      setProducts(list);
      if (list.length === 1) setSelectedId(list[0].id);
      setLoading(false);
    })();
  }, []);

  const selected = products.find(p => p.id === selectedId);
  const subtotal = (selected?.price || 0) * quantity;
  const fee = Math.round(subtotal * PAYSTACK_FEE_RATE * 100) / 100;
  const total = Math.round((subtotal + fee) * 100) / 100;

  const valid = !!selected && quantity >= 1 && quantity <= 50 && isValidPhone(buyerPhone);

  const handleCheckout = async () => {
    if (!valid) {
      toast({ title: 'Please complete the form', description: 'Select a product and provide a valid contact phone.', variant: 'warning' });
      return;
    }

    const reference = `CHK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    setSubmitting(true);

    // Pre-create payment_attempt BEFORE opening Paystack so blind-sweep can
    // recover the purchase even if the callback never fires.
    try {
      await supabase.from('payment_attempts' as any).insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        paystack_reference: reference,
        attempt_type: 'checker_direct',
        status: 'pending',
        amount: total,
        buyer_type: 'guest',
        buyer_phone: normalizePhone(buyerPhone),
        buyer_email: buildBuyerPaystackEmail(buyerPhone),
        affiliate_code: affiliateCode || '',
        metadata: {
          type: 'checker_guest',
          buyer_type: 'guest',
          product_id: selectedId,
          quantity,
          buyer_phone: normalizePhone(buyerPhone),
          affiliate_code: affiliateCode || '',
          paystack_total: total,
        },
        event_log: [{ type: 'checkout_initiated', channel: 'checker_guest', timestamp: new Date().toISOString() }],
      });
    } catch (e) {
      console.error('[GuestCheckerPage] Failed to pre-create payment_attempt:', e);
    }
    openPaystack({
      email: buildBuyerPaystackEmail(buyerPhone),
      amountGHS: total,
      reference,
      metadata: { type: 'checker_guest', buyer_phone: buyerPhone, affiliate_code: affiliateCode, product_id: selectedId, quantity },
      onSuccess: async (ref: string) => {
        try {
          const res = await supabase.functions.invoke('paystack-direct-guest-checker', {
            body: {
              reference: ref,
              product_id: selectedId,
              quantity,
              buyer_phone: normalizePhone(buyerPhone),
              buyer_email: buildBuyerPaystackEmail(buyerPhone),
              affiliate_code: affiliateCode,
            },
          });
          if (res.error) throw new Error(res.error.message);
          const result = res.data as any;
          if (result?.error) throw new Error(result.error);
          const params = new URLSearchParams();
          params.set('kind', 'checker');
          params.set('short_id', result.short_id);
          if (result.tracking_token) params.set('token', result.tracking_token);
          // pass codes through state via sessionStorage to avoid huge URLs
          try { sessionStorage.setItem(`checker_codes_${result.short_id}`, JSON.stringify(result.codes || [])); } catch {}
          navigate(`/guest/success?${params.toString()}`);
        } catch (e: any) {
          toast({ title: 'Verification issue', description: e.message, variant: 'warning' });
          setSubmitting(false);
        }
      },
      onCancel: () => {
        setSubmitting(false);
        toast({ title: 'Payment cancelled', description: 'No charges were made. You can try again.', variant: 'warning' });
      },
    });
  };

  if (loading) {
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
          <p className="text-sm text-muted-foreground">Processing your purchase…</p>
        </div>
      </GuestShell>
    );
  }

  return (
    <GuestShell>
      <div className="max-w-lg mx-auto space-y-4 pb-12">
        <Card className="overflow-hidden border-border/60 shadow-md">
          <div className="flex items-center gap-3 px-5 py-4 bg-cyan-500/10 border-b border-cyan-500/20">
            <div className="w-11 h-11 rounded-xl bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 flex items-center justify-center shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-foreground tracking-tight">Result Checker</h1>
              <p className="text-xs text-muted-foreground">BECE & WASSCE — pay instantly with Paystack.</p>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            {products.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No checker products available right now.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">Select Product</Label>
                  <div className="flex flex-col gap-2">
                    {products.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                          selectedId === p.id
                            ? 'border-cyan-500/60 bg-cyan-500/10'
                            : 'border-border bg-card hover:border-cyan-500/40'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-semibold text-foreground">{p.name}</div>
                          <div className="text-xs text-muted-foreground uppercase">{p.exam_type}</div>
                        </div>
                        <div className="text-sm font-bold text-foreground">{formatGHS(p.price)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Quantity</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="icon" variant="outline" onClick={() => setQuantity(q => Math.max(1, q - 1))} className="h-10 w-10">
                      <Minus className="w-4 h-4" />
                    </Button>
                    <Input
                      type="number" min={1} max={50}
                      value={quantity}
                      onChange={e => setQuantity(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                      className="text-center"
                    />
                    <Button type="button" size="icon" variant="outline" onClick={() => setQuantity(q => Math.min(50, q + 1))} className="h-10 w-10">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">1 to 50 per purchase.</p>
                </div>

                <div className="border-t border-border/60 pt-4 space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs"><Phone className="w-3.5 h-3.5" /> Your Contact Number</Label>
                  <Input type="tel" inputMode="numeric"
                    value={buyerPhone}
                    onChange={e => setBuyerPhone(normalizePhone(e.target.value))}
                    placeholder="0241234567" />
                </div>

                <div className="rounded-xl bg-muted/50 border border-border/60 p-3.5 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal ({quantity} × {formatGHS(selected?.price || 0)})</span>
                    <span className="font-medium">{formatGHS(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Processing fee (2%)</span>
                    <span className="font-medium">{formatGHS(fee)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-t border-border/40 pt-2">
                    <span className="text-sm font-semibold">Total</span>
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
                  disabled={!valid || !paystackReady}
                  className="w-full h-12 bg-emerald-600 text-white hover:bg-emerald-700 font-semibold gap-2"
                >
                  {!paystackReady ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  Pay {formatGHS(total)}
                </Button>

                <p className="text-[11px] text-center text-muted-foreground">
                  Already have an account?{' '}
                  <Link to="/auth" className="text-primary hover:underline">Sign in</Link> to pay with your wallet.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </GuestShell>
  );
}
