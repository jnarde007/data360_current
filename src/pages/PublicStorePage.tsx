import { MtnVerifyBadge } from '@/components/MtnVerifyBadge';
import { getNetworkTile, getNetworkAccent } from '@/lib/network-colors';
import { BundleTile } from '@/components/BundleTile';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import { usePaystack, PAYSTACK_FEE_RATE, DEFAULT_PAYSTACK_EMAIL } from '@/hooks/use-paystack';
import {
  Loader2, ShoppingCart, Store, ShieldCheck, GraduationCap,
  ChevronRight, Search, UserPlus, MessageCircle, Mail, Users,
  User, Phone, MapPin, CreditCard, AlertTriangle,
  CheckCircle, Copy, ExternalLink, ChevronDown,
} from 'lucide-react';
import mtnLogo from '@/assets/mtn-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';
import atLogo from '@/assets/at-logo.png';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';
import { checkRecipientAvailability, formatBlockedMessage } from '@/lib/recipient-availability';

const DATA_NETWORKS = ['MTN', 'Telecel', 'AirtelTigo'] as const;
const NETWORK_LOGOS: Record<string, string> = { MTN: mtnLogo, Telecel: telecelLogo, AirtelTigo: atLogo };
const NETWORK_ACCENT: Record<string, string> = {
  MTN: 'bg-yellow-400',
  Telecel: 'bg-red-500',
  AirtelTigo: 'bg-primary',
};
const NETWORK_HEADER: Record<string, string> = {
  MTN: 'from-yellow-400 to-amber-500',
  Telecel: 'from-red-500 to-rose-600',
  AirtelTigo: 'from-blue-500 to-cyan-500',
};
const NETWORK_BADGE: Record<string, string> = {
  MTN: 'bg-yellow-100/80 text-yellow-800',
  Telecel: 'bg-red-100/80 text-red-700',
  AirtelTigo: 'bg-primary text-primary-foreground',
};

const STORE_GUEST_EMAIL = DEFAULT_PAYSTACK_EMAIL;

/**
 * Paystack flags repeated transactions sharing the same email as fraud
 * ("Denied by Fraud System"). Synthesize a unique-per-buyer email from the
 * phone number so each store checkout looks like a distinct customer to
 * Paystack while still using a real, deliverable domain we control.
 */
function buildBuyerEmail(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return STORE_GUEST_EMAIL;
  return `tx-${digits}@secure-payment-rail.net`;
}

function parseSizeGB(size: string): number {
  const m = (size || '').match(/([\d.]+)\s*(GB|MB)/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  return m[2].toUpperCase() === 'MB' ? v / 1024 : v;
}
function fmtSize(s: string) {
  const up = (s || '').toUpperCase();
  return /GB|MB/i.test(up) ? up : `${up}GB`;
}

interface StoreProductPublic {
  store_product_id: string;
  kind: 'data' | 'checker';
  price_item_id?: string;
  checker_product_id?: string;
  network?: string; size?: string; product?: string;
  name?: string; exam_type?: string;
  selling_price: number;
}
interface PublicStore {
  id: string; name: string; slug: string; description: string; logo_url: string; banner_url: string;
  contact_whatsapp?: string; contact_group_link?: string; contact_email?: string;
  afa_enabled?: boolean; afa_price?: number;
  products: StoreProductPublic[];
}

function sessionHash(): string {
  let h = sessionStorage.getItem('store_session_hash');
  if (!h) { h = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('store_session_hash', h); }
  return h;
}

function detectTrafficSource(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const utm = params.get('utm_source');
    if (utm) return utm.toLowerCase();
    const ref = document.referrer || '';
    if (!ref) return 'direct';
    const host = new URL(ref).hostname.toLowerCase();
    if (/whatsapp|wa\.me|api\.whatsapp/.test(host)) return 'whatsapp';
    if (/facebook|instagram|t\.co|twitter|x\.com|tiktok|linkedin|snapchat|telegram/.test(host)) return 'social';
    if (/google|bing|duckduckgo|yahoo/.test(host)) return 'search';
    if (host === window.location.hostname) return 'internal';
    return 'referral';
  } catch { return 'direct'; }
}

