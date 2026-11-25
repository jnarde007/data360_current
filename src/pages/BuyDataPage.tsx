import { MtnVerifyBadge } from '@/components/MtnVerifyBadge';
import { useSuperAgentPricing } from '@/hooks/use-super-agent-pricing';
import { SuperAgentBadge } from '@/components/SuperAgentBadge';
import { BundleTile } from '@/components/BundleTile';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getNetworkAccent, formatPhoneSpaced } from '@/lib/network-colors';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { formatGHS } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ShoppingCart, X, Trash2, AlertTriangle, Clock, Loader2, Wifi, Phone, Package, Info, ChevronDown, CheckCircle, Wallet, CreditCard, RefreshCw } from 'lucide-react';
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';
import mtnLogo from '@/assets/mtn-logo.png';
import atLogo from '@/assets/at-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { OrderCountdown } from '@/components/OrderCountdown';
import { useNavigate } from 'react-router-dom';
import { usePaystack, PAYSTACK_FEE_RATE } from '@/hooks/use-paystack';
import { PaymentRecoveryBanner } from '@/components/PaymentRecoveryBanner';
import { checkRecipientAvailability, formatBlockedMessage } from '@/lib/recipient-availability';

// Ghana phone number prefix to network mapping
const NETWORK_PREFIXES: Record<string, string> = {
  '024': 'MTN', '025': 'MTN', '053': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN',
  '026': 'AirtelTigo', '027': 'AirtelTigo', '056': 'AirtelTigo', '057': 'AirtelTigo',
  '020': 'Telecel', '050': 'Telecel',
};

function detectNetworkFromPhone(phone: string): string | null {
  const cleaned = phone.replace(/\s+/g, '');
  const prefix = cleaned.substring(0, 3);
  return NETWORK_PREFIXES[prefix] || null;
}

function getNetworkMismatchWarning(phone: string, selectedNetwork: string): string | null {
  if (phone.length < 3) return null;
  const detected = detectNetworkFromPhone(phone);
  if (!detected) return null;
  if (detected !== selectedNetwork) {
    return `This looks like a ${detected} number, but you selected ${selectedNetwork}.`;
  }
  return null;
}

interface PriceItem {
  id: string;
  network: string;
  product: string;
  size: string;
  price: number;
  cost_price: number;
}

interface BulkOrderItem {
  id: string;
  phone: string;
  bundleId: string;
  bundleLabel: string;
  price: number;
  cost_price: number;
  detectedNetwork: string | null;
}

interface PlacedOrder {
  orderId: string;
  shortId: string;
  gracePeriodEndsAt: string;
}

