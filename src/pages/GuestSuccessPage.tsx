import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, AlertTriangle, ExternalLink, Copy, UserPlus, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatGHS } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/contexts/ThemeContext';
import { getNetworkAccent, formatPhoneSpaced } from '@/lib/network-colors';
import logo from '@/assets/logo.png';
import mtnLogo from '@/assets/mtn-logo.png';
import atLogo from '@/assets/at-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';

const networkLogos: Record<string, string> = { MTN: mtnLogo, AirtelTigo: atLogo, Telecel: telecelLogo };
const fmtSize = (s: string) => { const up = s.toUpperCase(); return /GB/.test(up) ? up : `${up}GB`; };

interface OrderInfo {
  order_id: string;
  short_id: string;
  grace_period_ends_at: string;
  tracking_token?: string;
  recipient_phone?: string;
  bundle_size?: string;
  total_amount?: number;
}

export default function GuestSuccessPage() {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const token = searchParams.get('token') || '';
  const network = searchParams.get('network') || '';
  const bundle = searchParams.get('bundle') || '';
  const phone = searchParams.get('phone') || '';
  const amount = Number(searchParams.get('amount') || 0);
  const graceEnds = searchParams.get('grace_ends') || '';
  const isPartial = searchParams.get('partial') === '1';

  const orders: OrderInfo[] = useMemo(() => {
    try {
      const raw = searchParams.get('orders');
      if (raw) return JSON.parse(raw);
    } catch {}

    const shortId = searchParams.get('short_id') || '';
    if (shortId) {
      return [{
        order_id: '',
        short_id: shortId,
        grace_period_ends_at: graceEnds,
        tracking_token: token,
        recipient_phone: phone,
        bundle_size: bundle,
        total_amount: amount,
      }];
    }
    return [];
  }, [searchParams, graceEnds, token, phone, bundle, amount]);

  const trackingUrl = token ? `${window.location.origin}/guest/track?token=${token}` : '';

  // AFA / Checker success — lightweight branch
  const kind = searchParams.get('kind') || 'order';
  const shortIdParam = searchParams.get('short_id') || '';
  if (kind === 'afa' || kind === 'checker') {
    let codes: Array<{ serial_number: string; pin: string }> = [];
    if (kind === 'checker' && shortIdParam) {
      try { codes = JSON.parse(sessionStorage.getItem(`checker_codes_${shortIdParam}`) || '[]'); } catch {}
    }
    const trackHref = token
      ? `/guest/track?token=${token}`
      : shortIdParam
        ? `/guest/track?short_id=${shortIdParam}`
        : '/guest/track';
    return (
      <div className="min-h-screen premium-app-shell py-10 px-4">
        <div className="max-w-md mx-auto space-y-4">
          <Card className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle className="w-7 h-7 text-success" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold">
                {kind === 'afa' ? 'AFA Registration Request Submitted' : 'Result Checker Purchased'}
              </h2>
              {kind === 'afa' && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Your MTN AFA registration request was received. We'll process it shortly and notify you by SMS once it's complete.
                </p>
              )}
              <div className="mt-3 inline-flex flex-col items-center bg-muted/40 border border-border rounded-lg px-4 py-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reference</span>
                <span className="font-mono text-sm font-semibold text-primary">{shortIdParam}</span>
              </div>
            </div>
            {kind === 'checker' && codes.length > 0 && (
              <div className="text-left space-y-2 border-t border-border/60 pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Your codes</p>
                {codes.map((c, i) => (
                  <div key={i} className="rounded-lg bg-muted/40 border border-border p-2.5 text-sm font-mono">
                    <div>Serial: {c.serial_number}</div>
                    <div>PIN: {c.pin}</div>
                  </div>
                ))}
              </div>
            )}
            {kind === 'afa' && (
              <div className="text-left text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 space-y-1.5">
                <p className="font-semibold text-foreground">How to track your registration:</p>
                <p>• Save your reference <span className="font-mono">{shortIdParam}</span></p>
                <p>• Use the Track Transaction page anytime to check status</p>
                <p>• You'll get an SMS when it's marked Registered or Rejected</p>
              </div>
            )}
            {trackingUrl && (
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(trackingUrl); toast({ title: 'Tracking link copied!' }); }} className="w-full gap-2">
                <Copy className="w-4 h-4" /> Copy tracking link
              </Button>
            )}
            <div className="flex gap-2 justify-center">
              <Link to="/"><Button variant="outline">Home</Button></Link>
              <Link to={trackHref}><Button className="gap-2"><ExternalLink className="w-3.5 h-3.5" /> Track Transaction</Button></Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const copyTrackingLink = () => {
    if (!trackingUrl) return;
    navigator.clipboard.writeText(trackingUrl).then(() => {
      toast({ title: 'Tracking link copied!' });
    });
  };

  return (
    <div className="min-h-screen premium-app-shell">
      <nav className="sticky top-0 z-50 premium-topbar border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="DATA360" className="w-8 h-8 rounded-xl object-cover" />
            <span className="font-display font-bold text-lg text-foreground">DATA360</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-6 max-w-lg">
        <div className="space-y-6">
          {/* Success header */}
          <div className="text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${isPartial ? 'bg-warning/10' : 'bg-success/10'}`}>
              {isPartial
                ? <AlertTriangle className="w-8 h-8 text-warning" />
                : <CheckCircle className="w-8 h-8 text-success" />}
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-1">
              {isPartial ? 'Order Partially Placed' : 'Order Placed Successfully!'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isPartial
                ? 'Some items could not be processed. Please check details below.'
                : 'Your data bundle order has been submitted.'}
            </p>
          </div>

          {/* Order cards */}
          {orders.map((order, idx) => (
            <Card key={order.short_id || idx} className="overflow-hidden rounded-[22px] shadow-xl shadow-foreground/[0.05] border-border/60">
              <div className={getNetworkAccent(network).topBar} />
              <div className={`px-5 py-3 border-b border-border/40 ${getNetworkAccent(network).headerGlow}`}>
                <span className={`text-xs font-bold uppercase tracking-wider ${getNetworkAccent(network).iconText}`}>Order Details</span>
              </div>
              <div className="px-5 py-4 space-y-5">
                {/* Network */}
                <div className="flex items-center gap-2.5">
                  {networkLogos[network] && (
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${getNetworkAccent(network).logoRing}`}>
                      <img src={networkLogos[network]} alt={network} className="w-6 h-6 rounded-full object-cover" />
                    </div>
                  )}
                  <div>
                    <span className="text-sm font-semibold text-foreground">{network}</span>
                    <span className="text-xs text-muted-foreground block">Data Bundle</span>
                  </div>
                </div>

                {/* Detail rows */}
                <div className="space-y-3">
                  {order.short_id && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Order ID</span>
                      <span className="font-mono text-primary font-semibold">{order.short_id}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Bundle</span>
                    <span className="text-foreground font-medium">{fmtSize(order.bundle_size || bundle)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Recipient</span>
                    <span className="text-foreground font-medium font-mono tracking-wide">{formatPhoneSpaced(order.recipient_phone || phone)}</span>
                  </div>
                  <div className="border-t border-border/60 pt-3 flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-foreground">Amount</span>
                    <span className={`text-xl font-extrabold ${getNetworkAccent(network).totalText}`}>{formatGHS(order.total_amount || amount)}</span>
                  </div>
                </div>

                {/* Grace period countdown */}
                {order.grace_period_ends_at && (
                  <div className="border-t border-border/50 pt-4">
                    <div className="rounded-xl bg-muted/30 border border-border/60 p-3.5">
                      <GuestCountdown graceEndsAt={order.grace_period_ends_at} />
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}

          {/* Tracking link */}
          {trackingUrl && (
            <Card className="p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">📍 Track Your Order</p>
              <p className="text-xs text-muted-foreground">Save this link to check your order status anytime:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted/50 rounded-lg px-3 py-2 text-foreground font-mono truncate border border-border/50">
                  {trackingUrl}
                </code>
                <Button variant="outline" size="icon" onClick={copyTrackingLink} className="shrink-0">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <Link to={`/guest/track?token=${token}`}>
                <Button variant="outline" size="sm" className="w-full gap-2 mt-1">
                  <ExternalLink className="w-3.5 h-3.5" /> Open Tracking Page
                </Button>
              </Link>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Link to="/guest-buy">
              <Button className="w-full gradient-primary text-primary-foreground border-0">
                Buy More Data
              </Button>
            </Link>
            <Link to="/auth">
              <Button variant="outline" className="w-full gap-2">
                <UserPlus className="w-4 h-4" /> Create Account for Order History
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

/* Simple read-only countdown for guests */
function GuestCountdown({ graceEndsAt }: { graceEndsAt: string }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const expMs = Date.parse(graceEndsAt);
    if (!Number.isFinite(expMs)) return;

    const tick = () => setRemaining(Math.max(0, Math.floor((expMs - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [graceEndsAt]);

  if (remaining <= 0) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <CheckCircle className="w-3.5 h-3.5 text-success" />
        Order is being processed
      </p>
    );
  }

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Your order is in the processing queue.</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Processing begins in</span>
        <span className="text-sm font-mono font-bold text-info">{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
      </div>
    </div>
  );
}