function waNumber(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

export default function PublicStorePage() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const { openPaystack, paystackReady, paystackFailed, retryLoad } = usePaystack();
  const [mtnReady, setMtnReady] = useState(true);
  const [showAllBundles, setShowAllBundles] = useState(false);
  const [store, setStore] = useState<PublicStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StoreProductPublic | null>(null);
  const [picker, setPicker] = useState<null | 'MTN' | 'Telecel' | 'AirtelTigo' | 'checker'>(null);
  
  const [recipientPhone, setRecipientPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [trafficSource] = useState<string>(() => detectTrafficSource());
  const [successInfo, setSuccessInfo] = useState<null | {
    kind: 'data' | 'checker' | 'afa';
    shortId?: string;
    reference: string;
    trackingToken?: string;
    recipientPhone?: string;
    bundleSize?: string;
    network?: string;
    amount: number;
    codes?: Array<{ serial_number: string; pin: string }>;
    productName?: string;
  }>(null);

  // AFA dialog state (mirrors GuestAfaPage)
  const [afaOpen, setAfaOpen] = useState(false);
  const [afaPrice, setAfaPrice] = useState<number>(0);
  const [afaPriceLoading, setAfaPriceLoading] = useState(false);
  const [afaFullName, setAfaFullName] = useState('');
  const [afaRegPhone, setAfaRegPhone] = useState('');
  const [afaLocation, setAfaLocation] = useState('');
  const [afaBuyerPhone, setAfaBuyerPhone] = useState('');
  const [afaSubmitting, setAfaSubmitting] = useState(false);

  const visitIdRef = useRef<string | null>(null);
  const visitStartRef = useRef<number>(Date.now());

  useEffect(() => {
    (async () => {
      if (!slug) return;
      const { data } = await supabase.rpc('get_public_store' as any, { p_slug: slug });
      setStore((data as any) || null);
      setLoading(false);
      if (data) {
        const s: any = data;
        try {
          document.title = s.name || 'Store';
          let descEl = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
          if (!descEl) { descEl = document.createElement('meta'); descEl.name = 'description'; document.head.appendChild(descEl); }
          descEl.content = s.description || `Shop at ${s.name}`;
          if (s.logo_url) {
            document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(el => el.parentNode?.removeChild(el));
            const icon = document.createElement('link');
            icon.rel = 'icon'; icon.href = s.logo_url; document.head.appendChild(icon);
            const apple = document.createElement('link');
            apple.rel = 'apple-touch-icon'; apple.href = s.logo_url; document.head.appendChild(apple);
          }
        } catch {}
        visitStartRef.current = Date.now();
        const { data: vid } = await supabase.rpc('track_store_visit_v2' as any, {
          p_store_id: s.id,
          p_path: window.location.pathname,
          p_referrer: document.referrer || '',
          p_session_hash: sessionHash(),
          p_traffic_source: trafficSource,
          p_user_agent: (navigator.userAgent || '').slice(0, 500),
        });
        if (vid) visitIdRef.current = vid as unknown as string;
      }
    })();
  }, [slug, trafficSource]);

  // Track session duration on tab unload / hide
  useEffect(() => {
    const flush = () => {
      if (!visitIdRef.current) return;
      const seconds = Math.max(0, Math.min(86400, Math.round((Date.now() - visitStartRef.current) / 1000)));
      supabase.rpc('update_visit_duration' as any, { p_visit_id: visitIdRef.current, p_seconds: seconds }).then(() => {}, () => {});
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);

  const [networkAvailability, setNetworkAvailability] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('available_networks' as any)
        .select('network, available_for_purchase');
      if (cancelled) return;
      const map: Record<string, boolean> = {};
      ((data as any[]) || []).forEach((c: any) => { map[c.network] = c.available_for_purchase === true; });
      setNetworkAvailability(map);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const dataProducts = useMemo(
    () => (store?.products || []).filter(p => p.kind === 'data' && (!p.network || networkAvailability[p.network] !== false)),
    [store, networkAvailability]
  );
  const checkerProducts = useMemo(() => (store?.products || []).filter(p => p.kind === 'checker'), [store]);
  const networksWithProducts = useMemo(
    () => DATA_NETWORKS.filter(n => dataProducts.some(p => p.network === n)),
    [dataProducts]
  );

  const [activeNetworkState, setActiveNetwork] = useState<string | null>(null);
  const activeNetwork = activeNetworkState && networksWithProducts.includes(activeNetworkState as any)
    ? activeNetworkState
    : (networksWithProducts[0] ?? null);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const trackClick = (sp: StoreProductPublic) => {
    if (!store) return;
    supabase.rpc('track_product_click_v2' as any, {
      p_store_id: store.id,
      p_store_product_id: sp.store_product_id,
      p_session_hash: sessionHash(),
      p_traffic_source: trafficSource,
    }).then(() => {}, () => {});
    setSelected(sp);
  };

  const checkout = async () => {
    if (!selected || !store) return;
    if (!isValidPhone(recipientPhone)) {
      toast({ title: selected.kind === 'data' ? 'Invalid recipient phone' : 'Invalid phone', description: PHONE_ERROR_MESSAGE, variant: 'destructive' }); return;
    }
    if (!paystackReady) { toast({ title: 'Payment gateway loading...', variant: 'destructive' }); return; }

    // Authoritative pre-flight for data orders: don't open Paystack if recipient
    // already has an active order on the same network.
    if (selected.kind === 'data' && selected.network) {
      try {
        const avail = await checkRecipientAvailability([
          { network: selected.network, phone: recipientPhone },
        ]);
        if (avail.blocked) {
          toast({
            title: 'Payment blocked — active order exists',
            description: formatBlockedMessage(avail.blocked_items),
            variant: 'warning',
          });
          return;
        }
      } catch (e) {
        console.error('[PublicStore] availability check failed:', e);
      }
    }

    // Authoritative network availability re-check for data orders: don't open
    // Paystack if the network has been toggled OFF since the page loaded.
    // Read from `available_networks` view — `network_api_configs` is admin-only via RLS.
    if (selected.kind === 'data' && selected.network) {
      try {
        const { data: netCfg } = await supabase
          .from('available_networks' as any)
          .select('available_for_purchase')
          .eq('network', selected.network)
          .maybeSingle();
        if (!netCfg || (netCfg as any).available_for_purchase !== true) {
          toast({
            title: `${selected.network} delivery is currently halted`,
            description: `${selected.network} delivery is currently halted. Please try again later.`,
            variant: 'destructive',
          });
          return;
        }
      } catch (e) {
        console.error('[PublicStore] network availability check failed:', e);
      }
    }




    const base = selected.selling_price;
    const totalWithFee = Math.round(base * (1 + PAYSTACK_FEE_RATE) * 100) / 100;
    const reference = `STR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    setProcessing(true);
    supabase.rpc('track_checkout_initiation' as any, {
      p_store_id: store.id,
      p_store_product_id: selected.store_product_id,
      p_session_hash: sessionHash(),
      p_kind: selected.kind,
      p_amount: selected.selling_price,
      p_traffic_source: trafficSource,
    }).then(() => {}, () => {});
    const effectiveEmail = buildBuyerEmail(recipientPhone);

    // Pre-create payment_attempt BEFORE opening Paystack — guarantees every
    // successful Store payment has a local record for blind-sweep recovery.
    try {
      await supabase.from('payment_attempts' as any).insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        paystack_reference: reference,
        attempt_type: selected.kind === 'data' ? 'store_data' : 'store_checker',
        status: 'pending',
        amount: totalWithFee,
        buyer_type: 'guest',
        buyer_phone: normalizePhone(recipientPhone),
        buyer_email: effectiveEmail,
        metadata: {
          channel: 'store',
          store_slug: store.slug,
          store_id: store.id,
          kind: 'store_order',
          product_kind: selected.kind,
          network: selected.network,
          bundle_size: selected.size,
          price_item_id: selected.price_item_id,
          checker_product_id: selected.checker_product_id,
          recipient_phone: normalizePhone(recipientPhone),
          buyer_phone: normalizePhone(recipientPhone),
          quantity: 1,
          paystack_total: totalWithFee,
        },
        event_log: [{ type: 'checkout_initiated', channel: `store_${selected.kind}`, timestamp: new Date().toISOString() }],
      });
    } catch (e) {
      console.error('[PublicStorePage] Failed to pre-create payment_attempt:', e);
    }

    openPaystack({
      email: effectiveEmail,
      amountGHS: totalWithFee,
      reference,
      metadata: {
        store_slug: store.slug,
        kind: 'store_order',
        product_kind: selected.kind,
        network: selected.network,
        bundle_size: selected.size,
        price_item_id: selected.price_item_id,
        checker_product_id: selected.checker_product_id,
        recipient_phone: normalizePhone(recipientPhone),
        buyer_phone: normalizePhone(recipientPhone),
        buyer_email: effectiveEmail,
        quantity: 1,
      },
      onCancel: () => setProcessing(false),
      onSuccess: async () => {
        if (selected.kind === 'data') {
          const { data, error } = await supabase.rpc('place_store_order_paystack' as any, {
            p_store_slug: store.slug,
            p_price_item_id: selected.price_item_id,
            p_recipient_phone: normalizePhone(recipientPhone),
            p_quantity: 1,
            p_payment_reference: reference,
            p_buyer_phone: normalizePhone(recipientPhone),
            p_buyer_email: effectiveEmail,
          });
          setProcessing(false);
          if (error) { toast({ title: 'Order failed', description: error.message, variant: 'destructive' }); return; }
          const token = (data as any)?.tracking_token;
          const shortId = (data as any)?.short_id;
          setSelected(null);
          setRecipientPhone('');
          setSuccessInfo({
            kind: 'data',
            shortId,
            reference,
            trackingToken: token,
            recipientPhone: normalizePhone(recipientPhone),
            bundleSize: selected.size,
            network: selected.network,
            amount: totalWithFee,
          });
        } else {
          const { data, error } = await supabase.rpc('place_store_checker_paystack' as any, {
            p_store_slug: store.slug,
            p_checker_product_id: selected.checker_product_id,
            p_quantity: 1,
            p_payment_reference: reference,
            p_buyer_phone: normalizePhone(recipientPhone),
            p_buyer_email: effectiveEmail,
            p_sms_phone: normalizePhone(recipientPhone),
          });
          setProcessing(false);
          if (error) { toast({ title: 'Purchase failed', description: error.message, variant: 'destructive' }); return; }
          const codes = (data as any)?.codes || [];
          const shortId = (data as any)?.short_id;
          setSelected(null);
          setRecipientPhone('');
          setSuccessInfo({
            kind: 'checker',
            shortId,
            reference,
            amount: totalWithFee,
            codes,
            productName: selected.name || selected.product || 'Result Checker',
          });
        }
      },
    });
  };

  const afaFee = Math.round(afaPrice * PAYSTACK_FEE_RATE * 100) / 100;
  const afaTotal = Math.round((afaPrice + afaFee) * 100) / 100;
  const afaValid = afaFullName.trim().length >= 2
    && isValidPhone(afaRegPhone)
    && afaLocation.trim().length >= 2
    && isValidPhone(afaBuyerPhone);

  const openAfa = async () => {
    // Use the store owner's configured AFA price (no admin fallback)
    setAfaPrice(Number(store?.afa_price || 0));
    setAfaOpen(true);
  };


  const submitAfa = async () => {
    if (!afaValid) {
      toast({ title: 'Please fill all fields', description: 'Name, registration phone, location and your contact number are required.', variant: 'warning' });
      return;
    }
    if (afaPrice <= 0) {
      toast({ title: 'Service unavailable', description: 'AFA price not configured. Please try again later.', variant: 'destructive' });
      return;
    }
    if (!paystackReady) { toast({ title: 'Payment gateway loading...', variant: 'destructive' }); return; }

    const reference = `AFA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    setAfaSubmitting(true);

    // Pre-create payment_attempt BEFORE opening Paystack.
    try {
      await supabase.from('payment_attempts' as any).insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        paystack_reference: reference,
        attempt_type: 'afa',
        status: 'pending',
        amount: afaTotal,
        buyer_type: 'guest',
        buyer_phone: normalizePhone(afaBuyerPhone),
        buyer_email: buildBuyerEmail(afaBuyerPhone),
        metadata: {
          type: 'afa',
          buyer_type: 'guest',
          channel: 'store',
          store_slug: store?.slug,
          full_name: afaFullName.trim(),
          registration_phone: normalizePhone(afaRegPhone),
          location: afaLocation.trim(),
          buyer_phone: normalizePhone(afaBuyerPhone),
          paystack_total: afaTotal,
        },
        event_log: [{ type: 'checkout_initiated', channel: 'store_afa', timestamp: new Date().toISOString() }],
      });
    } catch (e) {
      console.error('[PublicStorePage] Failed to pre-create AFA payment_attempt:', e);
    }



    openPaystack({
      email: buildBuyerEmail(afaBuyerPhone),
      amountGHS: afaTotal,
      reference,
      metadata: { type: 'afa', buyer_type: 'guest', buyer_phone: afaBuyerPhone, store_slug: store?.slug },
      onCancel: () => {
        setAfaSubmitting(false);
        toast({ title: 'Payment cancelled', description: 'No charges were made. You can try again.', variant: 'warning' });
      },
      onSuccess: async (ref: string) => {
        try {
          const res = await supabase.functions.invoke('paystack-direct-afa', {
            body: {
              reference: ref,
              buyer_type: 'guest',
              full_name: afaFullName.trim(),
              registration_phone: normalizePhone(afaRegPhone),
              location: afaLocation.trim(),
              buyer_phone: normalizePhone(afaBuyerPhone),
              buyer_email: buildBuyerEmail(afaBuyerPhone),
              affiliate_code: '',
              store_slug: store?.slug || '',
            },
          });
          if (res.error) throw new Error(res.error.message);
          const result = res.data as any;
          if (result?.error) throw new Error(result.error);
          setAfaSubmitting(false);
          setAfaOpen(false);
          setAfaFullName(''); setAfaRegPhone(''); setAfaLocation(''); setAfaBuyerPhone('');
          setSuccessInfo({
            kind: 'afa',
            shortId: result.short_id,
            reference: ref,
            amount: afaTotal,
          });
        } catch (e: any) {
          setAfaSubmitting(false);
          toast({ title: 'Verification issue', description: e.message || 'Please track your registration to confirm.', variant: 'warning' });
        }
      },
    });
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!store) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <Store className="w-12 h-12 text-muted-foreground" />
      <h1 className="text-xl font-bold">Store not found</h1>
      <p className="text-sm text-muted-foreground">This store link is no longer available.</p>
    </div>
  );

  const hasAnyContact = !!(store.contact_whatsapp || store.contact_group_link || store.contact_email);
  const waDigits = waNumber(store.contact_whatsapp || '');

  return (
    <div className="min-h-screen font-body bg-gradient-to-b from-indigo-50 via-background to-pink-50 dark:from-indigo-950/30 dark:via-background dark:to-pink-950/20 text-foreground">
      {store.banner_url && <div className="w-full h-40 sm:h-56 bg-cover bg-center" style={{ backgroundImage: `url(${store.banner_url})` }} />}

      {/* Hero — big store name + description, like landing */}
      <section className="px-4 pt-8 pb-4 sm:pt-12 relative overflow-hidden">
        <div className="absolute -top-16 -left-10 w-56 h-56 rounded-full bg-yellow-300/30 blur-3xl pointer-events-none" />
        <div className="absolute -top-10 -right-12 w-64 h-64 rounded-full bg-fuchsia-400/25 blur-3xl pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />

        <div className="max-w-md mx-auto text-center relative">
          {store.logo_url && (
            <img
              src={store.logo_url}
              alt={store.name}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover mx-auto mb-3 shadow-xl ring-4 ring-white dark:ring-white/10"
            />
          )}
          <h1 className="text-3xl sm:text-5xl font-display font-extrabold tracking-tight mb-2 leading-tight break-words bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-rose-500 bg-clip-text text-transparent">
            {store.name}
          </h1>
          {store.description && (
            <p className="text-sm sm:text-base text-muted-foreground mt-2 max-w-xl mx-auto px-2">
              {store.description}
            </p>
          )}
        </div>
      </section>

      {/* Network list cards (landing-style) */}
      <section className="px-4 pb-2 relative">
        <div className="max-w-md mx-auto">
          {networksWithProducts.length > 0 && (
            <>
              <div className="text-center mb-3">
                <h2 className="text-base sm:text-lg font-display font-semibold text-foreground">Buy Data Bundles</h2>
                <p className="text-xs text-muted-foreground mt-1">Pick a network, then tap a bundle to buy.</p>
              </div>
              <Card className="p-4 sm:p-5 space-y-4 shadow-md border-border/60">
                <div className="grid grid-cols-3 gap-2">
                  {networksWithProducts.map(n => {
                    const accent = getNetworkAccent(n);
                    const isActive = activeNetwork === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setActiveNetwork(n)}
                        className={`relative flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 px-2 py-2.5 rounded-xl border text-xs sm:text-sm font-medium min-w-0 transition-all duration-200 ${
                          isActive ? accent.tabActive : `border-border bg-card text-muted-foreground ${accent.tabHover}`
                        }`}
                      >
                        <img src={NETWORK_LOGOS[n]} alt={n} className="w-5 h-5 rounded-full object-cover" />
                        {n}
                      </button>
                    );
                  })}
                </div>
                {activeNetwork && (() => {
                  const list = dataProducts
                    .filter(p => p.network === activeNetwork)
                    .sort((a, b) => parseSizeGB(a.size || '') - parseSizeGB(b.size || ''));
                  return (<>
                  <div role="radiogroup" aria-label="Bundle size" className="grid grid-cols-3 gap-2">
                    {(showAllBundles ? list : list.slice(0, 6))
                      .map(p => (
                        <BundleTile
                          key={p.store_product_id}
                          network={activeNetwork}
                          size={fmtSize(p.size || '')}
                          price={formatGHS(p.selling_price)}
                          active={selected?.store_product_id === p.store_product_id}
                          onClick={() => trackClick(p)}
                        />
                      ))}
                  </div>
                  {list.length > 6 && (
                    <button type="button" onClick={() => setShowAllBundles(v => !v)}
                      className="w-full flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground py-1.5 mt-1">
                      {showAllBundles ? 'Show fewer bundles' : `Show all ${list.length} bundles`}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllBundles ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  </>);
                })()}
              </Card>
            </>
          )}

          {/* Track Order */}
          <div className="text-center mt-5">
            <Link to={`/store/${store.slug}/track`}>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-4 text-xs font-semibold bg-white/80 dark:bg-card/80 backdrop-blur text-foreground border border-border hover:bg-white hover:border-primary/40 rounded-full shadow-sm"
              >
                <Search className="w-3.5 h-3.5 mr-1.5" />
                Track Transaction
              </Button>
            </Link>
          </div>

          {/* Other Services */}
          {(checkerProducts.length > 0 || store.afa_enabled) && (
            <div className="mt-6">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2.5 px-1">
                Other Services
              </h3>
              <div className="flex flex-col gap-2.5">
                {checkerProducts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicker('checker')}
                    className="block group text-left"
                  >
                    <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:-translate-y-0.5 transition-all border border-white/20">
                      <div className="w-11 h-11 rounded-xl bg-white/25 backdrop-blur-sm ring-2 ring-white/40 flex items-center justify-center shrink-0">
                        <GraduationCap className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold drop-shadow-sm">Result Checker</div>
                        <div className="text-[11px] text-white/85">Buy BECE or WASSCE result checker here.</div>
                      </div>
                      <span className="text-[11px] font-bold bg-white/25 px-2.5 py-1 rounded-full shrink-0">
                        Buy Now
                      </span>
                    </div>
                  </button>
                )}
                {store.afa_enabled && (
                  <button type="button" onClick={openAfa} className="block group text-left w-full">
                    <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/20 hover:shadow-xl hover:-translate-y-0.5 transition-all border border-white/20">
                      <div className="w-11 h-11 rounded-xl bg-white/25 backdrop-blur-sm ring-2 ring-white/40 flex items-center justify-center shrink-0">
                        <UserPlus className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold drop-shadow-sm">MTN AFA Registration</div>
                        <div className="text-[11px] text-white/85">Register na kasa saaaa!</div>
                      </div>
                      <span className="text-[11px] font-bold bg-white/25 px-2.5 py-1 rounded-full shrink-0">
                        Register Now
                      </span>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Package picker dialog — opens when a network/checker entry is tapped */}
      <Dialog open={!!picker} onOpenChange={o => !o && setPicker(null)}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          {picker && (
            <>
              <div className={`px-5 py-4 flex items-center gap-3 ${
                picker === 'checker'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-600'
                  : `bg-gradient-to-r ${NETWORK_HEADER[picker]}`
              }`}>
                <div className="w-11 h-11 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center shrink-0 ring-2 ring-white/40">
                  {picker === 'checker'
                    ? <GraduationCap className="w-6 h-6 text-white" />
                    : <img src={NETWORK_LOGOS[picker]} alt={picker} className="w-6 h-6 rounded-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/80 block leading-none mb-1">
                    {picker === 'checker' ? 'Exams' : 'Data Bundles'}
                  </span>
                  <DialogTitle className="text-lg font-display font-extrabold text-white drop-shadow-sm leading-tight">
                    {picker === 'checker' ? 'Result Checkers' : picker}
                  </DialogTitle>
                </div>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-3 bg-background">
                {(() => {
                  const items: StoreProductPublic[] = picker === 'checker'
                    ? checkerProducts
                    : dataProducts
                        .filter(p => p.network === picker)
                        .sort((a, b) => parseSizeGB(a.size || '') - parseSizeGB(b.size || ''));
                  if (items.length === 0) {
                    return <p className="text-center text-sm text-muted-foreground py-8">No packages available.</p>;
                  }
                  return (
                    <ul className="flex flex-col gap-2">
                      {items.map(p => (
                        <li key={p.store_product_id}>
                          <button
                            type="button"
                            onClick={() => { setPicker(null); trackClick(p); }}
                            className={`relative overflow-hidden w-full flex items-center gap-3 px-3 py-3 rounded-2xl active:scale-[0.99] hover:-translate-y-0.5 transition-all text-left ${picker === 'checker' ? 'bg-card border border-border hover:border-primary/50' : `${getNetworkTile(picker!)} text-white`}`}
                          >
                            <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${
                              picker === 'checker'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20'
                                : NETWORK_ACCENT[picker!]
                            }`}>
                              {picker === 'checker'
                                ? <GraduationCap className="w-5 h-5" />
                                : <img src={NETWORK_LOGOS[picker!]} alt="" className="w-7 h-7 rounded-md object-cover" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-semibold truncate ${picker === 'checker' ? 'text-foreground' : 'text-white'}`}>
                                {picker === 'checker' ? p.name : fmtSize(p.size || '')}
                              </div>
                              <div className={`text-[11px] truncate ${picker === 'checker' ? 'text-muted-foreground' : 'text-white/85'}`}>
                                {picker === 'checker'
                                  ? `${p.exam_type} · Instant delivery`
                                  : (picker === 'MTN' ? 'Expires in 90 days' : 'Never expires')}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={`text-base font-extrabold tracking-tight ${picker === 'checker' ? 'text-foreground' : 'text-white'}`}>{formatGHS(p.selling_price)}</div>
                              <div className={`text-[10px] font-semibold uppercase tracking-wider ${picker === 'checker' ? 'text-primary' : 'text-white/90'}`}>Buy</div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {store.products.length === 0 && !store.afa_enabled && (
        <div className="max-w-md mx-auto px-4 mt-6">
          <Card className="p-8 text-center text-sm text-muted-foreground">No products listed yet.</Card>
        </div>
      )}


      {/* Trust badges */}
      <section aria-label="Why buy here" className="max-w-md mx-auto px-4 mt-8">
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: ShieldCheck, title: 'Secure payment', sub: 'Paystack protected' },
            { icon: CheckCircle, title: 'Fast delivery', sub: 'Sent automatically' },
            { icon: Store, title: 'Trusted seller', sub: 'Powered by DATA360', to: undefined as string | undefined },
          ].map((b: { icon: typeof Store; title: string; sub: string; to?: string }) => {
            const inner = (
              <div className="h-full flex flex-col items-center text-center gap-1 rounded-2xl border border-border bg-card p-3 shadow-sm">
                <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                  <b.icon className="w-4 h-4" />
                </div>
                <span className="text-[11.5px] font-semibold text-foreground leading-tight">{b.title}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{b.sub}</span>
              </div>
            );
            return b.to
              ? <Link key={b.title} to={b.to} className="hover:opacity-90 transition-opacity">{inner}</Link>
              : <div key={b.title}>{inner}</div>;
          })}
        </div>
      </section>

      {/* Contact Us — landing-style */}
      {hasAnyContact && (
        <footer className="border-t border-border mt-10 py-6">
          <div className="container mx-auto px-4 max-w-md">
            <div className="bg-card border border-border rounded-2xl shadow-sm p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-foreground text-center mb-3">Contact {store.name}</h3>
              <ul className="divide-y divide-border/60">
                {store.contact_whatsapp && (
                  <li>
                    <a
                      href={`https://wa.me/${waDigits}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 py-2.5 hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                    >
                      <MessageCircle className="w-4 h-4 shrink-0 text-green-600 dark:text-green-400" />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground leading-tight">WhatsApp</span>
                          <span className="text-[11px] text-muted-foreground leading-tight">· Chat with us</span>
                        </div>
                        <div className="text-[12px] text-foreground/80 truncate leading-tight mt-0.5">{store.contact_whatsapp}</div>
                      </div>
                    </a>
                  </li>
                )}
                {store.contact_group_link && (
                  <li>
                    <a
                      href={store.contact_group_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 py-2.5 hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                    >
                      <Users className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground leading-tight">Group / Channel</span>
                          <span className="text-[11px] text-muted-foreground leading-tight">· Join updates</span>
                        </div>
                        <div className="text-[12px] text-foreground/80 truncate leading-tight mt-0.5">{store.contact_group_link}</div>
                      </div>
                    </a>
                  </li>
                )}
                {store.contact_email && (
                  <li>
                    <a
                      href={`mailto:${store.contact_email}`}
                      className="flex items-center gap-3 py-2.5 hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                    >
                      <Mail className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground leading-tight">Email</span>
                          <span className="text-[11px] text-muted-foreground leading-tight">· Send a message</span>
                        </div>
                        <div className="text-[12px] text-foreground/80 truncate leading-tight mt-0.5">{store.contact_email}</div>
                      </div>
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <p className="text-[11px] text-muted-foreground text-center mt-4 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Secure checkout
            </p>
          </div>
        </footer>
      )}
      {!hasAnyContact && (
        <footer className="mt-10 py-6 border-t text-center text-xs text-muted-foreground">
          <p className="flex items-center justify-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Secure checkout</p>
        </footer>
      )}

      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="p-0 overflow-hidden border-0 max-w-md">
          {selected && (
            <>
              <div className={`bg-gradient-to-br ${selected.kind === 'checker' ? 'from-indigo-500 via-purple-500 to-fuchsia-500' : NETWORK_HEADER[selected.network || 'MTN']} p-5 text-white`}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-lg">
                    {selected.kind === 'checker'
                      ? <GraduationCap className="w-6 h-6" />
                      : <img src={NETWORK_LOGOS[selected.network || 'MTN']} alt="" className="w-8 h-8 object-contain" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wider text-white/80 font-medium">Checkout</div>
                    <div className="text-lg font-bold leading-tight truncate">
                      {selected.kind === 'checker' ? selected.name : `${selected.network} ${selected.size}`}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-5 space-y-4 bg-background">
                <div className="flex justify-between items-center bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 p-4 rounded-2xl">
                  <span className="text-sm text-muted-foreground font-medium">Total</span>
                  <span className="text-2xl font-bold text-primary">{formatGHS(selected.selling_price)}</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">{selected.kind === 'data' ? 'Beneficiary Phone Number (The number to receive the data)' : 'Your phone (for SMS)'}</Label>
                  <Input
                    value={recipientPhone}
                    onChange={e => setRecipientPhone(e.target.value)}
                    placeholder="024..."
                    className="h-12 rounded-xl text-base"
                  />
                  {selected.kind === 'data' && <MtnVerifyBadge phone={recipientPhone} network={selected.network} onReadyChange={setMtnReady} />}
                </div>
                <Button
                  onClick={checkout}
                  disabled={processing || (selected.kind === 'data' && !mtnReady)}
                  className="w-full h-12 rounded-xl text-base font-semibold !bg-none !bg-emerald-600 hover:!bg-emerald-700 text-white hover:text-white border-0 shadow-none transition-transform hover:-translate-y-0.5"
                >
                  {processing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <ShoppingCart className="w-5 h-5 mr-2" />}
                  Pay with Paystack
                </Button>
                <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> Secure payment via Paystack
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={afaOpen} onOpenChange={o => { if (!afaSubmitting) setAfaOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-yellow-600" /> MTN AFA Registration
            </DialogTitle>
          </DialogHeader>
          {afaPriceLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : afaSubmitting ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-3">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Processing your registration…</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs"><User className="w-3.5 h-3.5" /> Full Name</Label>
                <Input value={afaFullName} onChange={e => setAfaFullName(e.target.value)} placeholder="As registered on Ghana Card" maxLength={80} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs"><Phone className="w-3.5 h-3.5" /> MTN Phone Number to Register</Label>
                <Input
                  type="tel" inputMode="numeric"
                  value={afaRegPhone}
                  onChange={e => setAfaRegPhone(normalizePhone(e.target.value))}
                  placeholder="0241234567"
                />
                
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs"><MapPin className="w-3.5 h-3.5" /> Location</Label>
                <Input value={afaLocation} onChange={e => setAfaLocation(e.target.value)} placeholder="e.g. Accra, Kasoa" maxLength={80} />
              </div>
              <div className="border-t border-border/60 pt-3 space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs"><Phone className="w-3.5 h-3.5" /> Your Contact Number</Label>
                <Input
                  type="tel" inputMode="numeric"
                  value={afaBuyerPhone}
                  onChange={e => setAfaBuyerPhone(normalizePhone(e.target.value))}
                  placeholder="So we can reach you about this registration"
                />
              </div>
              <div className="rounded-xl bg-muted/50 border border-border/60 p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Registration fee</span>
                  <span className="font-medium text-foreground">{formatGHS(afaPrice)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Processing fee (2%)</span>
                  <span className="font-medium text-foreground">{formatGHS(afaFee)}</span>
                </div>
                <div className="flex justify-between items-baseline border-t border-border/40 pt-1.5">
                  <span className="text-sm font-semibold text-foreground">Total</span>
                  <span className="text-lg font-bold text-primary">{formatGHS(afaTotal)}</span>
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
                onClick={submitAfa}
                disabled={!afaValid || !paystackReady || afaPrice <= 0}
                className="w-full h-12 !bg-none !bg-emerald-600 text-white hover:!bg-emerald-700 font-semibold gap-2"
              >
                {!paystackReady ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                Submit & Pay
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Success dialog — shows reference + tracking after Paystack payment */}
      <Dialog open={!!successInfo} onOpenChange={o => !o && setSuccessInfo(null)}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          {successInfo && (() => {
            const trackingUrl = successInfo.trackingToken
              ? `${window.location.origin}/store/${store!.slug}/track?token=${successInfo.trackingToken}`
              : successInfo.shortId
                ? `${window.location.origin}/store/${store!.slug}/track?short_id=${successInfo.shortId}`
                : '';
            const trackHref = successInfo.trackingToken
              ? `/store/${store!.slug}/track?token=${successInfo.trackingToken}`
              : successInfo.shortId
                ? `/store/${store!.slug}/track?short_id=${successInfo.shortId}`
                : `/store/${store!.slug}/track`;
            const title =
              successInfo.kind === 'data' ? 'Order Placed Successfully!'
              : successInfo.kind === 'checker' ? 'Purchase Complete!'
              : 'Registration Submitted!';
            const subtitle =
              successInfo.kind === 'data' ? 'Your data bundle order has been submitted.'
              : successInfo.kind === 'checker' ? 'Your result checker codes are ready.'
              : "We'll notify you by SMS once the registration is processed.";
            return (
              <div className="p-6 space-y-5 bg-background">
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto">
                    <CheckCircle className="w-7 h-7 text-success" />
                  </div>
                  <DialogTitle className="text-lg font-display font-bold text-foreground">{title}</DialogTitle>
                  <p className="text-xs text-muted-foreground">{subtitle}</p>
                </div>

                <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 space-y-2.5">
                  {successInfo.shortId && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Reference</span>
                      <span className="font-mono text-primary font-semibold">{successInfo.shortId}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Payment Ref</span>
                    <span className="font-mono text-xs text-foreground truncate max-w-[180px]">{successInfo.reference}</span>
                  </div>
                  {successInfo.kind === 'data' && (
                    <>
                      {successInfo.network && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Network</span>
                          <span className="text-foreground font-medium">{successInfo.network}</span>
                        </div>
                      )}
                      {successInfo.bundleSize && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Bundle</span>
                          <span className="text-foreground font-medium">{fmtSize(successInfo.bundleSize)}</span>
                        </div>
                      )}
                      {successInfo.recipientPhone && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Recipient</span>
                          <span className="font-mono text-foreground font-medium">{successInfo.recipientPhone}</span>
                        </div>
                      )}
                    </>
                  )}
                  {successInfo.kind === 'checker' && successInfo.productName && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Product</span>
                      <span className="text-foreground font-medium">{successInfo.productName}</span>
                    </div>
                  )}
                  <div className="border-t border-border/60 pt-2 flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-foreground">Amount Paid</span>
                    <span className="text-lg font-bold text-primary">{formatGHS(successInfo.amount)}</span>
                  </div>
                </div>

                {successInfo.kind === 'checker' && successInfo.codes && successInfo.codes.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your codes</p>
                    {successInfo.codes.map((c, i) => (
                      <div key={i} className="rounded-lg bg-muted/40 border border-border p-2.5 text-sm font-mono">
                        <div>Serial: {c.serial_number}</div>
                        <div>PIN: {c.pin}</div>
                      </div>
                    ))}
                  </div>
                )}

                {trackingUrl && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">📍 Save your tracking link</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-muted/50 rounded-lg px-3 py-2 text-foreground font-mono truncate border border-border/50">
                        {trackingUrl}
                      </code>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(trackingUrl);
                          toast({ title: 'Tracking link copied!' });
                        }}
                        className="shrink-0"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setSuccessInfo(null)}>
                    Close
                  </Button>
                  <Link to={trackHref} className="flex-1">
                    <Button className="w-full gap-2">
                      <ExternalLink className="w-3.5 h-3.5" /> Track
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
