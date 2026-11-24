import { useState, useEffect, useCallback, useRef } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { formatGHS } from '@/lib/utils';
import { Loader2, Plus, Upload, Package, ShoppingCart, AlertTriangle, Trash2, FileText, Eye } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ConfirmDialog';

interface CheckerProduct {
  id: string;
  name: string;
  exam_type: string;
  price: number;
  cost_price: number;
  status: string;
  created_at: string;
}

interface InventoryItem {
  id: string;
  product_id: string;
  serial_number: string;
  pin: string;
  status: string;
  batch_id: string;
  imported_at: string;
  sold_at: string | null;
  assigned_to: string | null;
  purchase_id: string | null;
}

interface Purchase {
  id: string;
  short_id: string;
  customer_id: string;
  product_id: string;
  checker_inventory_id: string | null;
  amount: number;
  quantity: number;
  status: string;
  sms_status: string;
  sms_phone: string;
  created_at: string;
}

export default function AdminCheckersPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<CheckerProduct[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [productDialog, setProductDialog] = useState(false);
  const [importDialog, setImportDialog] = useState(false);
  const [editProduct, setEditProduct] = useState<CheckerProduct | null>(null);
  const [saving, setSaving] = useState(false);

  // Purchase detail dialog
  const [detailDialog, setDetailDialog] = useState(false);
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null);
  const [detailCodes, setDetailCodes] = useState<InventoryItem[]>([]);

  // Product form
  const [formName, setFormName] = useState('');
  const [formExamType, setFormExamType] = useState<string>('wassce');
  const [formPrice, setFormPrice] = useState<number | ''>('');
  const [formCostPrice, setFormCostPrice] = useState<number | ''>('');
  const [formStatus, setFormStatus] = useState('active');

  // Import form
  const [importProductId, setImportProductId] = useState('');
  const [importBatchId, setImportBatchId] = useState('');
  const [importText, setImportText] = useState('');
  const [importParsed, setImportParsed] = useState<{ serial: string; pin: string }[]>([]);
  const [importReviewing, setImportReviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Stats
  const [stats, setStats] = useState({ totalProducts: 0, totalAvailable: 0, totalSold: 0, totalPurchases: 0 });

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<CheckerProduct | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [prodRes, invRes, purchRes] = await Promise.all([
        supabase.from('checker_products').select('*').order('created_at', { ascending: false }),
        supabase.from('checker_inventory').select('*').order('imported_at', { ascending: false }).limit(500),
        supabase.from('checker_purchases').select('*').order('created_at', { ascending: false }).limit(200),
      ]);
      const prods = (prodRes.data || []) as CheckerProduct[];
      const inv = (invRes.data || []) as InventoryItem[];
      const purch = (purchRes.data || []) as Purchase[];
      setProducts(prods);
      setInventory(inv);
      setPurchases(purch);
      setStats({
        totalProducts: prods.length,
        totalAvailable: inv.filter(i => i.status === 'available').length,
        totalSold: inv.filter(i => i.status === 'sold').length,
        totalPurchases: purch.length,
      });
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openNewProduct = () => {
    setEditProduct(null);
    setFormName('');
    setFormExamType('wassce');
    setFormPrice('');
    setFormCostPrice('');
    setFormStatus('active');
    setProductDialog(true);
  };

  const openEditProduct = (p: CheckerProduct) => {
    setEditProduct(p);
    setFormName(p.name);
    setFormExamType(p.exam_type);
    setFormPrice(p.price);
    setFormCostPrice(p.cost_price);
    setFormStatus(p.status);
    setProductDialog(true);
  };

  const saveProduct = async () => {
    if (!formName.trim() || !formPrice) {
      toast({ title: 'Error', description: 'Name and price are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editProduct) {
        const { error } = await supabase.from('checker_products').update({
          name: formName.trim(), exam_type: formExamType as any, price: Number(formPrice),
          cost_price: Number(formCostPrice || 0), status: formStatus, updated_at: new Date().toISOString(),
        }).eq('id', editProduct.id);
        if (error) throw error;
        toast({ title: 'Product updated' });
      } else {
        const { error } = await supabase.from('checker_products').insert({
          name: formName.trim(), exam_type: formExamType as any, price: Number(formPrice),
          cost_price: Number(formCostPrice || 0), status: formStatus,
        });
        if (error) throw error;
        toast({ title: 'Product created' });
      }
      setProductDialog(false);
      loadData();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id: string) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from('checker_products').delete().eq('id', id);
      if (error) toast({
        title: 'Cannot delete product',
        description: error.code === '23503'
          ? 'This checker has past sales or stock linked to it. Set its status to Inactive to hide it from buyers instead.'
          : error.message,
        variant: 'destructive', duration: 8000,
      });
      else { toast({ title: 'Product deleted' }); loadData(); }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // --- Import logic ---
  const parseCheckerText = (text: string): { serial: string; pin: string }[] => {
    const results: { serial: string; pin: string }[] = [];
    const seen = new Set<string>();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // Strategy 1: structured per-line (serial<delim>pin)
    for (const line of lines) {
      const parts = line.split(/[\t,|;]+|\s{2,}/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const serial = parts[0].replace(/[^0-9A-Za-z]/g, '');
        const pin = parts[1].replace(/[^0-9A-Za-z]/g, '');
        if (/^\d{6,}$/.test(serial) && /^\d{6,}$/.test(pin)) {
          const key = serial + ':' + pin;
          if (!seen.has(key)) { seen.add(key); results.push({ serial, pin }); }
        }
      }
    }
    if (results.length > 0) return results;

    // Strategy 2: labelled tokens (Serial: 123 ... PIN: 456)
    const labelRe = /(?:serial(?:\s*(?:no|number|#))?)\s*[:#-]?\s*(\d{6,})[\s\S]{0,80}?(?:pin|password|pwd)\s*[:#-]?\s*(\d{6,})/gi;
    let m: RegExpExecArray | null;
    while ((m = labelRe.exec(text)) !== null) {
      const key = m[1] + ':' + m[2];
      if (!seen.has(key)) { seen.add(key); results.push({ serial: m[1], pin: m[2] }); }
    }
    if (results.length > 0) return results;

    // Strategy 3: fallback — pair consecutive long numeric tokens
    const nums = text.match(/\d{6,}/g) || [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const key = nums[i] + ':' + nums[i + 1];
      if (!seen.has(key)) { seen.add(key); results.push({ serial: nums[i], pin: nums[i + 1] }); }
    }
    return results;
  };

  const extractPdfText = async (file: File): Promise<string> => {
    const pdfjs: any = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    let out = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items as any[];
      // Group items by y-coordinate to reconstruct visual lines
      const rows = new Map<number, { x: number; s: string }[]>();
      for (const it of items) {
        const y = Math.round(it.transform[5]);
        const x = it.transform[4];
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y)!.push({ x, s: it.str });
      }
      const ys = [...rows.keys()].sort((a, b) => b - a);
      for (const y of ys) {
        const line = rows.get(y)!.sort((a, b) => a.x - b.x).map(r => r.s).join(' ').trim();
        if (line) out += line + '\n';
      }
      out += '\n';
    }
    return out;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let text = '';
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        toast({ title: 'Reading PDF…', description: 'Extracting serial/pin pairs.' });
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }
      setImportText(text);
      const parsed = parseCheckerText(text);
      setImportParsed(parsed);
      if (parsed.length > 0) {
        setImportReviewing(true);
        toast({ title: 'Parsed', description: `${parsed.length} codes detected. Review before importing.` });
      } else {
        toast({ title: 'No data found', description: 'Could not parse serial/pin pairs. You can paste manually below.', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err?.message || 'Could not read file.', variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  const handlePasteImport = () => {
    const parsed = parseCheckerText(importText);
    setImportParsed(parsed);
    if (parsed.length > 0) setImportReviewing(true);
    else toast({ title: 'No data found', description: 'Could not parse serial/pin pairs from the pasted text.', variant: 'destructive' });
  };

  const confirmImport = async () => {
    if (!importProductId || importParsed.length === 0) return;
    setSaving(true);
    try {
      const batchId = importBatchId.trim() || `BATCH-${Date.now()}`;
      const rows = importParsed.map(item => ({
        product_id: importProductId,
        serial_number: item.serial,
        pin: item.pin,
        batch_id: batchId,
        status: 'available',
      }));
      const { error } = await supabase.from('checker_inventory').insert(rows);
      if (error) throw error;
      toast({ title: 'Import successful', description: `${rows.length} checker codes imported.` });
      setImportDialog(false);
      setImportText('');
      setImportParsed([]);
      setImportReviewing(false);
      loadData();
    } catch (e: any) {
      toast({ title: 'Import failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openPurchaseDetail = async (purchase: Purchase) => {
    setDetailPurchase(purchase);
    setDetailDialog(true);
    // Fetch linked inventory codes
    const { data } = await supabase.from('checker_inventory')
      .select('*')
      .eq('purchase_id', purchase.id)
      .order('imported_at', { ascending: true });
    setDetailCodes((data || []) as InventoryItem[]);
  };

  const getProductName = (id: string) => products.find(p => p.id === id)?.name || 'Unknown';
  const getAvailableCount = (productId: string) => inventory.filter(i => i.product_id === productId && i.status === 'available').length;

  if (loading) {
    return <AdminLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl lg:text-2xl font-display font-bold text-foreground">Results Checker</h1>
            <p className="text-sm text-muted-foreground">Manage checker products, inventory, and purchases</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setImportDialog(true); setImportReviewing(false); setImportText(''); setImportParsed([]); }}>
              <Upload className="w-4 h-4 mr-1" /> Import Stock
            </Button>
            <Button size="sm" onClick={openNewProduct}>
              <Plus className="w-4 h-4 mr-1" /> Add Product
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Products</p><p className="text-2xl font-bold">{stats.totalProducts}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Available Stock</p><p className="text-2xl font-bold text-success">{stats.totalAvailable}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Sold</p><p className="text-2xl font-bold text-primary">{stats.totalSold}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Purchases</p><p className="text-2xl font-bold">{stats.totalPurchases}</p></CardContent></Card>
        </div>

        <Tabs defaultValue="products">
          <TabsList>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="purchases">Purchases</TabsTrigger>
          </TabsList>

          <TabsContent value="products" className="space-y-3 mt-4">
            {products.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No products yet. Add your first checker product.</p>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {products.map(p => (
                  <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEditProduct(p)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-foreground">{p.name}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">{p.exam_type.toUpperCase()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>{p.status}</Badge>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex gap-4 mt-3 text-sm">
                        <span>Price: <strong>{formatGHS(p.price)}</strong></span>
                        <span>Cost: <strong>{formatGHS(p.cost_price)}</strong></span>
                        <span>Stock: <strong className={getAvailableCount(p.id) === 0 ? 'text-destructive' : 'text-success'}>{getAvailableCount(p.id)}</strong></span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inventory" className="mt-4">
            {inventory.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No inventory yet. Import checker codes above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-3">Product</th>
                      <th className="py-2 px-3">Serial</th>
                      <th className="py-2 px-3">PIN</th>
                      <th className="py-2 px-3">Batch</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Imported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map(item => (
                      <tr key={item.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-2 px-3 font-medium">{getProductName(item.product_id)}</td>
                        <td className="py-2 px-3 font-mono text-xs">{item.serial_number}</td>
                        <td className="py-2 px-3 font-mono text-xs">{item.pin}</td>
                        <td className="py-2 px-3 text-xs">{item.batch_id}</td>
                        <td className="py-2 px-3">
                          <Badge variant={item.status === 'available' ? 'default' : 'secondary'}>{item.status}</Badge>
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {new Date(item.imported_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="purchases" className="mt-4">
            {purchases.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No purchases yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-3">ID</th>
                      <th className="py-2 px-3">Product</th>
                      <th className="py-2 px-3">Qty</th>
                      <th className="py-2 px-3">Amount</th>
                      <th className="py-2 px-3">SMS</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map(p => (
                      <tr key={p.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-2 px-3 font-mono text-xs">{p.short_id}</td>
                        <td className="py-2 px-3">{getProductName(p.product_id)}</td>
                        <td className="py-2 px-3 font-semibold">{p.quantity || 1}</td>
                        <td className="py-2 px-3 font-semibold">{formatGHS(p.amount)}</td>
                        <td className="py-2 px-3">
                          <Badge variant={p.sms_status === 'sent' ? 'default' : p.sms_status === 'failed' ? 'destructive' : 'secondary'}>{p.sms_status}</Badge>
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={p.status === 'completed' ? 'default' : 'secondary'}>{p.status}</Badge>
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className="py-2 px-3">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPurchaseDetail(p)}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Product Dialog */}
      <Dialog open={productDialog} onOpenChange={setProductDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editProduct ? 'Edit Product' : 'New Checker Product'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Product Name</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. WASSCE Checker 2025" />
            </div>
            <div>
              <Label>Exam Type</Label>
              <Select value={formExamType} onValueChange={setFormExamType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wassce">WASSCE</SelectItem>
                  <SelectItem value="bece">BECE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Selling Price (GH₵)</Label>
                <Input type="number" value={formPrice} onChange={e => setFormPrice(e.target.value ? Number(e.target.value) : '')} placeholder="0.00" />
              </div>
              <div>
                <Label>Cost Price (GH₵)</Label>
                <Input type="number" value={formCostPrice} onChange={e => setFormCostPrice(e.target.value ? Number(e.target.value) : '')} placeholder="0.00" />
              </div>
            </div>
            {formPrice && formCostPrice ? (
              <p className="text-xs text-muted-foreground">
                Margin: <strong className={Number(formPrice) >= Number(formCostPrice) ? 'text-success' : 'text-destructive'}>
                  {formatGHS(Number(formPrice) - Number(formCostPrice))}
                </strong>
              </p>
            ) : null}
            <div>
              <Label>Status</Label>
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDialog(false)}>Cancel</Button>
            <Button onClick={saveProduct} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {editProduct ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Checker Codes</DialogTitle>
          </DialogHeader>
          {!importReviewing ? (
            <div className="space-y-4">
              <div>
                <Label>Product</Label>
                <Select value={importProductId} onValueChange={setImportProductId}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Batch ID (optional)</Label>
                <Input value={importBatchId} onChange={e => setImportBatchId(e.target.value)} placeholder="e.g. 2025-JAN-BATCH1" />
              </div>
              <div>
                <Label>Upload File (.txt, .csv)</Label>
                <Input ref={fileRef as any} type="file" accept=".txt,.csv,.pdf" onChange={handleFileUpload} />
                <p className="text-[10px] text-muted-foreground mt-1">CSV/TXT with serial and PIN columns. For PDF, copy-paste below.</p>
              </div>
              <div>
                <Label>Or Paste Data</Label>
                <Textarea
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder={"SERIAL1, PIN1\nSERIAL2, PIN2\n..."}
                  rows={6}
                />
                <Button size="sm" variant="outline" className="mt-2" onClick={handlePasteImport} disabled={!importText.trim() || !importProductId}>
                  Parse & Review
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <p className="text-sm font-medium">Review before import: {importParsed.length} checker codes found</p>
              </div>
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="py-1.5 px-3 text-left">#</th>
                      <th className="py-1.5 px-3 text-left">Serial</th>
                      <th className="py-1.5 px-3 text-left">PIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importParsed.slice(0, 50).map((item, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-1 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-1 px-3 font-mono">{item.serial}</td>
                        <td className="py-1 px-3 font-mono">{item.pin}</td>
                      </tr>
                    ))}
                    {importParsed.length > 50 && (
                      <tr><td colSpan={3} className="py-2 px-3 text-center text-muted-foreground">... and {importParsed.length - 50} more</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImportReviewing(false)}>Back</Button>
                <Button onClick={confirmImport} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Import {importParsed.length} Codes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Purchase Detail Dialog */}
      <Dialog open={detailDialog} onOpenChange={setDetailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase Details</DialogTitle>
          </DialogHeader>
          {detailPurchase && (
            <div className="space-y-4">
              <div className="glass-card p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono font-medium">{detailPurchase.short_id}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Product</span><span className="font-medium">{getProductName(detailPurchase.product_id)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Quantity</span><span className="font-semibold">{detailPurchase.quantity || 1}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total Amount</span><span className="font-bold text-primary">{formatGHS(detailPurchase.amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">SMS Phone</span><span>{detailPurchase.sms_phone || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">SMS Status</span><Badge variant="secondary">{detailPurchase.sms_status}</Badge></div>
              </div>
              {detailCodes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Assigned Checker Codes ({detailCodes.length})</p>
                  <div className="border rounded-lg max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b bg-muted/50"><th className="py-1.5 px-3 text-left">#</th><th className="py-1.5 px-3 text-left">Serial</th><th className="py-1.5 px-3 text-left">PIN</th></tr></thead>
                      <tbody>
                        {detailCodes.map((c, i) => (
                          <tr key={c.id} className="border-b border-border/30">
                            <td className="py-1 px-3 text-muted-foreground">{i + 1}</td>
                            <td className="py-1 px-3 font-mono">{c.serial_number}</td>
                            <td className="py-1 px-3 font-mono">{c.pin}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Delete product?"
        description={deleteTarget ? (
          <>This will also delete <strong>{deleteTarget.name}</strong> and all of its associated inventory. This action cannot be undone.</>
        ) : 'This action cannot be undone.'}
        confirmLabel="Delete Product"
        destructive
        loading={deleting}
        onConfirm={() => deleteTarget && deleteProduct(deleteTarget.id)}
      />
    </AdminLayout>
  );
}
