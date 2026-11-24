import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useAuth } from '@/contexts/AuthContext';
import { formatGHS } from '@/lib/mock-data';
import { Loader2, Users, DollarSign, Clock, CheckCircle, XCircle, Search, MoreHorizontal, Eye, Plus, Minus, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { invokeAdminFunction } from '@/lib/admin-functions';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileCard } from '@/components/MobileCard';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';

interface AffiliateCustomer {
  id: string;
  full_name: string;
  email: string;
  affiliate_code: string;
  phone?: string;
  total_commission: number;
  available_commission: number;
  referral_count: number;
}

interface WithdrawalRequest {
  id: string;
  customer_id: string;
  amount: number;
  status: string;
  admin_note: string;
  created_at: string;
  processed_at: string | null;
  momo_number: string;
  momo_name: string;
  customer_name?: string;
  customer_email?: string;
}

const MIN_WITHDRAWAL = 20;

export default function AdminAffiliatePage() {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.adminRole === 'Super Admin';
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<AffiliateCustomer[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [withdrawalFilter, setWithdrawalFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  const [actionWithdrawal, setActionWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const [adminNote, setAdminNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const [payToWalletWithdrawal, setPayToWalletWithdrawal] = useState<WithdrawalRequest | null>(null);

  const [creditCustomer, setCreditCustomer] = useState<AffiliateCustomer | null>(null);
  const [creditAmount, setCreditAmount] = useState<number>(0);

  const [debitCustomer, setDebitCustomer] = useState<AffiliateCustomer | null>(null);
  const [debitAmount, setDebitAmount] = useState<number>(0);

  const [detailCustomer, setDetailCustomer] = useState<AffiliateCustomer | null>(null);
  const [detailWithdrawal, setDetailWithdrawal] = useState<WithdrawalRequest | null>(null);

  const totalCommissions = customers.reduce((s, c) => s + c.total_commission, 0);
  const totalAvailable = customers.reduce((s, c) => s + c.available_commission, 0);
  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending');
  const pendingTotal = pendingWithdrawals.reduce((s, w) => s + w.amount, 0);

  const loadData = useCallback(async () => {
    try {
      const [custRes, withdrawRes] = await Promise.all([
        supabase.from('customers').select('id, full_name, email, phone, affiliate_code, total_commission, available_commission, referred_by, status').not('status', 'in', '("deleted","archived")').order('total_commission', { ascending: false }),
        supabase.from('affiliate_withdrawals').select('*').order('created_at', { ascending: false }),
      ]);
      if (custRes.error) throw custRes.error;
      if (withdrawRes.error) throw withdrawRes.error;

      const allCustomers = custRes.data || [];
      const referralCounts: Record<string, number> = {};
      allCustomers.forEach(c => { if (c.referred_by) referralCounts[c.referred_by] = (referralCounts[c.referred_by] || 0) + 1; });

      setCustomers(allCustomers.map(c => ({
        ...c, total_commission: Number(c.total_commission || 0),
        available_commission: Number(c.available_commission || 0),
        referral_count: referralCounts[c.affiliate_code] || 0,
      })));

      const customerMap = new Map(allCustomers.map(c => [c.id, c]));
      setWithdrawals((withdrawRes.data || []).map(w => ({
        ...w, amount: Number(w.amount),
        customer_name: customerMap.get(w.customer_id)?.full_name || 'Unknown',
        customer_email: customerMap.get(w.customer_id)?.email || '',
      })));
    } catch {
      toast({ title: 'Unable to load affiliate data', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  useRealtimeRefresh(['customers', 'affiliate_withdrawals'], loadData, 'admin-affiliate-live');

  const [pendingPayouts, setPendingPayouts] = useState(0);
  const loadPendingPayouts = useCallback(async () => {
    const { count } = await supabase.from('payouts').select('id', { count: 'exact', head: true })
      .eq('payout_type', 'affiliate').in('status', ['pending_approval', 'approved']);
    setPendingPayouts(count || 0);
  }, []);
  useEffect(() => { loadPendingPayouts(); }, [loadPendingPayouts]);
  useRealtimeRefresh(['payouts'], loadPendingPayouts, 'admin-affiliate-payouts-live');

  const handleApproveReject = async () => {
    if (!actionWithdrawal) return;
    setProcessing(true);
    try {
      const newStatus = actionType === 'approve' ? 'approved' : 'rejected';
      const { error } = await supabase.from('affiliate_withdrawals').update({ status: newStatus, admin_note: adminNote, processed_at: new Date().toISOString() }).eq('id', actionWithdrawal.id);
      if (error) throw error;

      // Commission was already deducted when the customer submitted the request.
      // On rejection, restore the commission back to the customer.
      if (actionType === 'reject') {
        const customer = customers.find(c => c.id === actionWithdrawal.customer_id);
        if (customer) {
          const { data: refundResult, error: refundErr } = await invokeAdminFunction('admin-customer-action', {
            action: 'refund_commission', customer_id: customer.id, amount: actionWithdrawal.amount,
          });
          if (refundErr) throw refundErr;
          if (refundResult?.error) throw new Error(refundResult.error);
          setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, available_commission: refundResult.new_available } : c));
        }
      }

      // On approval (MoMo payout), send SMS confirming payout to Mobile Money.
      // Reuses the existing send-sms flow with an idempotency key tied to the withdrawal id.
      if (actionType === 'approve') {
        const customer = customers.find(c => c.id === actionWithdrawal.customer_id);
        const phone = customer?.phone || actionWithdrawal.momo_number || '';
        if (phone) {
          const amt = Number(actionWithdrawal.amount).toFixed(2);
          const smsMsg = `You have received GHS ${amt} commission paid to your Mobile Money account.`;
          supabase.functions.invoke('send-sms', {
            body: {
              to: phone,
              message: smsMsg,
              event_type: 'affiliate_commission_payout',
              customer_id: actionWithdrawal.customer_id,
              idempotency_key: `affiliate_commission_momo_${actionWithdrawal.id}`,
            },
          }).catch(() => { /* logged server-side */ });
        }
      }

      setWithdrawals(prev => prev.map(w => w.id === actionWithdrawal.id ? { ...w, status: newStatus, admin_note: adminNote, processed_at: new Date().toISOString() } : w));
      toast({ title: `Withdrawal ${newStatus}`, description: `The withdrawal request has been ${newStatus}.`, variant: newStatus === 'approved' ? 'success' : 'warning' });
    } catch {
      toast({ title: 'Processing failed', description: 'Could not process this withdrawal request. Please try again.', variant: 'destructive' });
    } finally {
      setProcessing(false); setActionWithdrawal(null); setAdminNote('');
    }
  };

  const handlePayToWallet = async () => {
    if (!payToWalletWithdrawal) return;
    setProcessing(true);
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: 'pay_withdrawal_to_wallet',
        customer_id: payToWalletWithdrawal.customer_id,
        withdrawal_id: payToWalletWithdrawal.id,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.already_paid) {
        toast({
          title: 'Already credited',
          description: 'This commission was already credited to the wallet.',
          variant: 'warning',
        });
      } else {
        toast({
          title: 'Wallet credited',
          description: `${formatGHS(payToWalletWithdrawal.amount)} credited to ${payToWalletWithdrawal.customer_name}'s wallet.`,
          variant: 'success',
        });
      }

      setWithdrawals(prev => prev.map(w => w.id === payToWalletWithdrawal.id
        ? { ...w, status: 'paid', processed_at: new Date().toISOString(), admin_note: 'Paid to customer wallet' }
        : w));
    } catch (e: any) {
      toast({
        title: 'Wallet credit failed',
        description: e?.message || 'Could not credit wallet. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
      setPayToWalletWithdrawal(null);
    }
  };

  const handleCreditCommission = async () => {
    if (!creditCustomer || creditAmount <= 0) return;
    setProcessing(true);
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: 'credit_commission', customer_id: creditCustomer.id, amount: creditAmount,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCustomers(prev => prev.map(c => c.id === creditCustomer.id ? { ...c, total_commission: data.new_total, available_commission: data.new_available } : c));
      toast({ title: 'Commission credited', description: `${formatGHS(creditAmount)} has been credited to ${creditCustomer.full_name}'s commission balance.`, variant: 'success' });
    } catch {
      toast({ title: 'Commission credit failed', description: 'Could not credit commission. Please try again.', variant: 'destructive' });
    } finally {
      setProcessing(false); setCreditCustomer(null); setCreditAmount(0);
    }
  };

  const handleDebitCommission = async () => {
    if (!debitCustomer || debitAmount <= 0) return;
    if (debitAmount > debitCustomer.available_commission) {
      toast({ title: 'Insufficient commission', description: `Available: ${formatGHS(debitCustomer.available_commission)}`, variant: 'destructive' });
      return;
    }
    setProcessing(true);
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: 'deduct_commission', customer_id: debitCustomer.id, amount: debitAmount,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCustomers(prev => prev.map(c => c.id === debitCustomer.id ? { ...c, available_commission: data.new_available } : c));
      toast({ title: 'Commission debited', description: `${formatGHS(debitAmount)} has been debited from ${debitCustomer.full_name}'s commission balance.`, variant: 'success' });
    } catch {
      toast({ title: 'Commission debit failed', description: 'Could not debit commission. Please try again.', variant: 'destructive' });
    } finally {
      setProcessing(false); setDebitCustomer(null); setDebitAmount(0);
    }
  };

  const filteredCustomers = customers.filter(c => {
    const q = searchQuery.toLowerCase();
    return !q || c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.affiliate_code.toLowerCase().includes(q);
  });

  const filteredWithdrawals = withdrawals.filter(w => withdrawalFilter === 'all' || w.status === withdrawalFilter);

  const getCustomerDetailFields = (c: AffiliateCustomer): DetailField[] => [
    { label: 'Name', value: <span className="font-medium">{c.full_name}</span> },
    { label: 'Email', value: c.email },
    { label: 'Affiliate Code', value: <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{c.affiliate_code}</code> },
    { label: 'Referrals', value: String(c.referral_count) },
    { label: 'Total Earned', value: <span className="font-semibold">{formatGHS(c.total_commission)}</span> },
    { label: 'Available', value: <span className="font-semibold text-primary">{formatGHS(c.available_commission)}</span> },
  ];

  const getWithdrawalDetailFields = (w: WithdrawalRequest): DetailField[] => [
    { label: 'Customer', value: <span className="font-medium">{w.customer_name}</span> },
    { label: 'Email', value: w.customer_email || '—' },
    { label: 'Amount', value: <span className="font-semibold">{formatGHS(w.amount)}</span> },
    { label: 'MoMo Number', value: w.momo_number || '—' },
    { label: 'MoMo Name', value: w.momo_name || '—' },
    { label: 'Status', value: <StatusBadge status={w.status as any} /> },
    { label: 'Note', value: w.admin_note || '—' },
    { label: 'Date', value: new Date(w.created_at).toLocaleString() },
    ...(w.processed_at ? [{ label: 'Processed', value: new Date(w.processed_at).toLocaleString() }] : []),
  ];

  if (loading) {
    return <AdminLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="space-y-4 sm:space-y-6">
        {pendingPayouts > 0 && (
          <a href="/admin/payouts" className="block rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm text-foreground hover:bg-primary/15">
            <strong>{pendingPayouts} affiliate payout request{pendingPayouts > 1 ? 's' : ''} waiting for approval.</strong>{' '}
            New withdrawal requests are now approved on the Payouts page → Open Payouts
          </a>
        )}
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">Affiliate Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage customer commissions and withdrawal requests</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card glow-border p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center"><Users className="w-4 h-4 text-primary" /></div>
              <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">Affiliates</p>
            </div>
            <p className="text-xl sm:text-2xl font-display font-bold text-foreground tabular-nums">{customers.filter(c => c.referral_count > 0).length}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{customers.reduce((s, c) => s + c.referral_count, 0)} people referred</p>
          </div>
          <div className="glass-card glow-border p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-primary" /></div>
              <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Earned</p>
            </div>
            <p className="text-xl sm:text-2xl font-display font-bold text-foreground tabular-nums">{formatGHS(totalCommissions)}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">all time</p>
          </div>
          <div className="glass-card glow-border p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-primary" /></div>
              <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">Available</p>
            </div>
            <p className="text-xl sm:text-2xl font-display font-bold text-foreground tabular-nums">{formatGHS(totalAvailable)}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">withdrawable</p>
          </div>
          <div className="glass-card glow-border p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center"><Clock className="w-4 h-4 text-destructive" /></div>
              <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">Pending</p>
            </div>
            <p className="text-xl sm:text-2xl font-display font-bold text-foreground tabular-nums">{pendingWithdrawals.length}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{formatGHS(pendingTotal)} total</p>
          </div>
        </div>

        <Tabs defaultValue="commissions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="commissions">Commissions</TabsTrigger>
            <TabsTrigger value="withdrawals" className="relative">
              Withdrawals
              {pendingWithdrawals.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground">
                  {pendingWithdrawals.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Commissions Tab */}
          <TabsContent value="commissions" className="space-y-4">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="Search customers..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>

            {isMobile ? (
              <div className="space-y-3">
                {filteredCustomers.length === 0 && <p className="text-center text-muted-foreground py-8">No customers found</p>}
                {filteredCustomers.map(c => (
                  <MobileCard key={c.id} fields={[
                    { label: 'Customer', value: <span className="font-medium">{c.full_name}</span> },
                    { label: 'Referrals', value: String(c.referral_count) },
                    { label: 'Earned', value: <span className="font-semibold">{formatGHS(c.total_commission)}</span> },
                    { label: 'Available', value: <span className="font-semibold text-primary">{formatGHS(c.available_commission)}</span> },
                  ]} action={
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs flex-1" onClick={() => setDetailCustomer(c)}>
                        <Eye className="w-3.5 h-3.5" /> View
                      </Button>
                      {isSuperAdmin && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreditCustomer(c)}><Plus className="w-3 h-3 mr-1" />Credit</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDebitCustomer(c)}><Minus className="w-3 h-3 mr-1" />Debit</Button>
                        </>
                      )}
                    </div>
                  } />
                ))}
              </div>
            ) : (
              <div className="glass-card glow-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-4 font-medium text-muted-foreground">Customer</th>
                      <th className="p-4 font-medium text-muted-foreground">Affiliate Code</th>
                      <th className="p-4 font-medium text-muted-foreground">Referrals</th>
                      <th className="p-4 font-medium text-muted-foreground">Total Earned</th>
                      <th className="p-4 font-medium text-muted-foreground">Available</th>
                      <th className="p-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map(c => (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-4">
                          <p className="font-medium text-foreground">{c.full_name}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        </td>
                        <td className="p-4"><code className="text-xs bg-muted px-2 py-1 rounded font-mono">{c.affiliate_code}</code></td>
                        <td className="p-4 text-foreground">{c.referral_count}</td>
                        <td className="p-4 font-medium text-foreground tabular-nums">{formatGHS(c.total_commission)}</td>
                        <td className="p-4 font-medium text-primary tabular-nums">{formatGHS(c.available_commission)}</td>
                        <td className="p-4">
                          {isSuperAdmin ? (
                            <div className="flex gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreditCustomer(c)}><Plus className="w-3 h-3 mr-1" />Credit</Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDebitCustomer(c)}><Minus className="w-3 h-3 mr-1" />Debit</Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredCustomers.length === 0 && <p className="text-center text-muted-foreground py-8">No customers found</p>}
              </div>
            )}
          </TabsContent>

          {/* Withdrawals Tab */}
          <TabsContent value="withdrawals" className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                <Button key={f} size="sm" variant={withdrawalFilter === f ? 'default' : 'outline'} className="h-8 text-xs capitalize"
                  onClick={() => setWithdrawalFilter(f)}>
                  {f}{f === 'pending' && pendingWithdrawals.length > 0 ? ` (${pendingWithdrawals.length})` : ''}
                </Button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">Minimum withdrawal: {formatGHS(MIN_WITHDRAWAL)}</p>

            {isMobile ? (
              <div className="space-y-3">
                {filteredWithdrawals.length === 0 && <p className="text-center text-muted-foreground py-8">No withdrawal requests</p>}
                {filteredWithdrawals.map(w => (
                  <MobileCard key={w.id} fields={[
                    { label: 'Customer', value: <span className="font-medium">{w.customer_name}</span> },
                    { label: 'Amount', value: <span className="font-semibold">{formatGHS(w.amount)}</span> },
                    { label: 'MoMo', value: <span className="text-xs">{w.momo_number || '—'} · {w.momo_name || '—'}</span> },
                    { label: 'Status', value: <StatusBadge status={w.status as any} /> },
                    { label: 'Date', value: <span className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleDateString()}</span> },
                  ]} action={
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="gap-1.5 text-xs flex-1" onClick={() => setDetailWithdrawal(w)}>
                        <Eye className="w-3.5 h-3.5" /> View
                      </Button>
                      {w.status === 'pending' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="text-primary" onClick={() => { setActionWithdrawal(w); setActionType('approve'); }}>
                              <CheckCircle className="w-4 h-4 mr-2" />Approve & Pay (MoMo)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPayToWalletWithdrawal(w)}>
                              <Wallet className="w-4 h-4 mr-2" />Pay to Wallet
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => { setActionWithdrawal(w); setActionType('reject'); }}>
                              <XCircle className="w-4 h-4 mr-2" />Reject
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  } />
                ))}
              </div>
            ) : (
              <div className="glass-card glow-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-4 font-medium text-muted-foreground">Customer</th>
                      <th className="p-4 font-medium text-muted-foreground">Amount</th>
                      <th className="p-4 font-medium text-muted-foreground">MoMo</th>
                      <th className="p-4 font-medium text-muted-foreground">Status</th>
                      <th className="p-4 font-medium text-muted-foreground">Date</th>
                      <th className="p-4 font-medium text-muted-foreground">Note</th>
                      <th className="p-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWithdrawals.map(w => (
                      <tr key={w.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-4">
                          <p className="font-medium text-foreground">{w.customer_name}</p>
                          <p className="text-xs text-muted-foreground">{w.customer_email}</p>
                        </td>
                        <td className="p-4 font-bold text-foreground tabular-nums">{formatGHS(w.amount)}</td>
                        <td className="p-4">
                          <p className="text-sm text-foreground">{w.momo_number || '—'}</p>
                          <p className="text-xs text-muted-foreground">{w.momo_name || '—'}</p>
                        </td>
                        <td className="p-4"><StatusBadge status={w.status as any} /></td>
                        <td className="p-4 text-muted-foreground text-xs">{new Date(w.created_at).toLocaleDateString()}</td>
                        <td className="p-4 text-xs text-muted-foreground max-w-[150px] truncate">{w.admin_note || '—'}</td>
                        <td className="p-4">
                          {w.status === 'pending' ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem className="text-primary" onClick={() => { setActionWithdrawal(w); setActionType('approve'); }}>
                                  <CheckCircle className="w-4 h-4 mr-2" />Approve & Pay (MoMo)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setPayToWalletWithdrawal(w)}>
                                  <Wallet className="w-4 h-4 mr-2" />Pay to Wallet
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive" onClick={() => { setActionWithdrawal(w); setActionType('reject'); }}>
                                  <XCircle className="w-4 h-4 mr-2" />Reject
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">
                              {w.processed_at ? new Date(w.processed_at).toLocaleDateString() : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredWithdrawals.length === 0 && <p className="text-center text-muted-foreground py-8">No withdrawal requests</p>}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Detail Dialogs */}
      <DetailViewDialog
        open={!!detailCustomer}
        onOpenChange={open => { if (!open) setDetailCustomer(null); }}
        title="Affiliate Details"
        subtitle="Commission and referral info"
        fields={detailCustomer ? getCustomerDetailFields(detailCustomer) : []}
      />
      <DetailViewDialog
        open={!!detailWithdrawal}
        onOpenChange={open => { if (!open) setDetailWithdrawal(null); }}
        title="Withdrawal Details"
        subtitle="Withdrawal request information"
        fields={detailWithdrawal ? getWithdrawalDetailFields(detailWithdrawal) : []}
      />

      {/* Approve/Reject Dialog */}
      <AlertDialog open={!!actionWithdrawal} onOpenChange={open => { if (!open) { setActionWithdrawal(null); setAdminNote(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionType === 'approve' ? 'Approve & Pay' : 'Reject'} Withdrawal</AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === 'approve'
                ? <>Approve <strong>{formatGHS(actionWithdrawal?.amount || 0)}</strong> withdrawal for <strong>{actionWithdrawal?.customer_name}</strong>?<br />MoMo: {actionWithdrawal?.momo_number || '—'} ({actionWithdrawal?.momo_name || '—'})<br />You will need to pay this amount manually (e.g., via MoMo).</>
                : <>Reject <strong>{formatGHS(actionWithdrawal?.amount || 0)}</strong> withdrawal request from <strong>{actionWithdrawal?.customer_name}</strong>? The amount will be returned to their available balance.</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm">Admin Note (optional)</Label>
            <Textarea placeholder={actionType === 'approve' ? 'e.g. Paid via MoMo to 024XXXXXXX' : 'e.g. Reason for rejection'} value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApproveReject} disabled={processing}
              className={actionType === 'approve' ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}>
              {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {actionType === 'approve' ? 'Approve & Mark Paid' : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pay to Wallet Dialog */}
      <AlertDialog open={!!payToWalletWithdrawal} onOpenChange={open => { if (!open) setPayToWalletWithdrawal(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pay Commission to Wallet</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Credit <strong>{formatGHS(payToWalletWithdrawal?.amount || 0)}</strong> to{' '}
                  <strong>{payToWalletWithdrawal?.customer_name}</strong>'s wallet balance?
                </p>
                <p className="text-muted-foreground">
                  This amount will be added to the customer's wallet, recorded as a credit transaction, and the
                  withdrawal request will be marked as paid. The customer will receive an SMS confirmation.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePayToWallet} disabled={processing}>
              {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Credit Wallet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Credit Commission Dialog */}
      <AlertDialog open={!!creditCustomer} onOpenChange={open => { if (!open) { setCreditCustomer(null); setCreditAmount(0); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Credit Commission</AlertDialogTitle>
            <AlertDialogDescription>
              Add commission to <strong>{creditCustomer?.full_name}</strong>'s affiliate balance.
              Current available: {formatGHS(creditCustomer?.available_commission || 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm">Amount (GHS)</Label>
            <Input type="number" step="0.01" min="0.01" value={creditAmount || ''} onChange={e => setCreditAmount(parseFloat(e.target.value) || 0)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreditCommission} disabled={processing || creditAmount <= 0}>
              {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Credit {creditAmount > 0 ? formatGHS(creditAmount) : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Debit Commission Dialog */}
      <AlertDialog open={!!debitCustomer} onOpenChange={open => { if (!open) { setDebitCustomer(null); setDebitAmount(0); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Debit Commission</AlertDialogTitle>
            <AlertDialogDescription>
              Deduct commission from <strong>{debitCustomer?.full_name}</strong>'s affiliate balance.
              Current available: {formatGHS(debitCustomer?.available_commission || 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm">Amount (GHS)</Label>
            <Input type="number" step="0.01" min="0.01" value={debitAmount || ''} onChange={e => setDebitAmount(parseFloat(e.target.value) || 0)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDebitCommission} disabled={processing || debitAmount <= 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Debit {debitAmount > 0 ? formatGHS(debitAmount) : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
