import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { formatGHS } from '@/lib/mock-data';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { StatusBadge } from '@/components/StatusBadge';
import { CustomerReferralList } from '@/components/affiliate/CustomerReferralList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Copy, Check, Users, DollarSign, Clock, Gift, Search, ChevronLeft, ChevronRight, Loader2, Eye, Share2, MessageCircle, Link2, ArrowDownToLine, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { useIsMobile } from '@/hooks/use-mobile';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';
import { normalizePhone, isValidPhone, PHONE_ERROR_MESSAGE } from '@/lib/validation';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

interface Withdrawal {
  id: string;
  source: 'payout' | 'legacy';
  short_id?: string | null;
  amount: number;
  status: string;
  created_at: string;
  processed_at: string | null;
  admin_note: string | null;
  momo_number: string;
  momo_name: string;
  network?: string | null;
  paystack_reference?: string | null;
  failure_reason?: string | null;
}

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Pending',
  approved: 'Approved',
  processing: 'Processing',
  success: 'Successful',
  failed: 'Failed',
  reversed: 'Reversed',
  cancelled: 'Cancelled',
};

export default function AffiliatePage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [detailWithdrawal, setDetailWithdrawal] = useState<Withdrawal | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [momoNumber, setMomoNumber] = useState('');
  const [momoName, setMomoName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [lockedCommission, setLockedCommission] = useState(0);
  const [network, setNetwork] = useState<'MTN' | 'VOD' | 'ATL'>('MTN');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [referralCount, setReferralCount] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);

  const referralLink = `${window.location.origin}/?ref=${encodeURIComponent(user?.affiliate_code || '')}`;

  const refreshAll = useCallback(() => {
    loadWithdrawals();
    loadReferralCount();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    refreshAll();
  }, [user?.id, refreshAll]);

  useRealtimeRefresh(['payouts', 'affiliate_withdrawals', 'customers'], refreshAll, 'affiliate-live');

  const loadReferralCount = async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_referral_count');
      if (!error) setReferralCount(data || 0);
    } catch {
      // silent
    }
  };

  const loadWithdrawals = async () => {
    try {
      // Load BOTH new payouts and legacy withdrawals for full history continuity.
      const [payoutsRes, legacyRes, custRes] = await Promise.all([
        supabase
          .from('payouts')
          .select('id, short_id, amount, status, created_at, processed_at, completed_at, admin_note, momo_number, momo_name, network, paystack_transfer_reference, failure_reason')
          .eq('payout_type', 'affiliate')
          .eq('owner_id', user!.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('affiliate_withdrawals')
          .select('id, amount, status, created_at, processed_at, admin_note, momo_number, momo_name')
          .eq('customer_id', user!.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('customers')
          .select('locked_commission')
          .eq('id', user!.id)
          .maybeSingle(),
      ]);

      const payouts: Withdrawal[] = ((payoutsRes.data as any[]) || []).map(p => ({
        id: p.id,
        source: 'payout',
        short_id: p.short_id,
        amount: Number(p.amount),
        status: p.status,
        created_at: p.created_at,
        processed_at: p.completed_at || p.processed_at || null,
        admin_note: p.admin_note,
        momo_number: p.momo_number || '',
        momo_name: p.momo_name || '',
        network: p.network,
        paystack_reference: p.paystack_transfer_reference,
        failure_reason: p.failure_reason,
      }));

      const legacy: Withdrawal[] = ((legacyRes.data as any[]) || []).map(w => ({
        id: w.id,
        source: 'legacy',
        amount: Number(w.amount),
        status: w.status,
        created_at: w.created_at,
        processed_at: w.processed_at,
        admin_note: w.admin_note,
        momo_number: w.momo_number || '',
        momo_name: w.momo_name || '',
      }));

      const merged = [...payouts, ...legacy].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setWithdrawals(merged);
      setLockedCommission(Number((custRes.data as any)?.locked_commission || 0));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopiedLink(true);
    toast({ title: 'Referral link copied', description: 'Share it with others to earn commissions.', variant: 'success' });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const shareMessage = `Join DATA360 and get great data deals! Sign up with my referral link: ${referralLink}`;

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`, '_blank');
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join DATA360', text: shareMessage, url: referralLink });
      } catch {
        // user cancelled
      }
    } else {
      shareWhatsApp();
    }
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (!momoNumber.trim()) {
      toast({ title: 'MoMo number required', description: 'Please enter your Mobile Money number to receive your payout.', variant: 'destructive' });
      return;
    }
    if (!isValidPhone(momoNumber)) {
      toast({ title: 'Invalid MoMo number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
      return;
    }
    if (!momoName.trim()) {
      toast({ title: 'MoMo name required', description: 'Please enter the name registered on your Mobile Money account.', variant: 'destructive' });
      return;
    }
    if (!withdrawAmount || isNaN(amt) || amt <= 0) {
      toast({ title: 'Invalid amount', description: 'Please enter a valid withdrawal amount greater than zero.', variant: 'destructive' });
      return;
    }
    if (amt < 20) {
      toast({ title: 'Below minimum amount', description: 'The minimum withdrawal amount is GHS 20.00. Please enter a higher amount.', variant: 'destructive' });
      return;
    }
    if (amt > (user?.available_commission || 0)) {
      toast({ title: 'Insufficient commission balance', description: `Your available balance is ${formatGHS(user?.available_commission || 0)}. Please enter an amount within your balance.`, variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const idem = `aff-${user!.id}-${Date.now()}`;
      const { data, error } = await supabase.rpc('request_affiliate_payout', {
        p_amount: amt,
        p_momo_number: normalizePhone(momoNumber),
        p_momo_name: momoName.trim(),
        p_network: network,
        p_idempotency_key: idem,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.error) throw new Error(res.error);

      setWithdrawAmount('');
      setMomoNumber('');
      setMomoName('');
      await refreshUser();
      await loadWithdrawals();
      toast({ title: 'Payout requested', description: `${formatGHS(amt)} is locked and pending admin approval.`, variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Withdrawal request failed', description: err?.message || 'Something went wrong. Please try again later or contact support.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    return withdrawals.filter(w => {
      const matchStatus = statusFilter === 'all' || w.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q || w.id.toLowerCase().includes(q) || (w.admin_note || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [withdrawals, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleReset = () => {
    setSearch(''); setStatusFilter('all'); setRowsPerPage(10); setCurrentPage(1);
  };

  const SUCCESSFUL_STATUSES = new Set(['success', 'approved']); // 'approved' covers legacy paid out
  const totalWithdrawn = withdrawals
    .filter(w => SUCCESSFUL_STATUSES.has(w.status))
    .reduce((s, w) => s + Number(w.amount), 0);

  const counts = useMemo(() => {
    const c = { pending: 0, processing: 0, success: 0, failed: 0 };
    withdrawals.forEach(w => {
      if (w.status === 'pending_approval' || w.status === 'pending' || w.status === 'approved' && w.source === 'payout') c.pending++;
      else if (w.status === 'processing') c.processing++;
      else if (SUCCESSFUL_STATUSES.has(w.status)) c.success++;
      else if (w.status === 'failed' || w.status === 'reversed' || w.status === 'rejected' || w.status === 'cancelled') c.failed++;
    });
    return c;
  }, [withdrawals]);

  if (loading) {
    return (
      <CustomerLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout>
       <div className="space-y-6 sm:space-y-8">
        {/* Header */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Affiliate Program</h1>
          <p className="text-sm text-muted-foreground mt-1">Earn commissions by referring others to DATA360</p>
        </motion.div>

        {/* — Overview Section — */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Overview</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            {[
              { label: 'Total Earned', value: formatGHS(user?.total_commission || 0), icon: <TrendingUp className="w-4 h-4" />, iconClass: 'icon-box-success', accent: 'border-t-success/40', valueColor: 'text-success' },
              { label: 'Available', value: formatGHS(user?.available_commission || 0), icon: <DollarSign className="w-4 h-4" />, iconClass: 'icon-box-amber', accent: 'border-t-amber/40', valueColor: 'text-amber' },
              { label: 'Locked', value: formatGHS(lockedCommission), icon: <Clock className="w-4 h-4" />, iconClass: 'icon-box-info', accent: 'border-t-info/40', valueColor: 'text-info' },
              { label: 'Withdrawn', value: formatGHS(totalWithdrawn), icon: <ArrowDownToLine className="w-4 h-4" />, iconClass: 'icon-box-primary', accent: 'border-t-primary/40', valueColor: 'text-primary' },
              { label: 'Pending', value: String(counts.pending), icon: <Clock className="w-4 h-4" />, iconClass: 'icon-box-amber', accent: 'border-t-amber/40', valueColor: 'text-amber' },
              { label: 'Processing', value: String(counts.processing), icon: <Loader2 className="w-4 h-4" />, iconClass: 'icon-box-info', accent: 'border-t-info/40', valueColor: 'text-info' },
              { label: 'Successful', value: String(counts.success), icon: <Check className="w-4 h-4" />, iconClass: 'icon-box-success', accent: 'border-t-success/40', valueColor: 'text-success' },
              { label: 'Failed/Reversed', value: String(counts.failed), icon: <Gift className="w-4 h-4" />, iconClass: 'icon-box-purple', accent: 'border-t-purple/40', valueColor: 'text-destructive' },
              { label: 'Referrals', value: String(referralCount), icon: <Users className="w-4 h-4" />, iconClass: 'icon-box-purple', accent: 'border-t-purple/40', valueColor: 'text-purple' },
            ].map(s => (
              <div key={s.label} className={`glass-card p-4 lg:p-5 border-t-2 ${s.accent} card-hover card-shine`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] lg:text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</span>
                  <div className={`icon-box icon-box-md lg:icon-box-lg ${s.iconClass}`}>{s.icon}</div>
                </div>
                <p className={`text-xl lg:text-[1.65rem] font-display font-bold tabular-nums ${s.valueColor}`}>{s.value}</p>
              </div>
            ))}
          </motion.div>
        </section>

        {/* — Referral & Withdraw Section — */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Referral & Withdraw</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
          {/* Share Your Link */}
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}
            className="glass-card p-4 lg:p-5 flex flex-col" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Link2 className="w-3.5 h-3.5" />
              </div>
              <h3 className="font-display font-semibold text-foreground text-sm">Share Your Link</h3>
            </div>

            <div className="space-y-1.5 mb-3">
              <Label className="text-[11px] text-muted-foreground">Referral Link</Label>
              <div className="flex gap-1.5">
                <Input value={referralLink} readOnly className="text-xs flex-1 h-9" />
                <Button variant="outline" size="icon" onClick={copyLink} className="shrink-0 h-9 w-9">
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={shareWhatsApp} className="gap-1.5 text-xs h-8">
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </Button>
              <Button variant="outline" size="sm" onClick={shareNative} className="gap-1.5 text-xs h-8">
                <Share2 className="w-3.5 h-3.5" /> Share
              </Button>
            </div>

            <div className="mt-auto pt-3">
              <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2.5 flex items-center gap-3">
                <div className="icon-box icon-box-md icon-box-primary shrink-0">
                  <Users className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground leading-tight">People Referred</p>
                  <p className="text-base font-display font-bold text-foreground tabular-nums">{referralCount}</p>
                </div>
                <p className="text-[10px] text-muted-foreground text-right max-w-[120px] hidden sm:block">
                  Total signups using your link
                </p>
              </div>
            </div>
          </motion.div>

          {/* Request Withdrawal */}
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.15 }}
            className="glass-card p-4 lg:p-5 flex flex-col" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="icon-box icon-box-sm icon-box-amber">
                <ArrowDownToLine className="w-3.5 h-3.5" />
              </div>
              <h3 className="font-display font-semibold text-foreground text-sm">Request Withdrawal</h3>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3">
              <span>Available: <span className="font-semibold text-foreground">{formatGHS(user?.available_commission || 0)}</span></span>
              <span className="w-px h-3 bg-border" />
              <span>Min: <span className="font-semibold text-foreground">GHS 20</span></span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">MoMo Number</Label>
                <Input
                  placeholder="e.g. 0241234567"
                  value={momoNumber}
                  onChange={e => setMomoNumber(normalizePhone(e.target.value))}
                  disabled={submitting}
                  className="h-9 text-sm"
                  type="tel"
                  inputMode="numeric"
                 
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">MoMo Name</Label>
                <Input placeholder="Account name" value={momoName} onChange={e => setMomoName(e.target.value)} disabled={submitting} className="h-9 text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Network</Label>
                <Select value={network} onValueChange={(v) => setNetwork(v as 'MTN' | 'VOD' | 'ATL')} disabled={submitting}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MTN">MTN</SelectItem>
                    <SelectItem value="VOD">Telecel (Vodafone)</SelectItem>
                    <SelectItem value="ATL">AirtelTigo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Amount (GHS)</Label>
                <Input placeholder="Min 20" type="number" min="20" step="0.01" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} disabled={submitting} className="h-9 text-sm" />
              </div>
            </div>

            <Button onClick={handleWithdraw} disabled={submitting} className="h-9 w-full gradient-primary text-primary-foreground border-0">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              {submitting ? 'Processing...' : 'Request Payout'}
            </Button>
            <p className="text-[10px] text-muted-foreground mt-2">Funds are locked at request and sent via Paystack after admin approval. If the transfer fails, the locked amount is returned to your available balance.</p>
          </motion.div>
          </div>
        </section>

        {/* — Your Referrals Section — */}
        <CustomerReferralList />

        {/* — Withdrawal History Section — */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Withdrawal History</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.2 }}>
          <div className="glass-card overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
            {/* History Header + Filters */}
            <div className="px-4 pt-4 pb-3 border-b border-border/50">
              <div className="flex flex-wrap items-end gap-3">
                <h3 className="font-display font-semibold text-foreground text-sm flex items-center gap-2 mr-auto">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Withdrawal History
                  <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
                </h3>
                <div className="relative min-w-[160px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="pl-8 h-8 text-xs" />
                </div>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending_approval">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="success">Successful</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="reversed">Reversed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="pending">Legacy: Pending</SelectItem>
                    <SelectItem value="rejected">Legacy: Rejected</SelectItem>
                  </SelectContent>
                </Select>
                {(search || statusFilter !== 'all') && (
                  <Button size="sm" variant="ghost" onClick={handleReset} className="h-8 text-xs px-2">Reset</Button>
                )}
              </div>
            </div>

            {/* Table / Cards */}
            {isMobile ? (
              <div className="space-y-0 divide-y divide-border/40">
                {paginated.length === 0 && <p className="text-center text-muted-foreground py-12 text-sm">No withdrawals found</p>}
                {paginated.map(w => (
                  <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <StatusBadge status={w.status as any} />
                        <span className="text-[10px] text-muted-foreground">{new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{formatGHS(Number(w.amount))}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setDetailWithdrawal(w)}>
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-primary">Date</TableHead>
                      <TableHead className="text-primary">Amount</TableHead>
                      <TableHead className="text-primary">Status</TableHead>
                      <TableHead className="text-primary">Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-12">No withdrawals found</TableCell>
                      </TableRow>
                    ) : (
                      paginated.map(w => (
                        <TableRow key={w.id} className="hover:bg-muted/30">
                          <TableCell className="text-foreground whitespace-nowrap text-sm">
                            {new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {' '}
                            <span className="text-muted-foreground text-xs">
                              {new Date(w.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </TableCell>
                          <TableCell className="text-foreground font-semibold text-sm tabular-nums">{formatGHS(Number(w.amount))}</TableCell>
                          <TableCell><StatusBadge status={w.status as any} /></TableCell>
                          <TableCell className="text-muted-foreground text-sm">{w.admin_note || '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            {filtered.length > 0 && (
              <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border/50">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)} className="h-7 text-xs">
                  <ChevronLeft className="w-3.5 h-3.5 mr-0.5" /> Prev
                </Button>
                <span className="text-xs text-muted-foreground px-2 tabular-nums">{currentPage} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} className="h-7 text-xs">
                  Next <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </Button>
              </div>
            )}
          </div>
        </motion.div>
        </section>

        {/* Detail Dialog */}
        <DetailViewDialog
          open={!!detailWithdrawal}
          onOpenChange={() => setDetailWithdrawal(null)}
          title="Withdrawal Details"
          fields={detailWithdrawal ? [
            { label: 'Date', value: new Date(detailWithdrawal.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + new Date(detailWithdrawal.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
            { label: 'Amount', value: formatGHS(Number(detailWithdrawal.amount)) },
            { label: 'MoMo Number', value: detailWithdrawal.momo_number || '—' },
            { label: 'MoMo Name', value: detailWithdrawal.momo_name || '—' },
            { label: 'Status', value: detailWithdrawal.status },
            ...(detailWithdrawal.processed_at ? [{ label: 'Processed On', value: new Date(detailWithdrawal.processed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + new Date(detailWithdrawal.processed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }] : []),
            { label: 'Admin Note', value: detailWithdrawal.admin_note || '—' },
          ] : []}
        />
      </div>
    </CustomerLayout>
  );
}
