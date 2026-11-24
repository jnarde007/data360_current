import { useState, useEffect } from 'react';
import { useSearchParams, Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatGHS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/contexts/ThemeContext';
import { Search, Loader2, CheckCircle, Clock, AlertTriangle, XCircle, Sun, Moon, Phone, ShoppingCart, ChevronRight, Hash } from 'lucide-react';
import logo from '@/assets/logo.png';
import mtnTrackLogo from '@/assets/mtn-logo.png';
import atTrackLogo from '@/assets/at-logo.png';
import telecelTrackLogo from '@/assets/telecel-logo.png';
import { getNetworkAccent, formatPhoneSpaced } from '@/lib/network-colors';
const trackLogos: Record<string, string> = { MTN: mtnTrackLogo, AirtelTigo: atTrackLogo, Telecel: telecelTrackLogo };
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';

const statusConfig: Record<string, { icon: any; label: string; color: string }> = {
  pending_confirmation: { icon: Clock, label: 'Awaiting Processing', color: 'text-info' },
  pending: { icon: Clock, label: 'Queued for Delivery', color: 'text-info' },
  processing: { icon: Loader2, label: 'Processing', color: 'text-warning' },
  delivered: { icon: CheckCircle, label: 'Delivered', color: 'text-success' },
  completed: { icon: CheckCircle, label: 'Completed', color: 'text-success' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-destructive' },
  rejected: { icon: XCircle, label: 'Rejected', color: 'text-destructive' },
  customer_cancelled: { icon: XCircle, label: 'Cancelled', color: 'text-muted-foreground' },
  cancelled_before_processing: { icon: XCircle, label: 'Cancelled', color: 'text-muted-foreground' },
  submitted: { icon: Clock, label: 'Submitted', color: 'text-info' },
  registered: { icon: CheckCircle, label: 'Registered', color: 'text-success' },
};

interface ListItem {
  kind: 'order' | 'afa' | 'checker';
  short_id: string;
  service: string;
  status: string;
  status_label: string;
  created_at: string;
  amount: number;
  tracking_token?: string;
  masked_phone?: string;
  store_slug?: string;
}

interface TrackResult {
  kind?: 'order' | 'afa' | 'checker';
  short_id: string;
  network?: string;
  bundle_size?: string;
  recipient_phone?: string;
  quantity?: number;
  delivery_mode?: string;
  total_amount: number;
  status: string;
  status_label: string;
  created_at: string;
  tracking_token?: string;
  full_name?: string;
  registration_phone?: string;
  location?: string;
  payment_method?: string;
  payment_status?: string;
  admin_note?: string;
  product_name?: string;
  exam_type?: string;
  codes?: Array<{ serial_number: string; pin: string }>;
  store_slug?: string;
}

export default function GuestTrackPage() {
  const [searchParams] = useSearchParams();
  const { slug: storeSlugFromPath } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const tokenFromUrl = searchParams.get('token') || '';
  const storeSlugFromQuery = searchParams.get('store') || '';
  const storeSlug = storeSlugFromPath || storeSlugFromQuery || '';

  const [mode, setMode] = useState<'reference' | 'phone'>('reference');
  const [reference, setReference] = useState(tokenFromUrl);
  const [phoneInput, setPhoneInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackResult | null>(null);
  const [list, setList] = useState<ListItem[] | null>(null);
  const [error, setError] = useState('');
  const [storeBrand, setStoreBrand] = useState<{ name: string; logo_url: string } | null>(null);

  useEffect(() => {
    if (!storeSlug) { setStoreBrand(null); return; }
    (async () => {
      const { data } = await supabase.rpc('get_public_store' as any, { p_slug: storeSlug });
      const s: any = data;
      if (s) {
        setStoreBrand({ name: s.name, logo_url: s.logo_url || '' });
        try {
          document.title = `Track order — ${s.name}`;
          if (s.logo_url) {
            document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(el => el.parentNode?.removeChild(el));
            const icon = document.createElement('link');
            icon.rel = 'icon';
            icon.href = s.logo_url;
            document.head.appendChild(icon);
          }
        } catch {}
      }
    })();
  }, [storeSlug]);

  useEffect(() => {
    if (!storeSlugFromPath && storeSlugFromQuery) {
      const token = searchParams.get('token');
      const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
      navigate(`/store/${encodeURIComponent(storeSlugFromQuery)}/track${suffix}`, { replace: true });
      return;
    }
    if (tokenFromUrl) {
      lookup({ tracking_token: tokenFromUrl });
    }
  }, [tokenFromUrl, storeSlug, storeSlugFromPath, storeSlugFromQuery]);

  const lookup = async (body: Record<string, any>) => {
    setLoading(true);
    setError('');
    setResult(null);
    setList(null);
    try {
      const payload = storeSlug ? { ...body, store_slug: storeSlug } : body;
      const res = await supabase.functions.invoke('guest-track-order', { body: payload });
      if (res.error) throw new Error(res.error.message);
      const data = res.data as any;
      if (data?.error) {
        setError(data.error);
      } else if (data?.kind === 'list') {
        if (!data.results || data.results.length === 0) {
          setError('No transactions found for that phone number in the last 90 days.');
        } else {
          setList(data.results);
        }
      } else {
        if (!storeSlug && data?.store_slug && data?.tracking_token) {
          navigate(`/store/${encodeURIComponent(data.store_slug)}/track?token=${encodeURIComponent(data.tracking_token)}`, { replace: true });
        }
        setResult(data);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to look up order');
    } finally {
      setLoading(false);
    }
  };

  const handleReferenceSearch = () => {
    const v = reference.trim();
    if (!v) return;
    // Long string → tracking token; short → short_id
    if (v.length >= 20) lookup({ tracking_token: v });
    else lookup({ reference: v });
  };

  const handlePhoneSearch = () => {
    if (!phoneInput.trim()) return;
    if (!isValidPhone(phoneInput)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'warning' });
      return;
    }
    lookup({ buyer_phone: normalizePhone(phoneInput), phone_only: true });
  };

  const openItem = (item: ListItem) => {
    if (item.tracking_token) lookup({ tracking_token: item.tracking_token });
    else lookup({ reference: item.short_id });
  };

  const resetSearch = () => {
    setResult(null);
    setList(null);
    setError('');
  };

  const statusInfo = result ? (statusConfig[result.status] || { icon: Clock, label: result.status_label || result.status, color: 'text-muted-foreground' }) : null;
  const StatusIcon = statusInfo?.icon;
  const isAfa = result?.kind === 'afa';
  const isChecker = result?.kind === 'checker';

  return (
    <div className="min-h-screen premium-app-shell">
      <nav className="sticky top-0 z-50 premium-topbar border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          {storeSlug ? (
            <Link to={`/store/${storeSlug}`} className="flex items-center gap-2 min-w-0">
              {storeBrand?.logo_url ? (
                <img src={storeBrand.logo_url} alt={storeBrand.name} className="w-8 h-8 rounded-xl object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4 text-primary" />
                </div>
              )}
              <span className="font-display font-bold text-lg text-foreground truncate">{storeBrand?.name || 'Store'}</span>
            </Link>
          ) : (
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="DATA360" className="w-8 h-8 rounded-xl object-cover" />
              <span className="font-display font-bold text-lg text-foreground">DATA360</span>
            </Link>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            {storeSlug ? (
              <Link to={`/store/${storeSlug}`}>
                <Button variant="outline" size="sm" className="text-sm gap-1.5">
                  <ShoppingCart className="w-3.5 h-3.5" /> Shop
                </Button>
              </Link>
            ) : (
              <Link to="/guest-buy">
                <Button variant="outline" size="sm" className="text-sm gap-1.5">
                  <ShoppingCart className="w-3.5 h-3.5" /> Buy Data
                </Button>
              </Link>
            )}
          </div>
        </div>
      </nav>

      <main className="premium-page-content container mx-auto px-4 py-6 max-w-lg">
        <div className="space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-display font-bold text-foreground">Track Your Order</h1>
            <p className="text-sm text-muted-foreground mt-1">Check the status of your order or registration.</p>
          </div>

          {/* Search card */}
          {!result && !list && (
            <Card className="p-5 space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('reference')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === 'reference' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'}`}
                >
                  Track by Reference
                </button>
                <button
                  onClick={() => setMode('phone')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === 'phone' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'}`}
                >
                  Track by Phone Number
                </button>
              </div>

              {mode === 'reference' ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Enter order reference"
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                      className="pl-9"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleReferenceSearch(); }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    e.g. <span className="font-mono">ORD-1234</span>, <span className="font-mono">AFA-56</span>, or <span className="font-mono">CHK-78</span>
                  </p>
                  <Button onClick={handleReferenceSearch} disabled={loading || !reference.trim()} className="w-full gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Look Up Transaction
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="0201234567"
                      value={phoneInput}
                      onChange={e => setPhoneInput(normalizePhone(e.target.value))}
                      className="pl-9"
                      type="tel"
                      inputMode="numeric"
                     
                      onKeyDown={(e) => { if (e.key === 'Enter') handlePhoneSearch(); }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Shows your recent transactions from the last 90 days.
                  </p>
                  <Button onClick={handlePhoneSearch} disabled={loading || !phoneInput.trim()} className="w-full gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Find My Transactions
                  </Button>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
            </Card>
          )}

          {loading && !result && !list && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Phone result list */}
          {list && (
            <div className="space-y-3">
              <Card className="p-4 rounded-[20px] shadow-xl shadow-foreground/[0.05] border-border/60">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-foreground">Recent transactions</p>
                  <span className="text-xs text-muted-foreground">{list.length} found</span>
                </div>
                <div className="space-y-2">
                  {list.map((item) => {
                    const cfg = statusConfig[item.status] || { color: 'text-muted-foreground' };
                    return (
                      <button
                        key={`${item.kind}-${item.short_id}`}
                        onClick={() => openItem(item)}
                        className="w-full text-left rounded-2xl border border-border/60 bg-card shadow-sm hover:-translate-y-[1px] hover:shadow-md transition-all p-3.5 flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">{item.service}</span>
                            <span className={`text-[11px] font-medium ${cfg.color}`}>{item.status_label}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                            <span className="font-mono">{item.short_id}</span>
                            <span>·</span>
                            <span>{new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {new Date(item.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            <span>·</span>
                            <span className="font-semibold text-primary">{formatGHS(item.amount)}</span>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </Card>
              <Button variant="outline" onClick={resetSearch} className="w-full">
                Track Another Transaction
              </Button>
            </div>
          )}

          {/* Single result */}
          {result && (
            <div className="space-y-4">
              <Card className="p-5 rounded-[20px] shadow-xl shadow-foreground/[0.05] border-border/60 overflow-hidden">
                <div className="flex items-center gap-3 mb-4">
                  {StatusIcon && (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      result.status === 'delivered' || result.status === 'registered' || result.status === 'completed' ? 'bg-success/10' :
                      result.status === 'failed' || result.status === 'rejected' ? 'bg-destructive/10' :
                      'bg-info/10'
                    }`}>
                      <StatusIcon className={`w-5 h-5 ${statusInfo?.color} ${result.status === 'processing' ? 'animate-spin' : ''}`} />
                    </div>
                  )}
                  <div>
                    <p className={`text-sm font-semibold ${statusInfo?.color}`}>{statusInfo?.label}</p>
                    <p className="text-xs text-muted-foreground">Reference {result.short_id}</p>
                  </div>
                </div>

                {isAfa ? (
                  <div className="space-y-3 border-t border-border/50 pt-4">
                    <Row label="Service" value="MTN AFA Registration" />
                    <Row label="Name on number" value={result.full_name || '—'} />
                    <Row label="Phone being registered" value={result.registration_phone || '—'} mono />
                    <Row label="Amount paid" value={formatGHS(result.total_amount)} bold />
                    <Row label="Payment method" value={result.payment_method || '—'} />
                    <Row label="Payment status" value={result.payment_status || '—'} />
                    <Row label="Registration status" value={result.status_label} />
                    <Row label="Submitted" value={new Date(result.created_at).toLocaleString()} />
                    {result.admin_note && (
                      <div className="pt-2 border-t border-border/40">
                        <p className="text-xs text-muted-foreground mb-1">Admin note</p>
                        <p className="text-sm text-foreground bg-muted/40 rounded-lg px-3 py-2 italic">{result.admin_note}</p>
                      </div>
                    )}
                  </div>
                ) : isChecker ? (
                  <div className="space-y-3 border-t border-border/50 pt-4">
                    <Row label="Service" value={result.product_name || 'Result Checker'} />
                    {result.exam_type && <Row label="Exam type" value={result.exam_type} />}
                    <Row label="Quantity" value={String(result.quantity || 1)} />
                    <Row label="Amount" value={formatGHS(result.total_amount)} bold />
                    <Row label="Ordered" value={new Date(result.created_at).toLocaleString()} />
                    {result.codes && result.codes.length > 0 && (
                      <div className="pt-2 border-t border-border/40 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase">Your codes</p>
                        {result.codes.map((c, i) => (
                          <div key={i} className="rounded-lg bg-muted/40 border border-border p-2.5 text-sm font-mono">
                            <div>Serial: {c.serial_number}</div>
                            <div>PIN: {c.pin}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-border/50 pt-4">
                    {result.network && (
                      <div className={`flex items-center gap-3 rounded-2xl border p-3 ${getNetworkAccent(result.network).summaryBox}`}>
                        {trackLogos[result.network] && (
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getNetworkAccent(result.network).logoRing}`}>
                            <img src={trackLogos[result.network]} alt={result.network} className="w-7 h-7 rounded-lg object-cover" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-foreground">{result.network} {result.bundle_size}</p>
                          <p className="text-xs font-mono tracking-wide text-muted-foreground">{formatPhoneSpaced(result.recipient_phone)}</p>
                        </div>
                        <p className={`text-base font-extrabold ${getNetworkAccent(result.network).totalText}`}>{formatGHS(result.total_amount)}</p>
                      </div>
                    )}
                    <Row label="Bundle" value={result.bundle_size || '—'} />
                    <Row label="Recipient" value={formatPhoneSpaced(result.recipient_phone) || '—'} mono />
                    <Row label="Amount" value={formatGHS(result.total_amount)} bold />
                    <Row label="Ordered" value={new Date(result.created_at).toLocaleString()} />
                  </div>
                )}
              </Card>

              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={resetSearch}>
                  {isAfa || isChecker ? 'Track Another Transaction' : 'Search Another Order'}
                </Button>
                {isAfa ? (
                  <Link to={storeSlug ? `/store/${storeSlug}` : '/'}>
                    <Button className="w-full gradient-primary text-primary-foreground border-0">
                      {storeSlug ? 'Back to Store' : 'Back to Services'}
                    </Button>
                  </Link>
                ) : isChecker ? (
                  <Link to={storeSlug ? `/store/${storeSlug}` : '/guest-checker'}>
                    <Button className="w-full gradient-primary text-primary-foreground border-0">
                      {storeSlug ? 'Back to Store' : 'Buy Another Checker'}
                    </Button>
                  </Link>
                ) : (
                  <Link to={storeSlug ? `/store/${storeSlug}` : '/guest-buy'}>
                    <Button className="w-full gradient-primary text-primary-foreground border-0">
                      {storeSlug ? 'Buy More from Store' : 'Buy More Data'}
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Row({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-3 text-sm">
      <span className="text-muted-foreground text-xs sm:text-sm">{label}</span>
      <span className={`text-foreground break-words ${mono ? 'font-mono' : ''} ${bold ? 'font-bold text-primary' : 'font-medium'}`}>{value}</span>
    </div>
  );
}
