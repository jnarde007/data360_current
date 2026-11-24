import { MtnVerifyBadge } from '@/components/MtnVerifyBadge';
import { BundleTile } from '@/components/BundleTile';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getNetworkAccent, formatPhoneSpaced } from '@/lib/network-colors';
import { formatGHS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { usePaystack, PAYSTACK_FEE_RATE, DEFAULT_PAYSTACK_EMAIL, buildBuyerPaystackEmail } from '@/hooks/use-paystack';
import {
  ShoppingCart, Loader2, Wifi, Phone, Package, Info, ChevronDown,
  CreditCard, RefreshCw, AlertTriangle, ArrowRight, Sun, Moon,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTheme } from '@/contexts/ThemeContext';
import mtnLogo from '@/assets/mtn-logo.png';
import atLogo from '@/assets/at-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';
import logo from '@/assets/logo.png';
import { checkRecipientAvailability, formatBlockedMessage } from '@/lib/recipient-availability';
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';
import {
  GuestPaymentRecoveryBanner,
  setGuestPendingPayment,
  clearGuestPendingPayment,
} from '@/components/GuestPaymentRecoveryBanner';
import { ShieldCheck } from 'lucide-react';

const NETWORK_PREFIXES: Record<string, string> = {
  '024': 'MTN', '025': 'MTN', '053': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN',
  '026': 'AirtelTigo', '027': 'AirtelTigo', '056': 'AirtelTigo', '057': 'AirtelTigo',
  '020': 'Telecel', '050': 'Telecel',
};

function detectNetworkFromPhone(phone: string): string | null {
  const prefix = phone.replace(/\s+/g, '').substring(0, 3);
  return NETWORK_PREFIXES[prefix] || null;
}

interface PriceItem {
  id: string;
  network: string;
  product: string;
  size: string;
  price: number;
}

const networkLogos: Record<string, string> = { MTN: mtnLogo, AirtelTigo: atLogo, Telecel: telecelLogo };
const fmtSize = (s: string) => { const up = s.toUpperCase(); return /GB/.test(up) ? up : `${up}GB`; };

export default function GuestBuyPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const { paystackReady, paystackFailed, retryLoad, openPaystack } = usePaystack();

  // Affiliate attribution — persist from URL
  const affiliateCode = useMemo(() => {
    const fromUrl = searchParams.get('ref') || searchParams.get('affiliate') || '';
    if (fromUrl) {
      try { sessionStorage.setItem('guest_affiliate', fromUrl); } catch {}
    }
    try { return fromUrl || sessionStorage.getItem('guest_affiliate') || ''; } catch { return fromUrl; }
  }, [searchParams]);

  // Price loading
  const [mtnReady, setMtnReady] = useState(true);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [networkAvailability, setNetworkAvailability] = useState<Record<string, boolean>>({});

  const fetchPrices = useCallback(async () => {
    try {
      const { data: networkConfigs } = await supabase
        .from('available_networks' as any)
        .select('network, available_for_purchase');
      const availMap: Record<string, boolean> = {};
      ((networkConfigs as any[]) || []).forEach((c: any) => {
        availMap[c.network] = c.available_for_purchase === true;
      });
      setNetworkAvailability(availMap);

      const { data, error } = await supabase
        .from('public_price_items' as any)
        .select('id, network, product, size, price')
        .eq('product', 'Data')
        .order('network')
        .order('price');
      if (error) throw error;
      setPriceItems(
        ((data as any[]) || [])
          .filter((d: any) => d.network in availMap)
          .map((d: any) => ({ ...d, price: Number(d.price) }))
      );
    } catch {
      toast({ title: 'Unable to load bundles', description: 'Please refresh.', variant: 'destructive' });
    } finally {
      setLoadingPrices(false);
    }
  }, [toast]);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);

  const availableNetworks = useMemo(() => {
    return Array.from(new Set(priceItems.map(p => p.network))).sort();
  }, [priceItems]);

  // Form state
  const [selectedNetwork, setSelectedNetwork] = useState('');
  const [selectedBundle, setSelectedBundle] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  // Fallback destination if a refund can't be returned to the original payment method
  const [refundMomoNumber, setRefundMomoNumber] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 'opening' = pre-popup, 'verifying' = post-success callback finalization
  const [submitPhase, setSubmitPhase] = useState<'opening' | 'verifying'>('opening');
  const [verifyIssue, setVerifyIssue] = useState<{ reference: string; message: string } | null>(null);
  const [mtnNoticeOpen, setMtnNoticeOpen] = useState(false);
  const [showAllBundles, setShowAllBundles] = useState(false);
  

  // Pre-select network from URL params
  useEffect(() => {
    if (availableNetworks.length === 0) return;
    const urlNetwork = searchParams.get('network');
    if (urlNetwork && availableNetworks.includes(urlNetwork) && !selectedNetwork) {
      setSelectedNetwork(urlNetwork);
    } else if (!selectedNetwork) {
      setSelectedNetwork(availableNetworks.find(n => n.toUpperCase() === 'MTN') || availableNetworks[0]);
    }
  }, [availableNetworks, selectedNetwork, searchParams]);

  // Pre-select bundle from URL params after prices + network are ready
  useEffect(() => {
    const urlBundle = searchParams.get('bundle');
    if (!urlBundle || selectedBundle) return;
    const match = priceItems.find(
      p => p.network === selectedNetwork && p.size.toLowerCase() === urlBundle.toLowerCase()
    );
    if (match) setSelectedBundle(match.id);
  }, [priceItems, selectedNetwork, searchParams, selectedBundle]);

  useEffect(() => {
    if (selectedNetwork && !priceItems.some(p => p.network === selectedNetwork)) {
      setSelectedNetwork(availableNetworks[0] || '');
      setSelectedBundle('');
    }
    if (selectedBundle && !priceItems.some(p => p.id === selectedBundle)) {
      setSelectedBundle('');
    }
  }, [priceItems, selectedNetwork, selectedBundle, availableNetworks]);

  const availableBundles = useMemo(() =>
    priceItems.filter(p => p.network === selectedNetwork),
    [priceItems, selectedNetwork]
  );

  const selectedBundleData = priceItems.find(p => p.id === selectedBundle);
  const totalAmount = selectedBundleData?.price || 0;
  const paystackFee = Math.round(totalAmount * PAYSTACK_FEE_RATE * 100) / 100;
  const paystackTotal = Math.round((totalAmount + paystackFee) * 100) / 100;

  const networkWarning = useMemo(() => {
    if (recipientPhone.length < 3) return null;
    const detected = detectNetworkFromPhone(recipientPhone);
    return detected && detected !== selectedNetwork
      ? `This looks like a ${detected} number, but you selected ${selectedNetwork}.`
      : null;
  }, [recipientPhone, selectedNetwork]);

  const networkAvailable = !selectedNetwork || networkAvailability[selectedNetwork] !== false;
  const canCheckout = selectedBundle && isValidPhone(recipientPhone) && isValidPhone(buyerPhone) && networkAvailable;

  const handleCheckout = () => {
    if (!selectedBundle) { toast({ title: 'Bundle required', description: 'Please select a data bundle.', variant: 'destructive' }); return; }
    if (selectedNetwork && networkAvailability[selectedNetwork] === false) {
      toast({
        title: `${selectedNetwork} delivery is currently halted`,
        description: 'Delivery is currently halted due to network issues. All pending orders will be delivered once service is restored.',
        variant: 'warning',
      });
      return;
    }
    if (!isValidPhone(recipientPhone)) { toast({ title: 'Invalid recipient number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' }); return; }
    if (!isValidPhone(buyerPhone)) { toast({ title: 'Invalid contact number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' }); return; }
    setShowConfirm(true);
  };

  const confirmPaystackCheckout = async () => {
    if (!paystackReady || !selectedBundleData) return;
    setShowConfirm(false);
    setSubmitPhase('opening');
    setSubmitting(true);
    setVerifyIssue(null);

    // Authoritative pre-flight: never open Paystack if recipient already has an active order.
    try {
      const avail = await checkRecipientAvailability([
        { network: selectedNetwork, phone: recipientPhone },
      ]);
      if (avail.blocked) {
        setSubmitting(false);
        setSubmitting(false);
        toast({
          title: 'Payment blocked — active order exists',
          description: formatBlockedMessage(avail.blocked_items),
          variant: 'warning',
        });
        return;
      }
    } catch (e) {
      console.error('[GuestBuy] availability check failed:', e);
    }


    try {
      // Call guest-checkout edge function to create payment_attempt and get Paystack config
      const res = await supabase.functions.invoke('guest-checkout', {
        body: {
          network: selectedNetwork,
          items: [{
            phone: recipientPhone.replace(/\s+/g, ''),
            bundleLabel: selectedBundleData.size,
            price: selectedBundleData.price,
          }],
          buyer_phone: buyerPhone.replace(/\s+/g, ''),
          buyer_email: buildBuyerPaystackEmail(buyerPhone),
          refund_momo_number: (refundMomoNumber || buyerPhone).replace(/\s+/g, ''),
          affiliate_code: affiliateCode,
        },
      });

      if (res.error) throw new Error(res.error.message || 'Checkout failed');
      const checkout = res.data as any;
      if (checkout?.error) throw new Error(checkout.error);

      const { reference, email: paystackEmail } = checkout;

      // Persist a lightweight recovery context for in-page recovery
      setGuestPendingPayment({
        reference,
        amount: checkout.paystack_total,
        buyer_phone: buyerPhone.replace(/\s+/g, ''),
        network: selectedNetwork,
        bundle: selectedBundleData.size,
        recipient: recipientPhone.replace(/\s+/g, ''),
        created_at: Date.now(),
      });

      // Open Paystack popup
      openPaystack({
        email: paystackEmail || buildBuyerPaystackEmail(buyerPhone),
        amountGHS: checkout.paystack_total,
        reference,
        metadata: {
          type: 'data_direct',
          buyer_type: 'guest',
          buyer_phone: buyerPhone,
          affiliate_code: affiliateCode,
        },
        onSuccess: async (ref: string) => {
          setSubmitPhase('verifying');
          setSubmitting(true);
          try {
            const finalRes = await supabase.functions.invoke('guest-finalize', {
              body: {
                reference: ref,
                buyer_phone: buyerPhone.replace(/\s+/g, ''),
                expected_amount: checkout.paystack_total,
              },
            });
            const result = finalRes.data as any;
            if (finalRes.error) throw new Error(finalRes.error.message);
            if (result?.error) throw new Error(result.error);

            // Success — clear recovery context and navigate to success page
            clearGuestPendingPayment();
            const trackingToken = result?.tracking_token || result?.orders?.[0]?.tracking_token || '';
            const successParams = new URLSearchParams();
            if (trackingToken) successParams.set('token', trackingToken);
            successParams.set('ref', ref);
            successParams.set('network', selectedNetwork);
            successParams.set('bundle', selectedBundleData.size);
            successParams.set('phone', recipientPhone);
            successParams.set('amount', String(totalAmount));
            if (result?.short_id) successParams.set('short_id', result.short_id);
            if (result?.orders) {
              successParams.set('orders', JSON.stringify(result.orders));
            }
            if (result?.grace_period_ends_at) successParams.set('grace_ends', result.grace_period_ends_at);
            if (result?.partial_failure) successParams.set('partial', '1');

            navigate(`/guest/success?${successParams.toString()}`);
          } catch (e: any) {
            // Don't redirect away — keep form intact and show inline recovery surface
            setVerifyIssue({
              reference: ref,
              message: e?.message || 'Verification is taking longer than expected.',
            });
            setSubmitting(false);
          }
        },
        onCancel: () => {
          setSubmitting(false);
          // Mark the attempt as abandoned so it doesn't sit in pending queue.
          // Fire-and-forget; never block the UI on this.
          supabase.functions.invoke('guest-cancel', { body: { reference } }).catch(() => {});
          clearGuestPendingPayment();
          toast({ title: 'Payment cancelled', description: 'No charges were made. You can try again whenever you\'re ready.', variant: 'warning' });
        },
      });
    } catch (e: any) {
      toast({ title: 'Checkout failed', description: e.message || 'Please try again.', variant: 'destructive' });
      setSubmitting(false);
    }
  };

  // Loading state
  if (loadingPrices) {
    return (
      <GuestShell theme={theme} toggleTheme={toggleTheme}>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </GuestShell>
    );
  }

  // Submitting state — split into "opening" (pre-popup) and "verifying" (post-success)
  if (submitting) {
    const isVerifying = submitPhase === 'verifying';
    return (
      <GuestShell theme={theme} toggleTheme={toggleTheme}>
        <div className="flex flex-col items-center justify-center py-20 space-y-5 animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-display font-bold text-foreground">
              {isVerifying ? 'Verifying your payment…' : 'Opening secure payment…'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isVerifying ? 'Please wait while we confirm your order.' : 'Paystack will open in a moment.'}
            </p>
          </div>
        </div>
      </GuestShell>
    );
  }

  return (
    <GuestShell theme={theme} toggleTheme={toggleTheme} affiliateCode={affiliateCode}>
      <div className="max-w-lg mx-auto space-y-4 pb-12">

        {/* In-page guest payment recovery (auto-detects in-flight references) */}
        <GuestPaymentRecoveryBanner />

        {/* Inline verify-issue panel — shown when finalize takes longer than expected */}
        {verifyIssue && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Confirmation is taking longer than expected</p>
                <p className="text-xs text-muted-foreground">
                  Your payment may have gone through, but we haven't confirmed it yet. You can check the status now or track this order.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={async () => {
                  setSubmitPhase('verifying');
                  setSubmitting(true);
                  try {
                    const finalRes = await supabase.functions.invoke('guest-finalize', {
                      body: { reference: verifyIssue.reference, buyer_phone: buyerPhone.replace(/\s+/g, '') },
                    });
                    const result = finalRes.data as any;
                    if (finalRes.error) throw new Error(finalRes.error.message);
                    if (result?.error) throw new Error(result.error);
                    if (result?.success || result?.already_processed || result?.orders?.length) {
                      clearGuestPendingPayment();
                      const trackingToken = result?.tracking_token || result?.orders?.[0]?.tracking_token || '';
                      const successParams = new URLSearchParams();
                      if (trackingToken) successParams.set('token', trackingToken);
                      successParams.set('ref', verifyIssue.reference);
                      successParams.set('network', selectedNetwork);
                      if (selectedBundleData) successParams.set('bundle', selectedBundleData.size);
                      successParams.set('phone', recipientPhone);
                      successParams.set('amount', String(totalAmount));
                      if (result?.short_id) successParams.set('short_id', result.short_id);
                      if (result?.orders) successParams.set('orders', JSON.stringify(result.orders));
                      if (result?.grace_period_ends_at) successParams.set('grace_ends', result.grace_period_ends_at);
                      if (result?.partial_failure) successParams.set('partial', '1');
                      navigate(`/guest/success?${successParams.toString()}`);
                    } else {
                      toast({ title: 'Still verifying', description: 'Please try again in a moment or use the tracking page.', variant: 'warning' });
                      setSubmitting(false);
                    }
                  } catch (e: any) {
                    toast({ title: 'Verification issue', description: e?.message || 'Please try again.', variant: 'warning' });
                    setSubmitting(false);
                  }
                }}
              >
                <RefreshCw className="w-3 h-3" /> Check payment status
              </Button>
              <Link to={`/guest/track?ref=${verifyIssue.reference}`}>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                  <ArrowRight className="w-3 h-3" /> Track this order
                </Button>
              </Link>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setVerifyIssue(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <Card className="overflow-hidden rounded-[20px] border-border/60 shadow-xl shadow-foreground/[0.05]">
          {/* Network-branded header strip */}
          {selectedNetwork && (() => {
            const accent = getNetworkAccent(selectedNetwork);
            return (
              <>
            <div className={getNetworkAccent(selectedNetwork).topBar} />
            <div className={`flex items-center gap-3 px-5 sm:px-6 py-4 ${accent.headerGlow} border-b ${accent.headerBorder}`}>
                {networkLogos[selectedNetwork] && (
                  <div className={`w-11 h-11 rounded-xl ${accent.iconBg} flex items-center justify-center shrink-0`}>
                    <img src={networkLogos[selectedNetwork]} alt={selectedNetwork} className="w-7 h-7 rounded-lg object-cover" />
                  </div>
                )}
                <div>
                  <h1 className="text-lg font-display font-bold text-foreground tracking-tight">{selectedNetwork} Data Bundle</h1>
                  <p className="text-xs text-muted-foreground">No account needed — pay instantly with Paystack</p>
                </div>
              </div>
              </>
            );
          })()}

          <div className="p-5 sm:p-6 space-y-5">
          {/* Step 1: Network */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${selectedNetwork ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>1</span>
              <span className="text-sm font-medium text-foreground">Select Network</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {availableNetworks.map(n => {
                const accent = getNetworkAccent(n);
                return (
                <button
                  key={n}
                  onClick={() => { setSelectedNetwork(n); setSelectedBundle(''); }}
                  className={`relative flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 px-2 py-2.5 rounded-xl border text-xs sm:text-sm font-medium min-w-0 transition-all duration-200 cursor-pointer ${
                    selectedNetwork === n
                      ? accent.tabActive
                      : `border-border bg-card text-muted-foreground ${accent.tabHover}`
                  }`}
                >
                  {networkLogos[n] && <img src={networkLogos[n]} alt={n} className="w-5 h-5 rounded-full object-cover" />}
                  {n}
                </button>
                );
              })}
            </div>

            {selectedNetwork && networkAvailability[selectedNetwork] === false && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-3.5 flex items-start gap-2.5" role="alert">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                    {selectedNetwork} delivery is currently halted
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Delivery is currently halted due to network issues. New purchases are paused and any pending orders will be delivered automatically once service is restored.
                  </p>
                </div>
              </div>
            )}

            {selectedNetwork === 'MTN' && (
              <div className="rounded-[20px] border border-amber-400/40 bg-gradient-to-br from-amber-50 to-yellow-50/60 dark:from-amber-500/10 dark:to-yellow-500/5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setMtnNoticeOpen(o => !o)}
                  className="flex items-center justify-between w-full px-3.5 py-2.5 text-left gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/15 shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300 block">Before you buy MTN data</span>
                      <span className="text-[10.5px] text-muted-foreground leading-snug block mt-0.5">
                        Some MTN SIM types can't receive data. Tap to see which.
                      </span>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-amber-600 shrink-0 transition-transform duration-200 ${mtnNoticeOpen ? 'rotate-180' : ''}`} />
                </button>
                <div className={`grid transition-all duration-200 ${mtnNoticeOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="px-3.5 pb-3 pt-2 border-t border-amber-400/25 ml-[2.875rem]">
                      <p className="text-[11px] text-muted-foreground mb-1.5">
                        MTN UP2U data <span className="font-semibold text-foreground">does not work</span> on:
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {['Agent SIM', 'Merchant SIM', 'EVD SIM', 'Turbonet SIM', 'Broadband SIM', 'Blacklisted SIM'].map(item => (
                          <span key={item} className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />{item}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Numbers with outstanding MTN airtime or data debt may not receive the bundle. Delivery is not guaranteed in such cases.
                      </p>
                      <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mt-1.5">
                        No refund will be issued for orders placed on incompatible SIM types.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Step 2: Recipient phone */}
          {selectedNetwork && availableBundles.length > 0 && (
            <>
              <section className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${selectedNetwork ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>2</span>
                  <span className="text-sm font-medium text-foreground">Recipient phone</span>
                  <span className="text-[11px] text-muted-foreground">— Where the order goes</span>
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="0241234567"
                    value={recipientPhone}
                    onChange={e => setRecipientPhone(normalizePhone(e.target.value))}
                    className="pl-9"
                    type="tel"
                    inputMode="numeric"
                   
                  />
                </div>
                {networkWarning && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive">{networkWarning}</p>
                  </div>
                )}
                {!networkWarning && <MtnVerifyBadge phone={recipientPhone} network={selectedNetwork} onReadyChange={setMtnReady} />}
              </section>

              {/* Step 3: Bundle */}
              <section className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${selectedNetwork ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>3</span>
                  <span className="text-sm font-medium text-foreground">Select Bundle</span>
                </div>
                <div role="radiogroup" aria-label="Bundle size" className="grid grid-cols-3 gap-2">
                  {(showAllBundles ? availableBundles : availableBundles.slice(0, 6)).map(b => {
                    return (
                      <BundleTile key={b.id} network={selectedNetwork} size={fmtSize(b.size)} price={formatGHS(b.price)}
                        active={selectedBundle === b.id} onClick={() => setSelectedBundle(b.id)} />
                    );
                  })}
                </div>
                  {availableBundles.length > 6 && (
                    <button type="button" onClick={() => setShowAllBundles(v => !v)}
                      className="w-full flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground py-1.5">
                      {showAllBundles ? 'Show fewer bundles' : `Show all ${availableBundles.length} bundles`}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllBundles ? 'rotate-180' : ''}`} />
                    </button>
                  )}
              </section>

              {/* Step 4: Buyer contact */}
              <section className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${selectedNetwork ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>4</span>
                  <span className="text-sm font-medium text-foreground">Your phone</span>
                  <span className="text-[11px] text-muted-foreground">— Where we send your tracking updates</span>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="0201234567"
                      value={buyerPhone}
                      onChange={e => setBuyerPhone(normalizePhone(e.target.value))}
                      className="pl-9"
                      type="tel"
                      inputMode="numeric"
                     
                    />
                  </div>
                </div>
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="refund-momo" className="text-[11.5px] text-muted-foreground font-normal">
                    Refund Mobile Money number <span className="opacity-70">(optional)</span>
                  </Label>
                  <div className="relative">
                    <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="refund-momo"
                      placeholder={buyerPhone || '0201234567'}
                      value={refundMomoNumber}
                      onChange={e => setRefundMomoNumber(normalizePhone(e.target.value))}
                      className="pl-9"
                      type="tel"
                      inputMode="numeric"
                    />
                  </div>
                  <p className="text-[10.5px] text-muted-foreground leading-snug">
                    Used only if a refund can't be returned to your payment method. Defaults to the number above.
                  </p>
                </div>
              </section>

              {/* Price summary */}
              {totalAmount > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-3">
                  <span>Subtotal: <span className="font-medium text-foreground">{formatGHS(totalAmount)}</span></span>
                </div>
              )}

              {/* Primary CTA — network colored */}
              <Button
                onClick={handleCheckout}
                disabled={!canCheckout || !mtnReady}
                className={`w-full h-[52px] text-[15px] font-bold tracking-wide border-0 rounded-xl transition-all duration-200 ease-in-out gap-2.5 !bg-none !bg-emerald-600 hover:!bg-emerald-700 text-white hover:text-white shadow-none`}
              >
                <CreditCard className="w-4.5 h-4.5" /> Pay with Paystack
              </Button>

              {/* Trust / reassurance line */}
              <div className="flex flex-col items-center gap-1 pt-1">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="w-3.5 h-3.5 text-success" />
                  <span>Secure payment via Paystack</span>
                </div>
                <p className="text-[10.5px] text-muted-foreground text-center leading-snug">
                  You're only charged for successful payments. If something goes wrong, you can safely try again.
                </p>
              </div>
            </>
          )}

          {selectedNetwork && availableBundles.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-5 text-center">
              <Package className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No bundles available for {selectedNetwork} at the moment.</p>
            </div>
          )}
          </div>
        </Card>

        {/* Already have an account? */}
        <div className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/auth" className="text-primary font-medium hover:underline">Log in</Link>
          {' '}for wallet purchases & order history.
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="sm:max-w-md overflow-hidden rounded-[22px]">
          <AlertDialogHeader>
            <div className="-mx-6 -mt-6">
              <div className={getNetworkAccent(selectedNetwork).topBar} />
              <div className={`flex items-center gap-3 px-6 py-4 text-left border-b ${getNetworkAccent(selectedNetwork).headerGlow} ${getNetworkAccent(selectedNetwork).headerBorder}`}>
                {networkLogos[selectedNetwork] && (
                  <div className={`w-11 h-11 rounded-xl ${getNetworkAccent(selectedNetwork).iconBg} flex items-center justify-center shrink-0`}>
                    <img src={networkLogos[selectedNetwork]} alt={selectedNetwork} className="w-7 h-7 rounded-lg object-cover" />
                  </div>
                )}
                <div className="min-w-0">
                  <AlertDialogTitle className="text-lg font-bold leading-tight">Confirm Your Order</AlertDialogTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedNetwork} Data Bundle</p>
                </div>
              </div>
            </div>
            <AlertDialogDescription asChild>
              <div className="space-y-5 pt-2">

                <div className={`rounded-2xl border overflow-hidden ${getNetworkAccent(selectedNetwork).summaryBox}`}>
                  <div className={`px-4 py-2.5 border-b ${getNetworkAccent(selectedNetwork).summaryHead}`}>
                    <span className="text-xs font-semibold uppercase tracking-wider">Order Summary</span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Bundle</span>
                      <span className="text-sm font-medium text-foreground">{fmtSize(selectedBundleData?.size || '')}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Recipient</span>
                      <span className="text-sm font-semibold font-mono tracking-wide text-foreground">{formatPhoneSpaced(recipientPhone)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Your Phone</span>
                      <span className="text-sm font-medium font-mono tracking-wide text-foreground">{formatPhoneSpaced(buyerPhone)}</span>
                    </div>
                    <div className="border-t border-border/60 pt-3">
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm font-semibold text-foreground">Total</span>
                        <span className={`text-xl font-bold ${getNetworkAccent(selectedNetwork).totalText}`}>{formatGHS(paystackTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {networkWarning && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive">{networkWarning}</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-2 flex-col gap-2 sm:flex-col">
            {paystackFailed ? (
              <Button variant="outline" onClick={retryLoad} className="w-full h-11 gap-2" type="button">
                <RefreshCw className="w-4 h-4" /> Retry Payment Gateway
              </Button>
            ) : (
              <AlertDialogAction
                onClick={confirmPaystackCheckout}
                disabled={!paystackReady}
                className="w-full h-auto py-2.5 !bg-none !bg-emerald-600 hover:!bg-emerald-700 text-white hover:text-white border-0 shadow-none font-semibold gap-2 flex-col items-center"
              >
                {!paystackReady ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</span>
                ) : (
                  <>
                    <span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Pay {formatGHS(paystackTotal)}</span>
                  </>
                )}
              </AlertDialogAction>
            )}
            <AlertDialogCancel className="w-full mt-0.5">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GuestShell>
  );
}

/* Lightweight shell for guest pages — no sidebar, no auth required */
function GuestShell({ children, theme, toggleTheme, affiliateCode }: {
  children: React.ReactNode;
  theme: string;
  toggleTheme: () => void;
  affiliateCode?: string;
}) {
  return (
    <div className="min-h-screen premium-app-shell">
      <nav className="sticky top-0 z-50 premium-topbar border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="DATA360" className="w-8 h-8 rounded-xl object-cover" />
            <span className="font-display font-bold text-lg text-foreground">DATA360</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Link to="/guest/track">
              <Button variant="outline" size="sm" className="text-sm rounded-full border-border text-foreground hover:bg-info/10 hover:border-info/40 hover:text-info transition-colors">Track Order</Button>
            </Link>
            <Link to="/auth">
              <Button size="sm" className="text-sm bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm">Log In</Button>
            </Link>
          </div>
        </div>
      </nav>
      <main className="premium-page-content container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
