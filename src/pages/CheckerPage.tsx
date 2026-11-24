import { useState, useEffect, useCallback } from 'react';
import { CustomerLayout } from '@/components/CustomerLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import { Loader2, ShoppingCart, ClipboardCopy, Check, FileSearch, History, Minus, Plus, Wallet, CreditCard, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { motion } from 'framer-motion';
import { usePaystack, PAYSTACK_FEE_RATE } from '@/hooks/use-paystack';
import { PaymentRecoveryBanner } from '@/components/PaymentRecoveryBanner';
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';

interface CheckerProduct {
  id: string;
  name: string;
  exam_type: string;
  price: number;
  status: string;
}

interface PurchaseRecord {
  id: string;
  short_id: string;
  product_id: string;
  product_name?: string;
  checker_inventory_id: string | null;
  amount: number;
  quantity: number;
  status: string;
  sms_status: string;
  sms_phone: string;
  created_at: string;
  serial_number?: string;
  pin?: string;
  payment_method?: string;
}

interface CheckerCode {
  serial_number: string;
  pin: string;
}

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

export default function CheckerPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const { paystackReady, paystackFailed, retryLoad, openPaystack } = usePaystack();
  const [products, setProducts] = useState<CheckerProduct[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CheckerProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [smsPhone, setSmsPhone] = useState('');
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [resultDialog, setResultDialog] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<any>(null);
  const [copiedField, setCopiedField] = useState('');
  const [verifyingPaystack, setVerifyingPaystack] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [prodRes, purchRes] = await Promise.all([
        (supabase as any).from('checker_products_public').select('id, name, exam_type, price, status').eq('status', 'active').order('name'),
        supabase.from('checker_purchases').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      setProducts((prodRes.data || []) as CheckerProduct[]);
      setPurchases((purchRes.data || []) as PurchaseRecord[]);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const openBuyDialog = (product: CheckerProduct) => {
    setSelectedProduct(product);
    setQuantity(1);
    setSmsPhone(user?.phone || '');
    setConfirmDialog(true);
  };

  const totalCost = selectedProduct ? selectedProduct.price * quantity : 0;
  const paystackFee = Math.round(totalCost * PAYSTACK_FEE_RATE * 100) / 100;
  const paystackTotal = Math.round((totalCost + paystackFee) * 100) / 100;

  const handleWalletPurchase = async () => {
    if (!selectedProduct || !user?.id) return;
    if (smsPhone && !isValidPhone(smsPhone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }
    if ((user?.wallet_balance || 0) < totalCost) {
      toast({ title: 'Insufficient balance', description: `You need ${formatGHS(totalCost)} to purchase ${quantity} checker(s). Please top up your wallet first.`, variant: 'destructive' });
      return;
    }
    setBuying(true);
    try {
      const { data, error } = await supabase.rpc('purchase_checker', {
        p_customer_id: user.id,
        p_product_id: selectedProduct.id,
        p_sms_phone: smsPhone,
        p_quantity: quantity,
      });
      if (error) throw error;
      const result = data as any;
      if (!result.success) {
        toast({ title: 'Purchase failed', description: result.error, variant: 'destructive' });
        return;
      }
      setPurchaseResult(result);
      setConfirmDialog(false);
      setResultDialog(true);
      loadData();
      refreshUser();
      toast({ title: 'Purchase successful', description: `${result.quantity} checker code(s) for ${result.product_name} ready.` });

      // Fire-and-forget: send SMS if phone provided
      if (smsPhone && result.codes) {
        const codes = Array.isArray(result.codes) ? result.codes : [];
        const codeLines = codes.map((c: any) => `Serial: ${c.serial_number}, PIN: ${c.pin}`).join('\n');
        const smsMessage = `Your ${result.product_name || 'Results Checker'} code(s):\n${codeLines}\n\nOrder: ${result.short_id}\nThank you for your purchase.`;
        supabase.functions.invoke('send-sms', {
          body: {
            to: smsPhone,
            message: smsMessage,
            event_type: 'checker_purchase',
            related_purchase_id: result.purchase_id,
            customer_id: user.id,
            idempotency_key: `checker_${result.purchase_id}`,
          },
        }).then(async () => {
          await supabase.from('checker_purchases' as any).update({ sms_status: 'sent' }).eq('id', result.purchase_id);
        }).catch(() => {
          supabase.from('checker_purchases' as any).update({ sms_status: 'failed' }).eq('id', result.purchase_id);
        });
      }
    } catch (e: any) {
      toast({ title: 'Purchase failed', description: e.message, variant: 'destructive' });
    } finally {
      setBuying(false);
    }
  };

  const handlePaystackPurchase = async () => {
    if (!selectedProduct || !user?.id) return;
    if (smsPhone && !isValidPhone(smsPhone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }
    if (!paystackReady) {
      return;
    }

    // Generate unique reference and create pre-checkout record
    const paystackRef = `cd_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;

    try {
      await supabase.from('payment_attempts' as any).insert({
        customer_id: user.id,
        paystack_reference: paystackRef,
        attempt_type: 'checker_direct',
        status: 'pending',
        amount: totalCost,
        metadata: {
          product_id: selectedProduct.id,
          product_name: selectedProduct.name,
          quantity,
          sms_phone: smsPhone,
          paystack_total: paystackTotal,
          paystack_fee: paystackFee,
        },
        event_log: [{ type: 'checkout_initiated', timestamp: new Date().toISOString() }],
      });
    } catch (e) {
      console.error('Failed to create payment_attempt:', e);
    }

    setBuying(true);
    const opened = openPaystack({
      email: user.email || '',
      amountGHS: paystackTotal,
      reference: paystackRef,
      metadata: {
        customer_id: user.id,
        product_id: selectedProduct.id,
        quantity,
        type: 'checker_direct',
        custom_fields: [
          { display_name: 'Type', variable_name: 'type', value: 'checker_direct' },
          { display_name: 'Product', variable_name: 'product_id', value: selectedProduct.id },
          { display_name: 'Quantity', variable_name: 'quantity', value: String(quantity) },
        ],
      },
      onSuccess: async (reference) => {
        setConfirmDialog(false);
        setVerifyingPaystack(true);
        try {
          const res = await supabase.functions.invoke('paystack-direct-checker', {
            body: {
              reference,
              customer_id: user.id,
              product_id: selectedProduct.id,
              quantity,
              sms_phone: smsPhone,
            },
          });
          const result = res.data as any;
          if (res.error) throw new Error(res.error.message || 'Verification failed');
          if (result?.error) throw new Error(result.error);

          setPurchaseResult(result);
          setResultDialog(true);
          loadData();
          toast({ title: 'Purchase successful', description: `${result.quantity} checker code(s) for ${result.product_name} ready.` });
        } catch (e: any) {
          toast({ title: 'Payment verification failed', description: e.message, variant: 'destructive' });
        } finally {
          setVerifyingPaystack(false);
          setBuying(false);
        }
      },
      onCancel: () => {
        setBuying(false);
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

    if (!opened) setBuying(false);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 2000);
  };

  const copyAllCodes = (codes: CheckerCode[]) => {
    const text = codes.map((c, i) => `${i + 1}. Serial: ${c.serial_number} | PIN: ${c.pin}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedField('all');
    setTimeout(() => setCopiedField(''), 2000);
  };

  const getProductName = (id: string) => products.find(p => p.id === id)?.name || 'Results Checker';

  const wassce = products.filter(p => p.exam_type === 'wassce');
  const bece = products.filter(p => p.exam_type === 'bece');

  if (loading) {
    return <CustomerLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></CustomerLayout>;
  }

  if (verifyingPaystack) {
    return (
      <CustomerLayout>
        <div className="flex flex-col items-center justify-center py-20 space-y-5 animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-display font-bold text-foreground">Verifying your payment...</h2>
            <p className="text-sm text-muted-foreground">Please wait while we confirm your purchase.</p>
          </div>
        </div>
      </CustomerLayout>
    );
  }

  const ProductGroup = ({ title, items }: { title: string; items: CheckerProduct[] }) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map(product => (
            <Card key={product.id} className="overflow-hidden">
              <CardContent className="p-4 lg:p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-display font-semibold text-foreground text-base">{product.name}</h3>
                    <Badge variant="secondary" className="mt-1">{product.exam_type.toUpperCase()}</Badge>
                  </div>
                  <p className="text-lg font-bold text-primary">{formatGHS(product.price)}</p>
                </div>
                <Button className="w-full" onClick={() => openBuyDialog(product)}>
                  <ShoppingCart className="w-4 h-4 mr-2" /> Buy Now
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  return (
    <CustomerLayout>
      <div className="space-y-5 lg:space-y-8">
        <PaymentRecoveryBanner attemptType="checker_direct" onRecovered={() => { loadData(); refreshUser(); }} />
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Results Checker</h1>
          <p className="text-muted-foreground text-xs lg:text-sm mt-0.5">Purchase WASSCE & BECE checker codes</p>
        </motion.div>

        <Tabs defaultValue="buy">
          <TabsList>
            <TabsTrigger value="buy" className="gap-1.5"><FileSearch className="w-3.5 h-3.5" /> Buy Checker</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5"><History className="w-3.5 h-3.5" /> My Purchases</TabsTrigger>
          </TabsList>

          <TabsContent value="buy" className="mt-4">
            {products.length === 0 ? (
              <div className="text-center py-12">
                <FileSearch className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No checker products available at the moment.</p>
              </div>
            ) : (
              <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
                className="space-y-6">
                <ProductGroup title="WASSCE" items={wassce} />
                <ProductGroup title="BECE" items={bece} />
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {purchases.length === 0 ? (
              <div className="text-center py-12">
                <History className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No purchases yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {purchases.map(p => (
                  <Card key={p.id}>
                    <CardContent className="p-3 lg:p-4 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{getProductName(p.product_id)}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.short_id}{(p.quantity || 1) > 1 && ` · qty ${p.quantity}`}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-sm font-semibold">{formatGHS(p.amount)}</p>
                        <div className="flex items-center gap-1 mt-1 justify-end">
                          <Badge variant={p.status === 'completed' ? 'default' : 'secondary'}>{p.status}</Badge>
                          {p.payment_method === 'paystack_direct' && (
                            <Badge variant="outline" className="text-[10px]">Paystack</Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirm Purchase Dialog */}
      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="sm:max-w-md gap-0">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-lg font-bold">Confirm Purchase</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-5">
              {/* Product + Quantity + Pricing — single card */}
              <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-primary/[0.02] overflow-hidden">
                <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/20 text-primary">
                  <span className="text-xs font-semibold uppercase tracking-wider">Order Summary</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Product</span>
                    <span className="text-sm font-medium text-foreground">{selectedProduct.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Unit Price</span>
                    <span className="text-sm font-medium text-foreground">{formatGHS(selectedProduct.price)}</span>
                  </div>

                  {/* Quantity — inline row */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Quantity</span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" className="h-7 w-7 rounded-md"
                        onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1}>
                        <Minus className="w-3.5 h-3.5" />
                      </Button>
                      <Input type="number" min={1} max={50} value={quantity}
                        onChange={e => setQuantity(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                        className="w-14 h-7 text-center text-sm font-semibold px-1" />
                      <Button variant="outline" size="icon" className="h-7 w-7 rounded-md"
                        onClick={() => setQuantity(q => Math.min(50, q + 1))} disabled={quantity >= 50}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Total */}
                  <div className="border-t border-border/60 pt-3 flex justify-between items-baseline">
                    <span className="text-sm font-semibold text-foreground">Total Amount</span>
                    <span className="text-lg font-bold text-primary">{formatGHS(totalCost)}</span>
                  </div>
                </div>
              </div>

              {/* SMS phone */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Phone for SMS delivery (optional)</Label>
                <Input
                  value={smsPhone}
                  onChange={e => setSmsPhone(normalizePhone(e.target.value))}
                  placeholder="0XXXXXXXXX"
                  className="h-9"
                  type="tel"
                  inputMode="numeric"
                 
                />
                <p className="text-[10px] text-muted-foreground/70">Leave empty to view the code(s) on screen only.</p>
              </div>
            </div>
          )}

          {/* Payment actions */}
          <div className="flex flex-col gap-2 pt-5">
            <div className="grid grid-cols-2 gap-2 items-start">
            {/* Pay with Wallet */}
            <div className="space-y-1">
              <Button
                onClick={handleWalletPurchase}
                disabled={buying || (user?.wallet_balance || 0) < totalCost}
                className="w-full h-11 px-2 gap-1.5 text-sm font-semibold rounded-[10px] text-white"
              >
                {buying ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><Wallet className="w-4 h-4" /> Pay with Wallet</>
                )}
              </Button>
              {(user?.wallet_balance || 0) < totalCost && (
                <p className="text-[10px] text-destructive text-center">Insufficient wallet balance</p>
              )}
            </div>

            {/* Pay with Paystack */}
            <div className="space-y-1">
              {paystackFailed ? (
                <Button variant="outline" onClick={retryLoad} className="w-full h-11 px-2 gap-1.5 text-sm">
                  <RefreshCw className="w-4 h-4" /> Retry
                </Button>
              ) : (
                <Button
                  onClick={handlePaystackPurchase}
                  disabled={buying || !paystackReady}
                  className="w-full h-11 px-2 gap-1.5 text-sm font-semibold rounded-[10px] transition-all duration-200 !bg-none !bg-emerald-600 hover:!bg-emerald-700 text-white hover:text-white border-0 shadow-none"
                >
                  {!paystackReady ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</>
                  ) : (
                    <><CreditCard className="w-4 h-4 shrink-0" /> Pay with Paystack</>
                  )}
                </Button>
              )}
            </div>
            </div>

            <Button variant="outline" size="sm" onClick={() => setConfirmDialog(false)} className="w-full mt-0.5 border-border text-muted-foreground hover:text-foreground hover:bg-muted/60">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Result Dialog */}
      <Dialog open={resultDialog} onOpenChange={setResultDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>🎉 Checker Purchased!</DialogTitle>
          </DialogHeader>
          {purchaseResult && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {purchaseResult.quantity > 1
                  ? `Your ${purchaseResult.quantity} checker codes for `
                  : 'Your checker code for '}
                <strong>{purchaseResult.product_name}</strong>:
              </p>

              {purchaseResult.codes && purchaseResult.codes.length > 1 && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => copyAllCodes(purchaseResult.codes)}>
                  {copiedField === 'all' ? <Check className="w-4 h-4 mr-1 text-success" /> : <ClipboardCopy className="w-4 h-4 mr-1" />}
                  Copy All Codes
                </Button>
              )}

              <div className="glass-card p-4 space-y-3 max-h-72 overflow-y-auto">
                {(purchaseResult.codes || []).map((code: CheckerCode, idx: number) => (
                  <div key={idx}>
                    {purchaseResult.codes.length > 1 && (
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase mb-1">Code {idx + 1}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Serial Number</p>
                        <p className="font-mono font-bold text-foreground text-sm">{code.serial_number}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(code.serial_number, `serial-${idx}`)}>
                        {copiedField === `serial-${idx}` ? <Check className="w-4 h-4 text-success" /> : <ClipboardCopy className="w-4 h-4" />}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div>
                        <p className="text-xs text-muted-foreground">PIN</p>
                        <p className="font-mono font-bold text-foreground text-sm">{code.pin}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(code.pin, `pin-${idx}`)}>
                        {copiedField === `pin-${idx}` ? <Check className="w-4 h-4 text-success" /> : <ClipboardCopy className="w-4 h-4" />}
                      </Button>
                    </div>
                    {idx < purchaseResult.codes.length - 1 && <div className="h-px bg-border mt-3" />}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Reference: {purchaseResult.short_id} • Amount: {formatGHS(purchaseResult.amount)}
                {purchaseResult.quantity > 1 && ` • Qty: ${purchaseResult.quantity}`}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResultDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CustomerLayout>
  );
}
