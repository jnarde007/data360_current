import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  PartyPopper, LayoutDashboard, Package, ImageIcon, Phone,
  ShoppingBag, Wallet, Share2, Sparkles, Copy, ChevronLeft, ChevronRight, X,
} from 'lucide-react';

interface TourStore {
  id: string;
  name: string;
  slug: string;
  status: string;
  onboarding_completed?: boolean | null;
  onboarding_step?: number | null;
}

interface Props {
  store: TourStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: (tab: string) => void;
  onCompleted?: () => void;
}

type Step = {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  title: string;
  body: React.ReactNode;
  cta?: { label: string; tab?: string; action?: 'copy-link' | 'finish' };
};

export function StoreOnboardingTour({ store, open, onOpenChange, onNavigate, onCompleted }: Props) {
  const { toast } = useToast();
  const startStep = Math.min(Math.max(store.onboarding_step || 0, 0), 8);
  const [step, setStep] = useState(startStep);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setStep(Math.min(Math.max(store.onboarding_step || 0, 0), 8)); }, [open, store.id]);

  // Mark started_at the first time the tour opens for this store.
  useEffect(() => {
    if (!open) return;
    if (store.onboarding_step && store.onboarding_step > 0) return;
    supabase.from('stores' as any).update({ onboarding_started_at: new Date().toISOString() }).eq('id', store.id).then(() => {});
  }, [open, store.id]);

  const storeUrl = `https://buy-data360.com/store/${store.slug}`;

  const steps: Step[] = useMemo(() => [
    {
      icon: PartyPopper, iconClass: 'text-primary bg-primary/10',
      title: `Welcome to your store, ${store.name}!`,
      body: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>This is your store dashboard — your command center for selling data bundles and exam result checkers at your own prices.</p>
          <p>In the next minute we'll show you how to <strong className="text-foreground">add products, share your store, take orders</strong> and <strong className="text-foreground">track your earnings</strong>.</p>
        </div>
      ),
    },
    {
      icon: LayoutDashboard, iconClass: 'text-info bg-info/10',
      title: 'Get to know your dashboard',
      body: (
        <ul className="space-y-2 text-sm">
          <li className="flex gap-3"><ShoppingBag className="w-4 h-4 mt-0.5 text-success shrink-0" /><span><strong>Orders</strong> — every sale your customers make appears here in real time.</span></li>
          <li className="flex gap-3"><Package className="w-4 h-4 mt-0.5 text-amber shrink-0" /><span><strong>Products</strong> — pick which bundles you sell and set your selling price.</span></li>
          <li className="flex gap-3"><Wallet className="w-4 h-4 mt-0.5 text-primary shrink-0" /><span><strong>Financial Overview & Transactions</strong> — see your earnings and withdraw to Mobile Money.</span></li>
          <li className="flex gap-3"><Phone className="w-4 h-4 mt-0.5 text-foreground shrink-0" /><span><strong>Settings</strong> — store name, contact details, logo and banner.</span></li>
        </ul>
      ),
    },
    {
      icon: Package, iconClass: 'text-amber bg-amber/10',
      title: 'Add your first product',
      body: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Open the <strong className="text-foreground">Products</strong> tab to pick which data bundles or result checkers to sell.</p>
          <p>For each product you'll set:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your <strong className="text-foreground">selling price</strong> (must be above cost — the difference is your profit)</li>
            <li>Whether it's <strong className="text-foreground">active</strong> on your storefront</li>
          </ul>
        </div>
      ),
      cta: { label: 'Open Products', tab: 'products' },
    },
    {
      icon: ImageIcon, iconClass: 'text-purple bg-purple/10',
      title: 'Make your store look professional',
      body: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>In <strong className="text-foreground">Settings</strong>, upload a clean <strong className="text-foreground">logo</strong> and an eye-catching <strong className="text-foreground">banner</strong>.</p>
          <p>Tip: clear, high-resolution images dramatically improve trust and conversion. Aim for square logos and wide banners (16:9).</p>
        </div>
      ),
      cta: { label: 'Open Settings', tab: 'settings' },
    },
    {
      icon: Phone, iconClass: 'text-success bg-success/10',
      title: 'Add your contact details',
      body: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>In <strong className="text-foreground">Settings → Store Profile</strong>, add:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">WhatsApp number</strong> — customers can chat you directly</li>
            <li><strong className="text-foreground">Email address</strong> — for receipts and support</li>
            <li><strong className="text-foreground">Group / social link</strong> (optional) — promotions and updates</li>
          </ul>
        </div>
      ),
      cta: { label: 'Open Settings', tab: 'settings' },
    },
    {
      icon: ShoppingBag, iconClass: 'text-info bg-info/10',
      title: 'How orders work',
      body: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>When a customer buys from your store, the order appears in the <strong className="text-foreground">Orders</strong> tab and we fulfill it automatically.</p>
          <p>You'll get an <strong className="text-foreground">in-app notification</strong> (bell icon, top right) for every new order and status change — no SMS spam for individual sales.</p>
        </div>
      ),
      cta: { label: 'Open Orders', tab: 'orders' },
    },
    {
      icon: Wallet, iconClass: 'text-primary bg-primary/10',
      title: 'How your earnings flow',
      body: (
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
          <li><strong className="text-foreground">Order placed</strong> → profit shows as <em>pending</em>.</li>
          <li><strong className="text-foreground">Order delivered</strong> → profit unlocks into <em>available balance</em>.</li>
          <li><strong className="text-foreground">Withdraw anytime</strong> from Financial Overview straight to Mobile Money (GHS 20 minimum).</li>
        </ol>
      ),
      cta: { label: 'Open Financial Overview', tab: 'financial' },
    },
    {
      icon: Share2, iconClass: 'text-accent bg-accent/10',
      title: 'Share your store to get your first sale',
      body: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>This is your storefront link — anyone can buy from it instantly:</p>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 font-mono text-xs sm:text-sm break-all">
            <span className="flex-1 text-foreground">{storeUrl}</span>
          </div>
          <p>Share it on <strong className="text-foreground">WhatsApp status, Instagram bio, Facebook, TikTok</strong> — wherever your audience hangs out.</p>
        </div>
      ),
      cta: { label: 'Copy store link', action: 'copy-link' },
    },
    {
      icon: Sparkles, iconClass: 'text-amber bg-amber/10',
      title: "You're all set!",
      body: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>You can re-open this tutorial anytime from <strong className="text-foreground">Settings → Help & Tutorial</strong>.</p>
          <p>Now go add your first product and share your link — your first sale is closer than you think.</p>
        </div>
      ),
      cta: { label: 'Add a product', tab: 'products', action: 'finish' },
    },
  ], [store.name, storeUrl]);

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const progressPct = ((step + 1) / steps.length) * 100;

  const persistStep = async (nextStep: number, completed = false) => {
    setSaving(true);
    try { window.localStorage.setItem(`store_tour_seen_v1:${store.id}`, '1'); } catch { /* noop */ }
    if (completed) {
      try { window.localStorage.setItem(`store_tour_done_v1:${store.id}`, '1'); } catch { /* noop */ }
    }
    await supabase.from('stores' as any).update({
      onboarding_step: nextStep,
      onboarding_completed: completed,
    }).eq('id', store.id);
    setSaving(false);
  };

  const handleNext = async () => {
    if (isLast) { await finish(); return; }
    const next = step + 1;
    setStep(next);
    persistStep(next);
  };

  const handleBack = () => { if (step > 0) setStep(step - 1); };

  const handleSkip = async () => {
    await persistStep(step, true);
    onOpenChange(false);
    onCompleted?.();
    toast({ title: 'Tutorial skipped', description: 'You can restart it anytime from Settings → Help & Tutorial.' });
  };

  const finish = async () => {
    await persistStep(steps.length - 1, true);
    onOpenChange(false);
    onCompleted?.();
    toast({ title: "You're ready to sell 🎉", description: 'Add your first product and start sharing your store.' });
  };

  const handleCta = async () => {
    if (!current.cta) return;
    if (current.cta.action === 'copy-link') {
      navigator.clipboard.writeText(storeUrl).catch(() => {});
      toast({ title: 'Link copied' });
    }
    if (current.cta.tab && onNavigate) {
      onNavigate(current.cta.tab);
    }
    if (current.cta.action === 'finish') {
      await finish();
    }
  };

  const Icon = current.icon;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { persistStep(step); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step {step + 1} of {steps.length}
            </span>
            <button
              type="button"
              onClick={handleSkip}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Skip tour
            </button>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        <div className="px-6 pt-5 pb-2">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${current.iconClass}`}>
            <Icon className="w-6 h-6" />
          </div>
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl">{current.title}</DialogTitle>
            <DialogDescription asChild>
              <div>{current.body}</div>
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 pt-4 flex flex-wrap items-center gap-2 border-t mt-4">
          <Button variant="ghost" size="sm" onClick={handleBack} disabled={step === 0 || saving}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {current.cta && (
            <Button variant="outline" size="sm" onClick={handleCta} disabled={saving}>
              {current.cta.action === 'copy-link' ? <Copy className="w-4 h-4 mr-1.5" /> : null}
              {current.cta.label}
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" onClick={handleNext} disabled={saving}>
            {isLast ? 'Finish' : (<>Next <ChevronRight className="w-4 h-4 ml-1" /></>)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
