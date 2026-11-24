import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { formatGHS } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Search, Loader2, Eye, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileCard } from '@/components/MobileCard';
import { DetailViewDialog } from '@/components/DetailViewDialog';

interface PriceItem {
  id: string;
  network: string;
  product: string;
  size: string;
  price: number;
  cost_price: number;
}

const productTypes = ['Data', 'Airtime', 'AFA Registration'];
const networkNames = ['MTN', 'AirtelTigo', 'Telecel'];

export default function AdminPricingPage() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [items, setItems] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteItem, setDeleteItem] = useState<PriceItem | null>(null);
  const [editItem, setEditItem] = useState<PriceItem | null>(null);
  const [detailItem, setDetailItem] = useState<PriceItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('network');

  const [addNetwork, setAddNetwork] = useState('');
  const [addProduct, setAddProduct] = useState('');
  const [addSize, setAddSize] = useState('');
  const [addPrice, setAddPrice] = useState<number | ''>('');
  const [addCostPrice, setAddCostPrice] = useState<number | ''>('');

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const { data, error } = await supabase
        .from('price_items')
        .select('id, network, product, size, price, cost_price')
        .order('network');
      if (error) throw error;
      setItems((data || []).map(d => ({ ...d, price: Number(d.price), cost_price: Number((d as any).cost_price || 0) })));
    } catch {
      toast({ title: 'Unable to load pricing', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filtered = items.filter(item => {
    const q = searchQuery.toLowerCase();
    return !q || item.network.toLowerCase().includes(q) || item.product.toLowerCase().includes(q) || item.size.toLowerCase().includes(q);
  });

  /** Extract numeric value from size string for sorting (e.g. "1GB" → 1, "500MB" → 0.5) */
  const parseNumericSize = (size: string): number => {
    if (!size) return 0;
    const lower = size.toLowerCase().trim();
    const gbMatch = lower.match(/^([\d.]+)\s*gb$/);
    if (gbMatch) return parseFloat(gbMatch[1]);
    const mbMatch = lower.match(/^([\d.]+)\s*mb$/);
    if (mbMatch) return parseFloat(mbMatch[1]) / 1024;
    const numMatch = lower.match(/^([\d.]+)/);
    if (numMatch) return parseFloat(numMatch[1]);
    return 0;
  };

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'network') return a.network.localeCompare(b.network);
    if (sortBy === 'product') return a.product.localeCompare(b.product);
    if (sortBy === 'price') return a.price - b.price;
    return 0;
  });

  // Split: AFA Registration shown in its own dedicated section, separate from data bundles.
  const dataItems = sorted.filter(i => i.product !== 'AFA Registration');
  const afaItems = sorted.filter(i => i.product === 'AFA Registration');

  const grouped = dataItems.reduce<Record<string, PriceItem[]>>((acc, item) => {
    if (!acc[item.network]) acc[item.network] = [];
    acc[item.network].push(item);
    return acc;
  }, {});

  // Sort items within each network group by numeric bundle size ascending
  Object.values(grouped).forEach(netItems => {
    netItems.sort((a, b) => parseNumericSize(a.size) - parseNumericSize(b.size));
  });

  const isDuplicate = (network: string, product: string, size: string, excludeId?: string) => {
    return items.some(i =>
      i.network.toLowerCase() === network.toLowerCase() &&
      i.product.toLowerCase() === product.toLowerCase() &&
      i.size.toLowerCase() === size.toLowerCase() &&
      (!excludeId || i.id !== excludeId)
    );
  };

  const getProfitPercent = (price: number, cost: number) => {
    if (cost <= 0) return null;
    return ((price - cost) / cost * 100).toFixed(1);
  };

  const getPricingWarning = (price: number, cost: number) => {
    if (cost > 0 && price < cost) return { level: 'error' as const, text: 'Selling price is below cost — you will lose money on this item.' };
    if (cost > 0 && price > 0) {
      const pct = ((price - cost) / cost) * 100;
      if (pct > 0 && pct < 5) return { level: 'warn' as const, text: `Very low margin (${pct.toFixed(1)}%). Consider increasing the selling price.` };
    }
    return null;
  };

  const handleAdd = async () => {
    const numPrice = addPrice === '' ? 0 : addPrice;
    const numCostPrice = addCostPrice === '' ? 0 : addCostPrice;
    if (!addNetwork.trim() || !addProduct.trim() || numPrice <= 0) {
      toast({ title: 'Incomplete details', description: 'Please fill in Network, Product, and Selling Price to add an item.', variant: 'destructive' });
      return;
    }
    if (isDuplicate(addNetwork.trim(), addProduct.trim(), addSize.trim())) {
      toast({ title: 'Duplicate item', description: `A pricing item for ${addNetwork} — ${addProduct} ${addSize || ''} already exists.`.trim(), variant: 'destructive', duration: 6000 });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('price_items')
        .insert({ network: addNetwork.trim(), product: addProduct.trim(), size: addSize.trim(), price: numPrice, cost_price: numCostPrice })
        .select()
        .single();
      if (error) throw error;
      setItems(prev => [...prev, { ...data, price: Number(data.price), cost_price: Number((data as any).cost_price || 0) }]);
      setAddNetwork(''); setAddProduct(''); setAddSize(''); setAddPrice(''); setAddCostPrice('');
      toast({ title: 'Price item added', description: 'The new pricing item has been created successfully.', variant: 'success' });
    } catch {
      toast({ title: 'Failed to add item', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      const { error } = await supabase.from('price_items').delete().eq('id', deleteItem.id);
      if (error) throw error;
      setItems(prev => prev.filter(i => i.id !== deleteItem.id));
      toast({ title: 'Item deleted', description: 'The pricing item has been removed.', variant: 'success' });
    } catch (e: any) {
      toast({ title: 'Failed to delete item', description: e?.message || 'Something went wrong. Please try again.', variant: 'destructive', duration: 8000 });
    } finally {
      setDeleteItem(null);
    }
  };

  const handleEditSave = async () => {
    if (!editItem) return;
    try {
      const { error } = await supabase
        .from('price_items')
        .update({ product: editItem.product, size: editItem.size, price: editItem.price, cost_price: editItem.cost_price, updated_at: new Date().toISOString() })
        .eq('id', editItem.id);
      if (error) throw error;
      setItems(prev => prev.map(i => i.id === editItem.id ? editItem : i));
      toast({ title: 'Item updated', description: 'The pricing item has been saved.', variant: 'success' });
    } catch {
      toast({ title: 'Failed to update item', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setEditItem(null);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-display font-bold text-foreground">Pricing</h1>
        <p className="text-muted-foreground text-sm">Set selling prices and cost prices for networks and services.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card glow-border p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Set Prices</h2>
              <p className="text-xs text-muted-foreground">{items.length} item(s)</p>
            </div>
            <div className="flex gap-3 items-end">
              <div className="space-y-1 flex-1 sm:flex-initial">
                <Label className="text-xs text-muted-foreground">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-9 w-full sm:w-48" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sort</Label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-9 w-28 sm:w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="network">Network</SelectItem>
                    <SelectItem value="product">Product</SelectItem>
                    <SelectItem value="price">Price</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {Object.entries(grouped).map(([network, netItems]) => (
            <Collapsible key={network} defaultOpen>
              <div className="border border-border rounded-lg">
                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 sm:p-4 hover:bg-secondary/30 transition-colors rounded-t-lg">
                  <div>
                    <h3 className="font-bold text-foreground">{network}</h3>
                    <p className="text-xs text-muted-foreground">{netItems.length} item(s)</p>
                  </div>
                  <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {isMobile ? (
                    <div className="p-3 space-y-3">
                      {netItems.map(item => {
                        const margin = item.price - item.cost_price;
                        const profitPct = getProfitPercent(item.price, item.cost_price);
                        return (
                          <MobileCard
                            key={item.id}
                            fields={[
                              { label: 'Product', value: item.product },
                              { label: 'Data Size', value: item.size || '—' },
                              { label: 'Price', value: formatGHS(item.price) },
                              { label: 'Margin', value: `${formatGHS(margin)}${profitPct ? ` (${profitPct}%)` : ''}` },
                            ]}
                            action={
                              <div className="flex gap-2">
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDetailItem(item)}>
                                  <Eye className="w-3.5 h-3.5 mr-1" /> View
                                </Button>
                                <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground h-7 px-3 text-xs rounded-full" onClick={() => setEditItem({ ...item })}>Edit</Button>
                                <Button size="sm" variant="destructive" className="h-7 px-3 text-xs rounded-full" onClick={() => setDeleteItem(item)}>Delete</Button>
                              </div>
                            }
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-t border-border text-left">
                            <th className="px-4 py-2 font-medium text-muted-foreground">Product</th>
                            <th className="px-4 py-2 font-medium text-muted-foreground">Data Size</th>
                            <th className="px-4 py-2 font-medium text-muted-foreground">Cost Price</th>
                            <th className="px-4 py-2 font-medium text-muted-foreground">Selling Price</th>
                            <th className="px-4 py-2 font-medium text-muted-foreground">Margin / Profit</th>
                            <th className="px-4 py-2 font-medium text-muted-foreground">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {netItems.map(item => {
                            const margin = item.price - item.cost_price;
                            const profitPct = getProfitPercent(item.price, item.cost_price);
                            const warning = getPricingWarning(item.price, item.cost_price);
                            return (
                              <tr key={item.id} className={`border-t border-border/50 hover:bg-secondary/20 transition-colors ${warning?.level === 'error' ? 'bg-destructive/5' : ''}`}>
                                <td className="px-4 py-3 text-foreground">{item.product}</td>
                                <td className="px-4 py-3 text-primary font-medium">{item.size || '—'}</td>
                                <td className="px-4 py-3 text-muted-foreground">{formatGHS(item.cost_price)}</td>
                                <td className="px-4 py-3 text-foreground">{formatGHS(item.price)}</td>
                                <td className={`px-4 py-3 font-medium ${margin > 0 ? 'text-primary' : margin < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  <div className="flex items-center gap-1.5">
                                    {warning?.level === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                                    <span>{formatGHS(margin)}{profitPct ? ` (${profitPct}%)` : ''}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex gap-2">
                                    <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground h-7 px-3 text-xs rounded-full" onClick={() => setEditItem({ ...item })}>Edit</Button>
                                    <Button size="sm" variant="destructive" className="h-7 px-3 text-xs rounded-full" onClick={() => setDeleteItem(item)}>Delete</Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}

          {Object.keys(grouped).length === 0 && (
            <p className="text-center text-muted-foreground py-8">No data bundle items found</p>
          )}

          {/* ── Dedicated AFA Registration section (separate from MTN data bundles) ── */}
          <div className="border border-yellow-500/30 rounded-lg mt-4">
            <div className="flex items-center justify-between p-3 sm:p-4 bg-yellow-500/5 rounded-t-lg">
              <div>
                <h3 className="font-bold text-foreground">MTN AFA Registration</h3>
                <p className="text-xs text-muted-foreground">{afaItems.length} item(s) · Set the registration fee separately from data bundles.</p>
              </div>
            </div>
            {afaItems.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-6">No AFA pricing yet. Add one with product "AFA Registration".</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-border text-left">
                      <th className="px-4 py-2 font-medium text-muted-foreground">Network</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Label</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Cost Price</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Selling Price</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Margin</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {afaItems.map(item => {
                      const margin = item.price - item.cost_price;
                      const profitPct = getProfitPercent(item.price, item.cost_price);
                      return (
                        <tr key={item.id} className="border-t border-border/50 hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 text-foreground">{item.network}</td>
                          <td className="px-4 py-3 text-primary font-medium">{item.size || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatGHS(item.cost_price)}</td>
                          <td className="px-4 py-3 text-foreground">{formatGHS(item.price)}</td>
                          <td className={`px-4 py-3 font-medium ${margin > 0 ? 'text-primary' : margin < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {formatGHS(margin)}{profitPct ? ` (${profitPct}%)` : ''}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground h-7 px-3 text-xs rounded-full" onClick={() => setEditItem({ ...item })}>Edit</Button>
                              <Button size="sm" variant="destructive" className="h-7 px-3 text-xs rounded-full" onClick={() => setDeleteItem(item)}>Delete</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="glass-card glow-border p-6 space-y-4 h-fit">
          <h2 className="font-semibold text-foreground">Add Price Item</h2>
          <div className="space-y-1.5">
            <Label className="text-sm">Product</Label>
            <Select value={addProduct} onValueChange={(v) => {
              setAddProduct(v);
              if (v === 'AFA Registration') {
                setAddNetwork('MTN');
                setAddSize('Per Registration');
              } else if (addSize === 'Per Registration') {
                setAddSize('');
              }
            }}>
              <SelectTrigger><SelectValue placeholder="Data / Airtime / AFA Registration" /></SelectTrigger>
              <SelectContent>
                {productTypes.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            {addProduct === 'AFA Registration' && (
              <p className="text-[11px] text-muted-foreground">AFA Registration is locked to MTN with label "Per Registration" and appears only in the AFA section.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Network</Label>
            <Select value={addNetwork} onValueChange={setAddNetwork} disabled={addProduct === 'AFA Registration'}>
              <SelectTrigger><SelectValue placeholder="MTN / AirtelTigo / Telecel" /></SelectTrigger>
              <SelectContent>
                {networkNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">{addProduct === 'AFA Registration' ? 'Label' : 'Data Size'}</Label>
            <Input
              placeholder={addProduct === 'AFA Registration' ? 'Per Registration' : '1GB, 5GB...'}
              value={addSize}
              onChange={e => setAddSize(e.target.value)}
              disabled={addProduct === 'AFA Registration'}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Cost Price (GHS)</Label>
            <Input type="number" step="0.01" value={addCostPrice} onChange={e => setAddCostPrice(e.target.value === '' ? '' : parseFloat(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Selling Price (GHS)</Label>
            <Input type="number" step="0.01" value={addPrice} onChange={e => setAddPrice(e.target.value === '' ? '' : parseFloat(e.target.value))} />
          </div>
          {typeof addPrice === 'number' && addPrice > 0 && typeof addCostPrice === 'number' && addCostPrice > 0 && (() => {
            const addMargin = addPrice - addCostPrice;
            const addPct = getProfitPercent(addPrice, addCostPrice);
            const addWarning = getPricingWarning(addPrice, addCostPrice);
            return (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Margin: <span className={`font-medium ${addMargin > 0 ? 'text-primary' : 'text-destructive'}`}>{formatGHS(addMargin)}</span>
                  {addPct && <span className="ml-1 text-muted-foreground">({addPct}%)</span>}
                </p>
                {addWarning && (
                  <p className={`text-xs flex items-center gap-1 ${addWarning.level === 'error' ? 'text-destructive' : 'text-yellow-600 dark:text-yellow-500'}`}>
                    <AlertTriangle className="w-3 h-3 shrink-0" /> {addWarning.text}
                  </p>
                )}
              </div>
            );
          })()}
          {addNetwork && addProduct && isDuplicate(addNetwork, addProduct, addSize) && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> This combination already exists.
            </p>
          )}
          <Button className="w-full" onClick={handleAdd}>Add</Button>
        </div>
      </div>

      {editItem && (
        <AlertDialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Edit Price Item</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-sm">Product</Label>
                <Select value={editItem.product} onValueChange={v => {
                  if (v === 'AFA Registration') {
                    setEditItem({ ...editItem, product: v, network: 'MTN', size: 'Per Registration' });
                  } else {
                    setEditItem({ ...editItem, product: v });
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {productTypes.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                {editItem.product === 'AFA Registration' && (
                  <p className="text-[11px] text-muted-foreground">Locked to MTN with label "Per Registration".</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Network</Label>
                <Select value={editItem.network} onValueChange={v => setEditItem({ ...editItem, network: v })} disabled={editItem.product === 'AFA Registration'}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {networkNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{editItem.product === 'AFA Registration' ? 'Label' : 'Data Size'}</Label>
                <Input
                  value={editItem.size}
                  onChange={e => setEditItem({ ...editItem, size: e.target.value })}
                  disabled={editItem.product === 'AFA Registration'}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Cost Price (GHS)</Label>
                <Input type="number" step="0.01" value={(editItem as any)._costRaw ?? editItem.cost_price} onChange={e => setEditItem({ ...editItem, cost_price: e.target.value === '' ? 0 : parseFloat(e.target.value), _costRaw: e.target.value === '' ? '' : parseFloat(e.target.value) } as any)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Selling Price (GHS)</Label>
                <Input type="number" step="0.01" value={(editItem as any)._priceRaw ?? editItem.price} onChange={e => setEditItem({ ...editItem, price: e.target.value === '' ? 0 : parseFloat(e.target.value), _priceRaw: e.target.value === '' ? '' : parseFloat(e.target.value) } as any)} />
              </div>
              {editItem.price > 0 && editItem.cost_price > 0 && (() => {
                const editMargin = editItem.price - editItem.cost_price;
                const editPct = getProfitPercent(editItem.price, editItem.cost_price);
                const editWarning = getPricingWarning(editItem.price, editItem.cost_price);
                return (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Margin: <span className={`font-medium ${editMargin > 0 ? 'text-primary' : 'text-destructive'}`}>{formatGHS(editMargin)}</span>
                      {editPct && <span className="ml-1 text-muted-foreground">({editPct}%)</span>}
                    </p>
                    {editWarning && (
                      <p className={`text-xs flex items-center gap-1 ${editWarning.level === 'error' ? 'text-destructive' : 'text-yellow-600 dark:text-yellow-500'}`}>
                        <AlertTriangle className="w-3 h-3 shrink-0" /> {editWarning.text}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleEditSave}>Save</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <AlertDialog open={!!deleteItem} onOpenChange={open => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteItem?.product} {deleteItem?.size}</strong> from {deleteItem?.network}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailItem && (
        <DetailViewDialog
          open={!!detailItem}
          onOpenChange={open => !open && setDetailItem(null)}
          title={`${detailItem.network} — ${detailItem.product}`}
          fields={[
            { label: 'Network', value: detailItem.network },
            { label: 'Product', value: detailItem.product },
            { label: 'Data Size', value: detailItem.size || '—' },
            { label: 'Cost Price', value: formatGHS(detailItem.cost_price) },
            { label: 'Selling Price', value: formatGHS(detailItem.price) },
            { label: 'Margin', value: formatGHS(detailItem.price - detailItem.cost_price) },
          ]}
        />
      )}
    </AdminLayout>
  );
}
