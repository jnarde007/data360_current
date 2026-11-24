import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge } from '@/components/StatusBadge';
import { formatGHS } from '@/lib/mock-data';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, MoreHorizontal, Trash2, Plus, Minus, ShieldOff, ShieldCheck, CheckCircle, Eye, Users, Tag, X, Filter, Download } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

import { supabase } from '@/integrations/supabase/client';
import { invokeAdminFunction } from '@/lib/admin-functions';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileCard } from '@/components/MobileCard';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';
import { motion } from 'framer-motion';
import { CustomerExportDialog } from '@/components/admin/CustomerExportDialog';

const PREDEFINED_TAGS = ['VIP', 'Flagged', 'New', 'High Volume', 'Disputed', 'Needs Review', 'Trusted', 'Test Account'] as const;

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

interface Customer {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  wallet_balance: number;
  status: string;
  affiliate_code: string;
  referral_count: number;
  total_commission: number;
  available_commission: number;
  tags: string[];
}

export default function AdminCustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showUntagged, setShowUntagged] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.adminRole === 'Super Admin';
  
  const isMobile = useIsMobile();

  const [walletDialog, setWalletDialog] = useState<{ open: boolean; type: 'credit' | 'debit'; customer: Customer | null }>({ open: false, type: 'credit', customer: null });
  const [walletAmount, setWalletAmount] = useState('');
  const [walletReason, setWalletReason] = useState('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; customer: Customer | null }>({ open: false, customer: null });
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      const [custRes, tagsRes] = await Promise.all([
        supabase
          .from('customers')
          .select('id, full_name, email, phone, wallet_balance, status, affiliate_code, total_commission, available_commission, referred_by')
          .neq('status', 'deleted')
          .order('created_at', { ascending: false }),
        supabase.from('customer_tags').select('customer_id, tag'),
      ]);
      if (custRes.error) throw custRes.error;

      const allCustomers = custRes.data || [];
      const allTags = tagsRes.data || [];

      // Build tag map
      const tagMap: Record<string, string[]> = {};
      allTags.forEach((t: any) => {
        if (!tagMap[t.customer_id]) tagMap[t.customer_id] = [];
        tagMap[t.customer_id].push(t.tag);
      });

      const referralCounts: Record<string, number> = {};
      allCustomers.forEach((c: any) => {
        if (c.referred_by) {
          referralCounts[c.referred_by] = (referralCounts[c.referred_by] || 0) + 1;
        }
      });

      setCustomers(allCustomers.map((c: any) => ({
        id: c.id,
        full_name: c.full_name,
        email: c.email,
        phone: c.phone,
        wallet_balance: Number(c.wallet_balance),
        status: c.status,
        affiliate_code: c.affiliate_code,
        total_commission: Number(c.total_commission || 0),
        available_commission: Number(c.available_commission || 0),
        referral_count: referralCounts[c.affiliate_code] || 0,
        tags: tagMap[c.id] || [],
      })));
    } catch {
      toast({ title: 'Unable to load customers', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  useRealtimeRefresh(['customers'], loadCustomers, 'admin-customers-live');

  const handleWalletAction = async () => {
    const amount = parseFloat(walletAmount);
    if (!walletDialog.customer || isNaN(amount) || amount <= 0) {
      toast({ title: 'Invalid amount', description: 'Please enter a valid amount greater than zero.', variant: 'destructive' });
      return;
    }
    const c = walletDialog.customer;
    const isDebit = walletDialog.type === 'debit';

    if (isDebit && amount > c.wallet_balance) {
      toast({ title: 'Insufficient balance', description: `This customer only has ${formatGHS(c.wallet_balance)} available.`, variant: 'destructive' });
      return;
    }

    setWalletLoading(true);
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: isDebit ? 'debit_wallet' : 'credit_wallet',
        customer_id: c.id,
        amount,
        reason: walletReason.trim() || undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newBalance = data.new_balance;
      setCustomers(prev => prev.map(cu => cu.id === c.id ? { ...cu, wallet_balance: newBalance } : cu));
      toast({ title: 'Wallet updated', description: `${isDebit ? 'Debited' : 'Credited'} ${formatGHS(amount)} ${isDebit ? 'from' : 'to'} ${c.full_name}'s wallet.`, variant: 'success' });
      setWalletDialog({ open: false, type: 'credit', customer: null });
      setWalletAmount('');
      setWalletReason('');
    } catch (err: any) {
      toast({ title: 'Wallet action failed', description: err?.message || `Could not ${walletDialog.type} wallet. Please try again.`, variant: 'destructive' });
    } finally {
      setWalletLoading(false);
    }
  };

  const handleToggleStatus = async (customer: Customer) => {
    const newStatus = customer.status === 'active' ? 'suspended' : 'active';
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: 'set_status', customer_id: customer.id, status: newStatus,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, status: data.new_status } : c));
      toast({ title: 'Customer status updated', description: `${customer.full_name} is now ${data.new_status}.`, variant: data.new_status === 'active' ? 'success' : 'warning' });
    } catch (err: any) {
      toast({ title: 'Status update failed', description: err?.message || 'Could not update customer status. Please try again.', variant: 'destructive' });
    }
  };

  const handleApprove = async (customer: Customer) => {
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: 'approve', customer_id: customer.id,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, status: 'active' } : c));
      toast({ title: 'Customer approved', description: `${customer.full_name} has been approved and can now access the platform.`, variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Approval failed', description: err?.message || 'Could not approve this customer. Please try again.', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog.customer) return;
    const c = deleteDialog.customer;
    setDeleteLoading(true);
    try {
      const { data, error } = await invokeAdminFunction('delete-customer', {
        customer_id: c.id,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCustomers(prev => prev.filter(cu => cu.id !== c.id));
      toast({ title: 'Customer deleted', description: `${c.full_name}'s account has been archived. They can sign up again with the same email or phone.`, variant: 'success' });
      setDeleteDialog({ open: false, customer: null });
    } catch (err: any) {
      toast({ title: 'Deletion failed', description: err?.message || 'Could not delete this customer. Please try again.', variant: 'destructive' });
    } finally {
      setDeleteLoading(false);
    }
  };

  const hasFilters = search || statusFilter !== 'all' || selectedTags.length > 0 || showUntagged;

  const filtered = customers.filter(c => {
    const matchesSearch = !search || c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchesTags = showUntagged ? c.tags.length === 0 : (selectedTags.length === 0 || selectedTags.every(t => c.tags.includes(t)));
    return matchesSearch && matchesStatus && matchesTags;
  });

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setSelectedTags([]); setShowUntagged(false); };

  const getDetailFields = (c: Customer): DetailField[] => [
    { label: 'Name', value: <span className="font-medium">{c.full_name}</span> },
    { label: 'Email', value: c.email },
    { label: 'Phone', value: <span className="font-mono">{c.phone}</span> },
    { label: 'Wallet', value: <span className="font-semibold">{formatGHS(c.wallet_balance)}</span> },
    { label: 'Referrals', value: <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 text-primary" />{c.referral_count}</span> },
    { label: 'Total Commission', value: <span className="font-semibold">{formatGHS(c.total_commission)}</span> },
    { label: 'Available Commission', value: <span className="font-semibold text-primary">{formatGHS(c.available_commission)}</span> },
    { label: 'Status', value: <StatusBadge status={c.status as any} /> },
  ];

  const CustomerActions = ({ c }: { c: Customer }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
        <Button size="sm" variant="outline" className="h-7"><MoreHorizontal className="w-4 h-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
        {c.status === 'pending' && (
          <>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleApprove(c); }}>
              <CheckCircle className="w-4 h-4 mr-2" /> Approve Account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {isSuperAdmin && (
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setWalletDialog({ open: true, type: 'credit', customer: c }); setWalletAmount(''); setWalletReason(''); }}>
            <Plus className="w-4 h-4 mr-2" /> Credit Wallet
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setWalletDialog({ open: true, type: 'debit', customer: c }); setWalletAmount(''); setWalletReason(''); }}>
          <Minus className="w-4 h-4 mr-2" /> Debit Wallet
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleToggleStatus(c); }}>
          {c.status === 'active' ? <><ShieldOff className="w-4 h-4 mr-2" /> Suspend</> : <><ShieldCheck className="w-4 h-4 mr-2" /> Activate</>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteDialog({ open: true, customer: c }); }}>
          <Trash2 className="w-4 h-4 mr-2" /> Delete Account
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Customers</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage customer accounts and wallets</p>
            </div>
            {isSuperAdmin && (
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setExportOpen(true)}>
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export Customers</span>
                <span className="sm:hidden">Export</span>
              </Button>
            )}
          </div>
        </motion.div>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Search & Filter</h2>
            <div className="flex-1 h-px bg-border/60" />
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="glass-card p-3 sm:p-4 card-shine space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Tag Filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mr-1">Tags:</span>
              <button
                onClick={() => { setShowUntagged(prev => !prev); if (!showUntagged) setSelectedTags([]); }}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors ${
                  showUntagged
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                }`}
              >
                <Tag className="w-2.5 h-2.5" />
                Untagged
                {showUntagged && <X className="w-2.5 h-2.5 ml-0.5" />}
              </button>
              {PREDEFINED_TAGS.map(tag => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => { toggleTag(tag); if (showUntagged) setShowUntagged(false); }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors ${
                      active
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'bg-transparent border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                    }`}
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                    {active && <X className="w-2.5 h-2.5 ml-0.5" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </section>

        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}>
          <div className="px-1 pb-2">
            <p className="text-sm text-primary font-medium">Showing {filtered.length} customer{filtered.length !== 1 ? 's' : ''}{hasFilters ? ' (filtered)' : ''}</p>
          </div>

          {isMobile ? (
            <div className="space-y-2">
              {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">No customers found</p>}
              {filtered.map(c => (
                <MobileCard
                  key={c.id}
                  fields={[
                    { label: 'Name', value: <div><span className="font-medium">{c.full_name}</span>{c.tags.length > 0 && <div className="flex gap-1 flex-wrap mt-1">{c.tags.map(t => <Badge key={t} variant="secondary" className="text-[9px] gap-0.5 px-1.5 py-0"><Tag className="w-2 h-2" />{t}</Badge>)}</div>}</div> },
                    { label: 'Wallet', value: <span className="font-semibold">{formatGHS(c.wallet_balance)}</span> },
                    { label: 'Referrals', value: <span className="flex items-center gap-1"><Users className="w-3 h-3 text-primary" />{c.referral_count}</span> },
                    { label: 'Status', value: <StatusBadge status={c.status as any} /> },
                  ]}
                  action={
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs flex-1" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                        <Eye className="w-3.5 h-3.5" /> View
                      </Button>
                      <CustomerActions c={c} />
                    </div>
                  }
                />
              ))}
            </div>
          ) : (
            <div className="glass-card glow-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-4 font-medium text-muted-foreground">Name</th>
                      <th className="p-4 font-medium text-muted-foreground">Email</th>
                      <th className="p-4 font-medium text-muted-foreground">Phone</th>
                      <th className="p-4 font-medium text-muted-foreground">Wallet</th>
                      <th className="p-4 font-medium text-muted-foreground">Referrals</th>
                      <th className="p-4 font-medium text-muted-foreground">Status</th>
                      <th className="p-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(c => (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                        <td className="p-4 font-medium text-foreground text-primary">
                          <div>{c.full_name}</div>
                          {c.tags.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1">
                              {c.tags.map(t => <Badge key={t} variant="secondary" className="text-[9px] gap-0.5 px-1.5 py-0"><Tag className="w-2 h-2" />{t}</Badge>)}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-muted-foreground">{c.email}</td>
                        <td className="p-4 text-muted-foreground">{c.phone}</td>
                        <td className="p-4 font-semibold text-foreground whitespace-nowrap">{formatGHS(c.wallet_balance)}</td>
                        <td className="p-4 text-foreground">
                          <span className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-primary" />
                            {c.referral_count}
                          </span>
                        </td>
                        <td className="p-4"><StatusBadge status={c.status as any} /></td>
                        <td className="p-4"><CustomerActions c={c} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">No customers found</p>}
            </div>
          )}
        </motion.div>
      </div>

      {/* Detail Dialog */}
      <DetailViewDialog
        open={!!detailCustomer}
        onOpenChange={open => { if (!open) setDetailCustomer(null); }}
        title="Customer Details"
        subtitle="Complete customer information"
        fields={detailCustomer ? getDetailFields(detailCustomer) : []}
      />

      {/* Credit / Debit Dialog */}
      <Dialog open={walletDialog.open} onOpenChange={open => { if (!open) setWalletDialog({ open: false, type: 'credit', customer: null }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{walletDialog.type === 'credit' ? 'Credit' : 'Debit'} Wallet</DialogTitle>
            <DialogDescription>
              {walletDialog.customer && `${walletDialog.customer.full_name} — Balance: ${formatGHS(walletDialog.customer.wallet_balance)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Amount (GH₵)</Label>
              <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Reason / Note</Label>
              <Input placeholder="e.g. Customer requested manual top-up" value={walletReason} onChange={e => setWalletReason(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletDialog({ open: false, type: 'credit', customer: null })}>Cancel</Button>
            <Button onClick={handleWalletAction} disabled={walletLoading}>
              {walletLoading && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {walletDialog.type === 'credit' ? 'Credit' : 'Debit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialog.open} onOpenChange={open => { if (!open) setDeleteDialog({ open: false, customer: null }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer Account</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteDialog.customer?.full_name}</strong>'s account, orders, and topups. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteLoading && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Customer Export Dialog */}
      {isSuperAdmin && <CustomerExportDialog open={exportOpen} onOpenChange={setExportOpen} />}
    </AdminLayout>
  );
}