export default function BuyDataPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { paystackReady, paystackFailed, retryLoad, openPaystack } = usePaystack();
  const [mtnReady, setMtnReady] = useState(true);
  const [verifyingPaystack, setVerifyingPaystack] = useState(false);

  // Load bundles from admin-managed price_items table
  const [rawPriceItems, setPriceItems] = useState<PriceItem[]>([]);
  const { isSuperAgent, prices: superAgentPrices } = useSuperAgentPricing();
  // Super Agents see their server-computed special price; everyone else sees the ordinary price.
  const priceItems = useMemo(
    () => rawPriceItems.map(p => (isSuperAgent && superAgentPrices[p.id] !== undefined ? { ...p, price: superAgentPrices[p.id] } : p)),
    [rawPriceItems, isSuperAgent, superAgentPrices]
  );
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
        .select('id, network, product, size, price, is_available')
        .eq('product', 'Data')
        .order('network')
        .order('price');
      if (error) throw error;
      setPriceItems(
        ((data as any[]) || [])
          .filter((d: any) => d.network in availMap) // include all configured networks (even OFF) so we can show the warning
          .map((d: any) => ({
            ...d,
            price: Number(d.price), cost_price: 0, is_available: d.is_available !== false, // cost_price is now resolved server-side in place_order()
          }))
      );
    } catch {
      toast({ title: 'Unable to load bundles', description: 'Please refresh the page or try again later.', variant: 'destructive' });
    } finally {
      setLoadingPrices(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  // Realtime: re-fetch when network availability or pricing changes
  useRealtimeRefresh(['network_api_configs', 'price_items'], fetchPrices, 'buydata-live-sync');

  // Normalize bundle size to always show uppercase "GB"
  const fmtSize = (s: string) => { const up = s.toUpperCase(); return /GB/.test(up) ? up : `${up}GB`; };

  // Derive unique networks from price_items
  const availableNetworks = useMemo(() => {
    const networkSet = new Set(priceItems.map(p => p.network));
    return Array.from(networkSet).sort();
  }, [priceItems]);

  const [selectedNetwork, setSelectedNetwork] = useState<string>('');
  const [bulkMode, setBulkMode] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [placedOrders, setPlacedOrders] = useState<PlacedOrder[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [mtnNoticeOpen, setMtnNoticeOpen] = useState(false);
  const [showAllBundles, setShowAllBundles] = useState(false);

  // Single mode state
  const [selectedBundle, setSelectedBundle] = useState<string>('');
  const [phone, setPhone] = useState('');

  // Bulk mode state
  const [bulkInput, setBulkInput] = useState('');
  const [bulkOrders, setBulkOrders] = useState<BulkOrderItem[]>([]);
  

  // Auto-select MTN as default network, fallback to first available
  useEffect(() => {
    if (availableNetworks.length > 0 && !selectedNetwork) {
      const mtn = availableNetworks.find(n => n.toUpperCase() === 'MTN');
      setSelectedNetwork(mtn || availableNetworks[0]);
    }
  }, [availableNetworks, selectedNetwork]);

  // Prefill from "Repeat last order" link (?network=&size=&phone=), applied once
  const prefillDone = useRef(false);
  useEffect(() => {
    if (prefillDone.current || priceItems.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const net = params.get('network');
    if (!net) { prefillDone.current = true; return; }
    prefillDone.current = true;
    if (!availableNetworks.includes(net)) return;
    setSelectedNetwork(net);
    const size = params.get('size');
    const match = priceItems.find(p => p.network === net && String(p.size) === size);
    if (match) setSelectedBundle(match.id);
    const ph = params.get('phone');
    if (ph) setPhone(ph.replace(/\D/g, '').slice(0, 10));
  }, [priceItems, availableNetworks]);

  // Reset stale selections when bundles change (e.g. admin deletes a bundle or disables a network)
  useEffect(() => {
    if (selectedNetwork && !priceItems.some(p => p.network === selectedNetwork)) {
      setSelectedNetwork(availableNetworks[0] || '');
      setSelectedBundle('');
      setBulkOrders([]);
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

  const totalAmount = bulkMode
    ? bulkOrders.reduce((sum, o) => sum + o.price, 0)
    : selectedBundleData ? selectedBundleData.price : 0;

  const canAfford = (user?.wallet_balance || 0) >= totalAmount;

  // Authorized cross-network exception â€” managed via `authorized_cross_network_users` table.
  // Server-side is authoritative (place_order RPC enforces + audits); this is UI-only.
  const [canBypassCrossNetwork, setCanBypassCrossNetwork] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) { setCanBypassCrossNetwork(false); return; }
    supabase.rpc('is_cross_network_authorized', { _customer_id: user.id }).then(({ data }) => {
      if (!cancelled) setCanBypassCrossNetwork(Boolean(data));
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Bulk-mode network validation summary
  const bulkMismatches = useMemo(
    () => (bulkMode && !canBypassCrossNetwork) ? bulkOrders.filter(o => o.detectedNetwork !== selectedNetwork) : [],
    [bulkMode, bulkOrders, selectedNetwork, canBypassCrossNetwork]
  );
  const bulkNetworkSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    let unknown = 0;
    for (const o of bulkOrders) {
      if (o.detectedNetwork) counts[o.detectedNetwork] = (counts[o.detectedNetwork] || 0) + 1;
      else unknown++;
    }
    return { counts, unknown };
  }, [bulkOrders]);

  const hasItems = bulkMode ? bulkOrders.length > 0 && bulkMismatches.length === 0 : (selectedBundle && phone);
  const networkWarning = (!bulkMode && !canBypassCrossNetwork) ? getNetworkMismatchWarning(phone, selectedNetwork) : null;

  const handleAddBulkLines = () => {
    if (!selectedNetwork) {
      toast({ title: 'Network required', description: 'Please select a network before continuing.', variant: 'destructive' });
      return;
    }
    const lines = bulkInput.split('\n').filter(l => l.trim());
    const added: BulkOrderItem[] = [];
    const failed: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) { failed.push(trimmed); continue; }
      const linePhone = normalizePhone(parts[0]);
      if (!isValidPhone(linePhone)) { failed.push(trimmed); continue; }
      const sizeRaw = parts.slice(1).join(' ').toUpperCase();
      // Match against available bundles by size
      let matched = availableBundles.find(b => b.size.toUpperCase() === sizeRaw);
      if (!matched && /^\d+$/.test(sizeRaw)) {
        matched = availableBundles.find(b => b.size.toUpperCase() === `${sizeRaw}GB`);
      }
      if (!matched) { failed.push(trimmed); continue; }
      added.push({ id: crypto.randomUUID(), phone: linePhone, bundleId: matched.id, bundleLabel: matched.size, price: matched.price, cost_price: matched.cost_price, detectedNetwork: detectNetworkFromPhone(linePhone) });
    }
    if (added.length > 0) {
      setBulkOrders(prev => [...prev, ...added]);
      setBulkInput('');
    }
    if (failed.length > 0) {
      toast({ title: `${failed.length} line${failed.length > 1 ? 's' : ''} skipped`, description: `Could not parse: ${failed.join(', ')}. Ensure format is "phone bundle_size".`, variant: 'warning' });
    }
  };

  const removeBulkOrder = (id: string) => {
    setBulkOrders(prev => prev.filter(o => o.id !== id));
  };

  const ACTIVE_STATUSES = ['pending', 'processing', 'pending_manual', 'awaiting_manual_fulfillment', 'submitted', 'pending_confirmation'];

  const checkPendingOrders = useCallback(async (phones: string[]): Promise<string[]> => {
    const normalized = phones.map(p => p.replace(/\s+/g, ''));
    const { data } = await supabase
      .from('orders')
      .select('recipient_phone')
      .in('status', ACTIVE_STATUSES)
      .in('recipient_phone', normalized);
    return data ? [...new Set(data.map(o => o.recipient_phone))] : [];
  }, []);

  const handleOrder = async () => {
    if (!selectedNetwork) { toast({ title: 'Network required', description: 'Please select a network before continuing.', variant: 'destructive' }); return; }
    if (networkAvailability[selectedNetwork] === false) {
      toast({
        title: `${selectedNetwork} delivery is currently halted`,
        description: 'Delivery is currently halted due to network issues. All pending orders will be delivered once service is restored.',
        variant: 'warning',
      });
      return;
    }
    if (!bulkMode) {
      if (!selectedBundle) { toast({ title: 'Bundle required', description: 'Please select a data bundle.', variant: 'destructive' }); return; }
      if (!phone) { toast({ title: 'Recipient required', description: 'Please enter the recipient phone number.', variant: 'destructive' }); return; }
      if (!isValidPhone(phone)) { toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' }); return; }
    } else {
      if (bulkOrders.length === 0) { toast({ title: 'No orders added', description: 'Please add at least one order to your queue.', variant: 'destructive' }); return; }
      const invalid = bulkOrders.find(o => !isValidPhone(o.phone));
      if (invalid) { toast({ title: 'Invalid phone in queue', description: `${invalid.phone} â€” ${PHONE_ERROR_MESSAGE}`, variant: 'destructive' }); return; }
      if (bulkMismatches.length > 0) {
        toast({
          title: `${bulkMismatches.length} number${bulkMismatches.length > 1 ? 's do' : ' does'} not match ${selectedNetwork}`,
          description: `Remove or fix: ${bulkMismatches.slice(0, 5).map(m => `${m.phone} (${m.detectedNetwork || 'unknown'})`).join(', ')}${bulkMismatches.length > 5 ? 'â€¦' : ''}. Mixed-network batches are not allowed.`,
          variant: 'destructive',
        });
        return;
      }
    }
    // Balance check removed â€” handled in confirmation dialog per payment method

    setCheckingDuplicates(true);
    try {
      const phonesToCheck = bulkMode ? bulkOrders.map(o => o.phone) : [phone];
      const duplicates = await checkPendingOrders(phonesToCheck);
      if (duplicates.length > 0) {
        toast({
          title: 'Active order in progress',
          description: `${duplicates.join(', ')} already ${duplicates.length === 1 ? 'has' : 'have'} a pending order. Please wait for delivery before ordering again.`,
          variant: 'warning',
        });
        return;
      }
      setShowConfirm(true);
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const confirmWalletOrder = async () => {
    setShowConfirm(false);

    // Authoritative pre-flight: never debit wallet if recipient already has an active order.
    try {
      const items = bulkMode
        ? bulkOrders.map(o => ({ network: selectedNetwork, phone: o.phone }))
        : [{ network: selectedNetwork, phone }];
      const avail = await checkRecipientAvailability(items);
      if (avail.blocked) {
        toast({
          title: 'Order blocked â€” active order exists',
          description: formatBlockedMessage(avail.blocked_items),
          variant: 'warning',
        });
        return;
      }
    } catch (e) {
      console.error('[BuyData] availability check failed:', e);
    }

    try {
      const newPlacedOrders: PlacedOrder[] = [];


      if (bulkMode) {
        for (const order of bulkOrders) {
          const { data, error } = await supabase.rpc('place_order', {
            p_customer_id: user!.id,
            p_network: selectedNetwork,
            p_bundle_size: order.bundleLabel,
            p_recipient_phone: order.phone,
            p_quantity: 1,
            p_total_amount: order.price,
            p_cost_price: order.cost_price,
            p_delivery_mode: 'manual',
            p_provider_name: '',
          });
          if (error) throw error;
          const result = data as any;
          if (result?.error) throw new Error(result.error);
          if (result?.order_id) {
            newPlacedOrders.push({
              orderId: result.order_id,
              shortId: result.short_id,
              gracePeriodEndsAt: result.grace_period_ends_at,
            });
          }
        }
      } else {
        const bundle = selectedBundleData!;
        const { data, error } = await supabase.rpc('place_order', {
          p_customer_id: user!.id,
          p_network: selectedNetwork,
          p_bundle_size: bundle.size,
          p_recipient_phone: phone,
          p_quantity: 1,
          p_total_amount: bundle.price,
          p_cost_price: bundle.cost_price,
          p_delivery_mode: 'manual',
          p_provider_name: '',
        });
        if (error) throw error;
        const result = data as any;
        if (result?.error) throw new Error(result.error);
        if (result?.order_id) {
          newPlacedOrders.push({
            orderId: result.order_id,
            shortId: result.short_id,
            gracePeriodEndsAt: result.grace_period_ends_at,
          });
        }
      }

      setPlacedOrders(newPlacedOrders);
      setOrderPlaced(true);
      toast({ title: 'Order placed successfully', description: `${formatGHS(totalAmount)} deducted from your wallet. You have 3 minutes to cancel if needed.`, variant: 'success' });

      for (const placed of newPlacedOrders) {
        const orderData = bulkMode
          ? bulkOrders[newPlacedOrders.indexOf(placed)]
          : { phone, bundleLabel: selectedBundleData!.size, price: selectedBundleData!.price };
        supabase.functions.invoke('send-transactional-email', {
          body: {
            template: 'order-confirmation',
            customer_id: user!.id,
            data: {
              short_id: placed.shortId,
              recipient_phone: orderData.phone,
              network: selectedNetwork,
              bundle_size: orderData.bundleLabel,
              total_amount: orderData.price,
            },
          },
        }).catch((e: unknown) => console.error('Order confirmation email error:', e));
      }

      refreshUser();
    } catch (err: any) {
      toast({ title: 'Order failed', description: err?.message || 'Something went wrong placing your order. Please try again.', variant: 'destructive' });
    }
  };

  const paystackFee = Math.round(totalAmount * PAYSTACK_FEE_RATE * 100) / 100;
  const paystackTotal = Math.round((totalAmount + paystackFee) * 100) / 100;

  const confirmPaystackOrder = async () => {
    if (!paystackReady) return;

    setShowConfirm(false);

    // Build orders list for both single and bulk
    const orderItems = bulkMode
      ? bulkOrders.map(o => ({ phone: o.phone, bundleLabel: o.bundleLabel, price: o.price, cost_price: o.cost_price }))
      : [{ phone, bundleLabel: selectedBundleData!.size, price: selectedBundleData!.price, cost_price: selectedBundleData!.cost_price }];

    // Authoritative pre-flight: do not open Paystack if recipient already has an active order.
    try {
      const avail = await checkRecipientAvailability(
        orderItems.map(o => ({ network: selectedNetwork, phone: o.phone }))
      );
      if (avail.blocked) {
        toast({
          title: 'Payment blocked â€” active order exists',
          description: formatBlockedMessage(avail.blocked_items),
          variant: 'warning',
        });
        return;
      }
    } catch (e) {
      console.error('[BuyData] availability check failed:', e);
    }

    // Authoritative network availability re-check: don't open Paystack if the
    // selected network has been toggled OFF since the page loaded.
    // Read from `available_networks` view â€” `network_api_configs` is admin-only via RLS.
    try {
      const { data: netCfg } = await supabase
        .from('available_networks' as any)
        .select('available_for_purchase')
        .eq('network', selectedNetwork)
        .maybeSingle();
      if (!netCfg || (netCfg as any).available_for_purchase !== true) {
        toast({
          title: `${selectedNetwork} delivery is currently halted`,
          description: `${selectedNetwork} delivery is currently halted. Please try again later.`,
          variant: 'destructive',
        });
        return;
      }
    } catch (e) {
      console.error('[BuyData] network availability check failed:', e);
    }

    // Generate a unique reference for this checkout session
    const paystackRef = `dd_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;

    // Create a payment_attempt record BEFORE redirecting to Paystack
    try {
      await supabase.from('payment_attempts' as any).insert({
        customer_id: user!.id,
        paystack_reference: paystackRef,
        attempt_type: 'data_direct',
        status: 'pending',
        amount: totalAmount,
        metadata: {
          network: selectedNetwork,
          items: orderItems,
          paystack_total: paystackTotal,
          paystack_fee: paystackFee,
        },
        event_log: [{ type: 'checkout_initiated', timestamp: new Date().toISOString() }],
      });
    } catch (e) {
      console.error('Failed to create payment_attempt:', e);
    }

    openPaystack({
      email: user?.email || '',
      amountGHS: paystackTotal,
      reference: paystackRef,
      metadata: {
        customer_id: user?.id,
        type: 'data_direct',
        network: selectedNetwork,
        order_count: orderItems.length,
        custom_fields: [
          { display_name: 'Type', variable_name: 'type', value: 'data_direct' },
          { display_name: 'Network', variable_name: 'network', value: selectedNetwork },
          { display_name: 'Orders', variable_name: 'order_count', value: String(orderItems.length) },
        ],
      },
      onSuccess: async (reference: string) => {
        setVerifyingPaystack(true);
        try {
          // Delegate to the canonical finalize-payment via the callback handler
          const res = await supabase.functions.invoke('paystack-direct-order', {
            body: {
              reference,
              customer_id: user!.id,
              network: selectedNetwork,
              bundle_size: orderItems[0]?.bundleLabel,
              recipient_phone: orderItems[0]?.phone,
              total_amount: totalAmount,
            },
          });
          const result = res.data as any;
          if (res.error) throw new Error(res.error.message || 'Verification failed');
          if (result?.error) throw new Error(result.error);

          const newPlacedOrders: PlacedOrder[] = [];
          // finalize-payment returns all orders in result.orders
          if (Array.isArray(result?.orders) && result.orders.length > 0) {
            for (const o of result.orders) {
              newPlacedOrders.push({
                orderId: o.order_id,
                shortId: o.short_id,
                gracePeriodEndsAt: o.grace_period_ends_at || result.grace_period_ends_at || '',
              });
            }
          } else if (result?.order_id) {
            newPlacedOrders.push({
              orderId: result.order_id,
              shortId: result.short_id || '',
              gracePeriodEndsAt: result.grace_period_ends_at || '',
            });
          }

          setPlacedOrders(newPlacedOrders);
          setOrderPlaced(true);

          if (result?.partial_failure) {
            toast({ title: 'Order partially placed', description: result.message || `${result.items_succeeded}/${result.items_total} items succeeded.`, variant: 'warning' });
          } else {
            toast({ title: 'Order placed successfully', description: result.message || 'Payment verified.', variant: 'success' });
          }
        } catch (e: any) {
          toast({ title: 'Payment verification failed', description: e.message, variant: 'destructive' });
        } finally {
          setVerifyingPaystack(false);
        }
      },
      onCancel: () => {
        supabase.from('payment_attempts' as any)
          .select('event_log')
          .eq('paystack_reference', paystackRef)
          .maybeSingle()
          .then(({ data }: any) => {
            const log = Array.isArray(data?.event_log) ? data.event_log : [];
            supabase.from('payment_attempts' as any)
              .update({
                status: 'abandoned',
                event_log: [...log, { type: 'user_cancelled', timestamp: new Date().toISOString() }],
                updated_at: new Date().toISOString(),
              })
              .eq('paystack_reference', paystackRef)
              .then(() => {});
          });
        toast({ title: 'Payment cancelled', description: 'No charges were made. You can try again.', variant: 'warning' });
      },
    });
  };

  const handleOrderCancelled = async () => {
    await refreshUser();
    setPlacedOrders([]);
    setOrderPlaced(false);
    toast({ title: 'Order cancelled', description: 'Your order has been cancelled and your wallet refunded.', variant: 'success' });
  };

  if (verifyingPaystack) {
    return (
      <CustomerLayout>
        <div className="flex flex-col items-center justify-center py-20 space-y-5 animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-display font-bold text-foreground">Verifying your payment...</h2>
            <p className="text-sm text-muted-foreground">Please wait while we confirm your order.</p>
          </div>
        </div>
      </CustomerLayout>
    );
  }

  if (loadingPrices) {
    return (
      <CustomerLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </CustomerLayout>
    );
  }

  if (orderPlaced) {
    const networkLogosSuccess: Record<string, string> = {
      'MTN': mtnLogo,
      'AirtelTigo': atLogo,
      'Telecel': telecelLogo,
    };

    return (
      <CustomerLayout>
        <div className="max-w-md mx-auto py-6 space-y-6">
          {/* Success header */}
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-1">Order Placed Successfully!</h2>
            <p className="text-sm text-muted-foreground">Your data bundle order has been submitted.</p>
          </div>

          {placedOrders.map(po => {
            const bundle = selectedBundleData;
            return (
              <div key={po.orderId} className="glass-card glow-border overflow-hidden rounded-[22px]">
                <div className={getNetworkAccent(selectedNetwork).topBar} />
                {/* Order Details header */}
                <div className={`px-5 py-3 border-b border-border/40 ${getNetworkAccent(selectedNetwork).headerGlow}`}>
                  <span className={`text-xs font-bold uppercase tracking-wider ${getNetworkAccent(selectedNetwork).iconText}`}>Order Details</span>
                </div>

                <div className="px-5 py-4 space-y-5">
                  {/* Network indicator */}
                  <div className="flex items-center gap-2.5">
                    {networkLogosSuccess[selectedNetwork] && (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${getNetworkAccent(selectedNetwork).logoRing}`}>
                        <img src={networkLogosSuccess[selectedNetwork]} alt={selectedNetwork} className="w-6 h-6 rounded-full object-cover" />
                      </div>
                    )}
                    <div>
                      <span className="text-sm font-semibold text-foreground">{selectedNetwork}</span>
                      <span className="text-xs text-muted-foreground block">Data Bundle</span>
                    </div>
                  </div>

                  {/* Detail rows */}
                  <div className="space-y-3">
                    {[
                      { label: 'Order ID', value: <span className="font-mono text-primary font-semibold">{po.shortId}</span> },
                      { label: 'Bundle', value: bundle ? fmtSize(bundle.size) : bulkOrders.length > 0 ? `${bulkOrders.length} items` : 'â€”' },
                      { label: 'Recipient', value: <span className="font-mono">{phone || (bulkOrders.length > 0 ? `${bulkOrders.length} numbers` : 'â€”')}</span> },
                    ].map(row => (
                      <div key={row.label} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span className="text-foreground font-medium">{row.value}</span>
                      </div>
                    ))}
                    <div className="border-t border-border/60 pt-3 flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-foreground">Amount</span>
                      <span className={`text-xl font-bold ${getNetworkAccent(selectedNetwork).totalText}`}>{formatGHS(totalAmount)}</span>
                    </div>
                  </div>

                  {/* Cancellation / countdown section */}
                  <div className="border-t border-border/50 pt-4">
                    <div className="rounded-xl bg-muted/30 border border-border/60 p-3.5">
                      <OrderCountdown
                        orderId={po.orderId}
                        customerId={user!.id}
                        gracePeriodEndsAt={po.gracePeriodEndsAt}
                        shortId={po.shortId}
                        onCancelled={handleOrderCancelled}
                        onExpired={() => {}}
                        showHelper
                        allowProceedNow
                        onProceeded={() => {
                          setPlacedOrders(prev => prev.filter(p => p.orderId !== po.orderId));
                          if (placedOrders.length <= 1) {
                            setOrderPlaced(false);
                            setSelectedBundle(''); setPhone(''); setBulkOrders([]); setBulkInput('');
                            navigate('/orders');
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex gap-3 justify-center pt-1">
            <Button variant="outline" onClick={() => navigate('/orders')}>
              View Orders
            </Button>
            <Button onClick={() => { setOrderPlaced(false); setSelectedBundle(''); setPhone(''); setBulkOrders([]); setBulkInput(''); setPlacedOrders([]); }} className="gradient-primary text-primary-foreground border-0">
              Place Another Order
            </Button>
          </div>
        </div>
      </CustomerLayout>
    );
  }

  const networkLogos: Record<string, string> = {
    'MTN': mtnLogo,
    'AirtelTigo': atLogo,
    'Telecel': telecelLogo,
  };

  const stepComplete = {
    network: !!selectedNetwork,
    phone: !bulkMode ? phone.length >= 10 : bulkOrders.length > 0,
    bundle: !bulkMode ? !!selectedBundle : bulkOrders.length > 0,
  };

  return (
    <CustomerLayout>
      <div className="max-w-xl mx-auto space-y-4">
        <PaymentRecoveryBanner attemptType="data_direct" onRecovered={() => refreshUser()} />

        {/* Purchase flow card */}
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
                <p className="text-xs text-muted-foreground">Purchase data bundles for single or multiple recipients</p>
                {isSuperAgent && <div className="mt-1.5 flex flex-wrap items-center gap-2"><SuperAgentBadge /><span className="text-[11px] text-muted-foreground">Special Super Agent prices applied</span></div>}
              </div>
              {user?.wallet_balance !== undefined && (
                <div className="ml-auto hidden sm:flex">
                  <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${accent.btnPrimary}`}>
                    Wallet: {formatGHS(user.wallet_balance)}
                  </span>
                </div>
              )}
            </div>
            </>
          );
        })()}

        <div className="p-5 sm:p-6 space-y-5">
        {/* Step 1: Network Selection */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2">
            <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${selectedNetwork ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>1</span>
            <span className="text-sm font-medium text-foreground">Select Network</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {availableNetworks.map(n => {
              const isSelected = selectedNetwork === n;
              const accent = getNetworkAccent(n);
              return (
                <button
                  key={n}
                  onClick={() => { setSelectedNetwork(n); setSelectedBundle(''); setBulkOrders([]); }}
                  className={`
                    relative flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 px-2 py-2.5 rounded-xl border text-xs sm:text-sm font-medium min-w-0
                    transition-all duration-200 cursor-pointer
                    ${isSelected
                      ? accent.tabActive
                      : `border-border bg-card text-muted-foreground ${accent.tabHover}`
                    }
                  `}
                >
                  {networkLogos[n] && (
                    <img src={networkLogos[n]} alt={n} className="w-5 h-5 rounded-full object-cover" />
                  )}
                  {n}
                </button>
              );
            })}
          </div>

          {/* Network OFF â€” delivery halted notice */}
          {/* Halted banner removed */}

          {/* MTN Notice â€” collapsible */}
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
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

        {/* Order Form */}
        {selectedNetwork && availableBundles.length > 0 && (
          <>
            {/* Mode Toggle â€” flat with network accent */}
            <div className="flex items-center rounded-lg bg-muted/60 p-0.5 w-fit">
              <button
                onClick={() => setBulkMode(false)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${!bulkMode ? (selectedNetwork ? getNetworkAccent(selectedNetwork).toggleActive : 'bg-primary text-primary-foreground shadow-sm') : 'text-muted-foreground hover:text-foreground'}`}
              >
                Single
              </button>
              <button
                onClick={() => setBulkMode(true)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${bulkMode ? (selectedNetwork ? getNetworkAccent(selectedNetwork).toggleActive : 'bg-primary text-primary-foreground shadow-sm') : 'text-muted-foreground hover:text-foreground'}`}
              >
                Bulk
              </button>
            </div>

            {bulkMode ? (
              <section className="glass-card p-5 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${selectedNetwork ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>2</span>
                  <span className="text-sm font-medium text-foreground">Add Orders</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  One per line: <span className="font-mono text-foreground">024XXXXXXX 2GB</span>
                </p>
                <textarea
                  placeholder={"0241234567 2GB\n0551234567 5GB\n0271234567 1GB"}
                  value={bulkInput}
                  onChange={e => setBulkInput(e.target.value)}
                  className="w-full h-28 rounded-lg bg-input border border-border p-3 text-sm text-foreground font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">
                    Sizes: {availableBundles.map(b => fmtSize(b.size)).join(', ')}
                  </p>
                  <Button size="sm" variant="outline" onClick={handleAddBulkLines} disabled={!bulkInput.trim()}>
                    Add Orders
                  </Button>
                </div>

                {bulkOrders.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-medium text-foreground">{bulkOrders.length} order{bulkOrders.length > 1 ? 's' : ''}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {Object.entries(bulkNetworkSummary.counts).map(([net, count]) => (
                          <span
                            key={net}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${net === selectedNetwork ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}
                          >
                            {net}: {count}
                          </span>
                        ))}
                        {bulkNetworkSummary.unknown > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-destructive/15 text-destructive">
                            Unknown: {bulkNetworkSummary.unknown}
                          </span>
                        )}
                      </div>
                      <button onClick={() => setBulkOrders([])} className="text-xs text-destructive hover:underline flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Clear
                      </button>
                    </div>
                    {bulkMismatches.length > 0 && (
                      <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-[11px] text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          {bulkMismatches.length} number{bulkMismatches.length > 1 ? 's do' : ' does'} not belong to {selectedNetwork}. Remove or replace them â€” mixed-network batches will be rejected.
                          <button
                            onClick={() => setBulkOrders(prev => prev.filter(o => o.detectedNetwork === selectedNetwork))}
                            className="ml-2 underline font-semibold"
                          >
                            Remove all mismatches
                          </button>
                        </span>
                      </div>
                    )}
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {bulkOrders.map((order, idx) => {
                        const mismatch = order.detectedNetwork !== selectedNetwork;
                        return (
                          <div
                            key={order.id}
                            className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-xs ${mismatch ? 'bg-destructive/10 border border-destructive/30' : 'bg-muted/50'}`}
                          >
                            <span className="text-muted-foreground w-5">{idx + 1}.</span>
                            <span className={`font-mono flex-1 ${mismatch ? 'text-destructive' : 'text-foreground'}`}>{order.phone}</span>
                            {mismatch && (
                              <span className="text-[10px] font-semibold text-destructive bg-destructive/15 px-1.5 py-0.5 rounded mr-2">
                                {order.detectedNetwork || 'Unknown'}
                              </span>
                            )}
                            <span className="text-foreground font-medium mx-2">{order.bundleLabel}</span>
                            <span className="text-primary font-medium mr-2">{formatGHS(order.price)}</span>
                            <button onClick={() => removeBulkOrder(order.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <>
                {/* Step 2: Phone */}
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${stepComplete.network ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>2</span>
                    <span className="text-sm font-medium text-foreground">Recipient Number</span>
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="0241234567"
                      value={phone}
                      onChange={e => setPhone(normalizePhone(e.target.value))}
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
                  {!networkWarning && <MtnVerifyBadge phone={phone} network={selectedNetwork} onReadyChange={setMtnReady} />}
                </section>

                {/* Step 3: Bundle */}
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${stepComplete.phone ? getNetworkAccent(selectedNetwork).stepBadge : 'bg-muted text-muted-foreground'}`}>3</span>
                    <span className="text-sm font-medium text-foreground">Select Bundle Size</span>
                  </div>
                  <div role="radiogroup" aria-label="Bundle size" className="grid grid-cols-3 gap-2">
                    {(showAllBundles ? availableBundles : availableBundles.slice(0, 6)).map(b => {
                      return (
                        <BundleTile key={b.id} network={selectedNetwork} size={fmtSize(b.size)} price={formatGHS(b.price)} isAvailable={(b as any).is_available !== false}
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
              </>
            )}

            {/* Wallet balance indicator */}
            {totalAmount > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Wifi className="w-3 h-3" /> Balance: <span className={canAfford ? 'text-success font-medium' : 'text-destructive font-medium'}>{formatGHS(user?.wallet_balance || 0)}</span></span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 3-min cancel window</span>
              </div>
            )}

            {/* Primary CTA â€” network colored */}
            <Button
              onClick={handleOrder}
              disabled={!hasItems || checkingDuplicates || !mtnReady}
              className={`w-full h-12 text-[15px] font-semibold border-0 rounded-[10px] transition-all duration-200 ease-in-out gap-2.5 ${selectedNetwork ? getNetworkAccent(selectedNetwork).btnPlaceOrder : 'bg-primary text-primary-foreground shadow-[0_4px_10px_rgba(0,0,0,0.15)]'}`}
            >
              {checkingDuplicates || !mtnReady ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {!mtnReady ? 'Checking MTN numberâ€¦' : 'Checking...'}</>
              ) : (
                <><ShoppingCart className="w-4.5 h-4.5" /> Place Order</>
              )}
            </Button>
          </>
        )}

        {selectedNetwork && availableBundles.length === 0 && !loadingPrices && (
          <div className="rounded-xl border border-border bg-card p-5 text-center">
            <Package className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No bundles available for {selectedNetwork} at the moment.</p>
          </div>
        )}

        </div>
        </Card>

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
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedNetwork} Data Bundle{bulkMode ? ` Â· ${bulkOrders.length} recipients` : ''}</p>
                  </div>
                </div>
              </div>
              <AlertDialogDescription asChild>
                <div className="space-y-5 pt-2">
                  {bulkMode ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">You are about to send <strong className="text-foreground">{bulkOrders.length} {selectedNetwork} bundle{bulkOrders.length > 1 ? 's' : ''}</strong>.</p>
                      <div className="max-h-32 overflow-y-auto space-y-1 text-xs rounded-lg bg-muted/40 p-2.5">
                        {bulkOrders.map((o, i) => (
                          <div key={o.id} className="flex justify-between">
                            <span>{i + 1}. {o.phone} â€” {o.bundleLabel}</span>
                            <span className="font-medium">{formatGHS(o.price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Order Summary */}
                      <div className={`rounded-2xl border overflow-hidden ${getNetworkAccent(selectedNetwork).summaryBox}`}>
                        <div className={`px-4 py-2.5 border-b ${getNetworkAccent(selectedNetwork).summaryHead}`}>
                          <span className="text-xs font-semibold uppercase tracking-wider">Order Summary</span>
                        </div>
                        <div className="px-4 py-3 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Network</span>
                            <span className="text-sm font-medium text-foreground">{selectedNetwork}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Bundle</span>
                            <span className="text-sm font-medium text-foreground">{fmtSize(selectedBundleData?.size || '')}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">Recipient</span>
                            <span className="text-sm font-semibold font-mono tracking-wide text-foreground">{formatPhoneSpaced(phone)}</span>
                          </div>
                          <div className="border-t border-border/60 pt-3 flex justify-between items-baseline">
                            <span className="text-sm font-semibold text-foreground">Total Amount</span>
                            <span className={`text-xl font-bold ${getNetworkAccent(selectedNetwork).totalText}`}>{formatGHS(totalAmount)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  {networkWarning && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive">{networkWarning}</p>
                    </div>
                  )}
                  {bulkMode && (
                    <div className="flex justify-between font-bold text-foreground pt-1 border-t border-border">
                      <span>Total</span>
                      <span className="text-primary">{formatGHS(totalAmount)}</span>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="pt-2 flex-col gap-2 sm:flex-col">
              <div className="grid grid-cols-2 gap-2 items-start">
              {/* Pay with Wallet */}
              <div className="space-y-1">
                <AlertDialogAction
                  onClick={confirmWalletOrder}
                  disabled={!canAfford}
                  className={`w-full h-11 px-2 border-0 font-semibold gap-1.5 text-sm rounded-[10px] ${selectedNetwork ? getNetworkAccent(selectedNetwork).btnWallet : 'bg-primary text-primary-foreground'}`}
                >
                  <Wallet className="w-4 h-4 shrink-0" /> Pay with Wallet
                </AlertDialogAction>
                {!canAfford && totalAmount > 0 && (
                  <p className="text-[10px] text-destructive text-center">Insufficient wallet balance</p>
                )}
              </div>

              {/* Pay with Paystack */}
              <div className="w-full space-y-1">
                {paystackFailed ? (
                  <Button variant="outline" onClick={retryLoad} className="w-full h-11 gap-1.5 px-2 text-sm" type="button">
                    <RefreshCw className="w-4 h-4" /> Retry
                  </Button>
                ) : (
                  <AlertDialogAction
                    onClick={confirmPaystackOrder}
                    disabled={!paystackReady}
                    className="w-full h-11 px-2 font-semibold gap-1.5 text-sm rounded-[10px] transition-all duration-200 !bg-none !bg-emerald-600 hover:!bg-emerald-700 text-white hover:text-white border-0 shadow-none"
                  >
                    {!paystackReady ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</>
                    ) : (
                      <><CreditCard className="w-4 h-4 shrink-0" /> Pay with Paystack</>
                    )}
                  </AlertDialogAction>
                )}
              </div>
              </div>

              <AlertDialogCancel className="w-full mt-0.5 border-border text-muted-foreground hover:text-foreground hover:bg-muted/60">Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </CustomerLayout>
  );
}

