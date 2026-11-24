import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { invokeAdminFunction } from '@/lib/admin-functions';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { formatGHS } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Pagination } from '@/components/Pagination';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { MobileCard } from '@/components/MobileCard';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  ArrowLeft, User, Wallet, ShoppingCart, CreditCard, Clock, StickyNote,
  ShieldAlert, Search, Calendar, Mail, Phone, Hash, UserCheck,
  TrendingUp, ArrowUpDown, Filter, Save, AlertTriangle,
  CheckCircle, XCircle, RefreshCw, Loader2, Trash2, Link2, Users,
  Tag, Plus, X, MoreHorizontal, Eye, ArrowUpCircle, ArrowDownCircle
} from 'lucide-react';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';

function classifyTxSource(tx: { type: string; description: string; admin_id: string | null }): string {
  if (tx.admin_id) return tx.type === 'credit' ? 'Manual Credit' : 'Manual Debit';
  const desc = (tx.description || '').toLowerCase();
  if (desc.includes('data purchase') || desc.includes('order')) return 'Order Purchase';
  if (desc.includes('top-up') || desc.includes('topup')) return 'Topup Approval';
  if (desc.includes('paystack')) return 'Paystack Topup';
  if (desc.includes('refund')) return 'Refund';
  if (desc.includes('commission') || desc.includes('affiliate')) return 'Affiliate Commission';
  return tx.type === 'credit' ? 'Credit' : 'Debit';
}
import { CustomerReferralsSection } from '@/components/admin/CustomerReferralsSection';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

// Pure helpers — module-level to avoid per-render allocation
const sanitizeSearch = (s: string) => s.replace(/[\\%_]/g, c => '\\' + c).trim();
const fmtDate = (d: string) => format(new Date(d), 'MMM d, yyyy · h:mm a');
const fmtShort = (d: string) => format(new Date(d), 'MMM d, yyyy');

const PREDEFINED_TAGS = ['VIP', 'Flagged', 'New', 'High Volume', 'Disputed', 'Needs Review', 'Trusted', 'Test Account'] as const;

// Stable table list for realtime subscription (avoids array recreation)
const REALTIME_TABLES: Array<'orders' | 'topups' | 'wallet_transactions' | 'customers'> = ['orders', 'topups', 'wallet_transactions', 'customers'];

// ─── Types ───

interface CustomerDetail {
  id: string; full_name: string; username: string | null; email: string;
  phone: string; wallet_balance: number; status: string; affiliate_code: string;
  referred_by: string | null; email_verified: boolean; created_at: string;
  total_commission: number; available_commission: number;
}

interface Order {
  id: string; short_id: string; network: string; bundle_size: string;
  recipient_phone: string; total_amount: number; status: string;
  created_at: string;
}

interface Topup {
  id: string; short_id: string; amount: number; method: string;
  network: string; momo_number: string; status: string; created_at: string;
  is_manual?: boolean; admin_name?: string | null; description?: string | null;
}

interface WalletTx {
  id: string; type: string; amount: number; description: string;
  reference: string; created_at: string;
  balance_before: number | null; balance_after: number | null;
  admin_id: string | null; admin_name: string | null;
  source: string;
}

interface AdminNote {
  id: string; admin_name: string; note: string; created_at: string;
}

interface ReferrerInfo {
  id: string; full_name: string; username: string | null; email: string;
  affiliate_code: string; status: string; created_at: string;
}

// ─── Sub-components ───

function MiniStatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="kpi-card group card-shine">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 leading-tight">{label}</p>
        <div className="icon-box icon-box-sm icon-box-primary transition-transform duration-300 group-hover:scale-110 shrink-0">
          {icon}
        </div>
      </div>
      <p className="text-base sm:text-lg font-bold text-foreground tabular-nums tracking-tight leading-none truncate">{value}</p>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground/60 mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">{label}</p>
        <div className="text-sm text-foreground mt-0.5 break-words">{value}</div>
      </div>
    </div>
  );
}

function TimelineItem({ icon, title, time, accent }: { icon: React.ReactNode; title: string; time: string; accent?: string }) {
  return (
    <div className="flex gap-3 items-start relative z-10">
      <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${accent || 'bg-muted text-muted-foreground'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground/60">{time}</p>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ComponentType<{ className?: string }>; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Icon className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// ─── Main Component ───

export default function AdminCustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const isMobile = useIsMobile();
  const pageSize = isMobile ? 10 : 20;

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Orders pagination state ───
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderSort, setOrderSort] = useState<'newest' | 'oldest' | 'highest'>('newest');

  // ─── Topups pagination state ───
  const [topups, setTopups] = useState<Topup[]>([]);
  const [topupsTotal, setTopupsTotal] = useState(0);
  const [topupsPage, setTopupsPage] = useState(1);
  const [topupsLoading, setTopupsLoading] = useState(false);

  // ─── Wallet Tx pagination state ───
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([]);
  const [walletTxsTotal, setWalletTxsTotal] = useState(0);
  const [walletTxsPage, setWalletTxsPage] = useState(1);
  const [walletTxsLoading, setWalletTxsLoading] = useState(false);
  const [walletTxTypeFilter, setWalletTxTypeFilter] = useState<string>('all');
  const [walletTxSourceFilter, setWalletTxSourceFilter] = useState<string>('all');
  const [walletTxSearch, setWalletTxSearch] = useState<string>('');
  const [walletTxDetail, setWalletTxDetail] = useState<WalletTx | null>(null);

  // ─── Aggregate stats (lightweight counts) ───
  const [statsData, setStatsData] = useState({ totalOrders: 0, totalTopups: 0, totalSpent: 0, deliveredOrders: 0, failedOrders: 0, refundedOrders: 0, lastOrder: null as string | null, lastTopup: null as string | null });

  // Admin notes
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Referral info
  const [referrer, setReferrer] = useState<ReferrerInfo | null>(null);
  const [referrerLoading, setReferrerLoading] = useState(false);
  const [commissionFromCustomer, setCommissionFromCustomer] = useState(0);

  // Customer tags
  const [customerTags, setCustomerTags] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);

  // Wallet actions (credit/debit)
  const [walletAction, setWalletAction] = useState<'credit_wallet' | 'debit_wallet' | null>(null);
  const [walletAmount, setWalletAmount] = useState('');
  const [walletReason, setWalletReason] = useState('');
  const [walletActionLoading, setWalletActionLoading] = useState(false);

  // Commission actions
  type CommissionAction = 'credit_commission' | 'deduct_commission' | 'reverse_commission';
  const [commissionAction, setCommissionAction] = useState<CommissionAction | null>(null);
  const [commissionAmount, setCommissionAmount] = useState('');
  const [commissionReason, setCommissionReason] = useState('');
  const [commissionActionLoading, setCommissionActionLoading] = useState(false);

  // Guards & stable refs
  const ordersReqId = useRef(0);
  const topupsReqId = useRef(0);
  const walletTxsReqId = useRef(0);
  const mountedRef = useRef(true);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const adminCacheRef = useRef<{ id: string; name: string } | null>(null);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Eagerly resolve current admin record for tag/note operations
  useEffect(() => {
    if (!authUser || adminCacheRef.current) return;
    supabase.from('admin_users').select('id, name').eq('auth_user_id', authUser.id).eq('status', 'active').maybeSingle()
      .then(({ data }) => { if (data) adminCacheRef.current = { id: data.id, name: data.name }; });
  }, [authUser]);

  // Debounce order search input (300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrderSearch(orderSearch), 300);
    return () => clearTimeout(t);
  }, [orderSearch]);

  // Reset all pages when pageSize changes (mobile ↔ desktop)
  const prevPageSize = useRef(pageSize);
  useEffect(() => {
    if (prevPageSize.current !== pageSize) {
      prevPageSize.current = pageSize;
      setOrdersPage(1);
      setTopupsPage(1);
      setWalletTxsPage(1);
    }
  }, [pageSize]);

  // ─── Load Customer + Stats ───
  const loadCustomer = useCallback(async () => {
    if (!customerId) return;
    try {
      const { data, error: custErr } = await supabase
        .from('customers').select('*').eq('id', customerId).single();
      if (!mountedRef.current) return;
      if (custErr) throw custErr;
      if (!data) throw new Error('Customer not found');
      setCustomer(data as CustomerDetail);

      // Lightweight aggregate queries for stats
      const [ordCount, topCount, manualCount, deliveredRes, failedRes, refundedRes, lastOrdRes, lastTopRes, lastManualRes, spentRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
        supabase.from('topups').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
        supabase.from('wallet_transactions').select('id', { count: 'exact', head: true }).eq('customer_id', customerId).eq('type', 'credit').not('admin_id', 'is', null),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', customerId).eq('status', 'delivered'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', customerId).in('status', ['failed', 'rejected']),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('customer_id', customerId).eq('status', 'refunded'),
        supabase.from('orders').select('created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1),
        supabase.from('topups').select('created_at').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1),
        supabase.from('wallet_transactions').select('created_at').eq('customer_id', customerId).eq('type', 'credit').not('admin_id', 'is', null).order('created_at', { ascending: false }).limit(1),
        supabase.from('orders').select('total_amount, status').eq('customer_id', customerId).limit(1000),
      ]);

      if (!mountedRef.current) return;
      // Spent excludes refunded/cancelled/rejected orders (money was returned to the customer).
      const REFUNDED_STATUSES = new Set(['customer_cancelled', 'cancelled_before_processing', 'rejected', 'refunded']);
      const totalSpent = (spentRes.data || [])
        .filter((r: any) => !REFUNDED_STATUSES.has(r.status))
        .reduce((s: number, r: any) => s + Number(r.total_amount), 0);

      const lastTopupDate = lastTopRes.data?.[0]?.created_at || null;
      const lastManualDate = lastManualRes.data?.[0]?.created_at || null;
      const lastTopupCombined = [lastTopupDate, lastManualDate]
        .filter(Boolean)
        .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] || null;

      setStatsData({
        totalOrders: ordCount.count || 0,
        totalTopups: (topCount.count || 0) + (manualCount.count || 0),
        totalSpent,
        deliveredOrders: deliveredRes.count || 0,
        failedOrders: failedRes.count || 0,
        refundedOrders: refundedRes.count || 0,
        lastOrder: lastOrdRes.data?.[0]?.created_at || null,
        lastTopup: lastTopupCombined,
      });

      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'Failed to load customer data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [customerId]);

  // ─── Load Orders (paginated, filtered, sorted) ───
  const loadOrders = useCallback(async () => {
    if (!customerId) return;
    const reqId = ++ordersReqId.current;
    setOrdersLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select('id, short_id, network, bundle_size, recipient_phone, total_amount, status, created_at', { count: 'exact' })
        .eq('customer_id', customerId);

      if (debouncedOrderSearch) {
        const safe = sanitizeSearch(debouncedOrderSearch);
        query = query.or(`short_id.ilike.%${safe}%,recipient_phone.ilike.%${safe}%`);
      }
      if (orderStatusFilter !== 'all') {
        query = query.eq('status', orderStatusFilter);
      }

      if (orderSort === 'oldest') query = query.order('created_at', { ascending: true });
      else if (orderSort === 'highest') query = query.order('total_amount', { ascending: false });
      else query = query.order('created_at', { ascending: false });

      const from = (ordersPage - 1) * pageSize;
      query = query.range(from, from + pageSize - 1);

      const { data, count, error } = await query;
      if (reqId !== ordersReqId.current) return;
      if (error) throw error;
      setOrders((data || []) as Order[]);
      setOrdersTotal(count || 0);
    } catch {
      if (reqId !== ordersReqId.current) return;
      toastRef.current({ title: 'Failed to load orders', variant: 'destructive' });
    } finally {
      if (reqId === ordersReqId.current) setOrdersLoading(false);
    }
  }, [customerId, ordersPage, pageSize, debouncedOrderSearch, orderStatusFilter, orderSort]);

  // ─── Load Topups (paginated) — includes manual admin wallet credits ───
  const loadTopups = useCallback(async () => {
    if (!customerId) return;
    const reqId = ++topupsReqId.current;
    setTopupsLoading(true);
    try {
      const [topupsRes, manualRes] = await Promise.all([
        supabase
          .from('topups')
          .select('id, short_id, amount, method, network, momo_number, status, created_at')
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase
          .from('wallet_transactions')
          .select('id, amount, description, reference, created_at, admin_id, admin_users!wallet_transactions_admin_id_fkey(name)')
          .eq('customer_id', customerId)
          .eq('type', 'credit')
          .not('admin_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);
      if (reqId !== topupsReqId.current) return;
      if (topupsRes.error) throw topupsRes.error;
      if (manualRes.error) throw manualRes.error;

      const paystackTopups: Topup[] = (topupsRes.data || []) as Topup[];
      const manualTopups: Topup[] = (manualRes.data || []).map((t: any) => ({
        id: t.id,
        short_id: (t.reference || t.id).slice(0, 12).toUpperCase(),
        amount: Number(t.amount),
        method: 'manual',
        network: '',
        momo_number: '',
        status: 'approved',
        created_at: t.created_at,
        is_manual: true,
        admin_name: t.admin_users?.name || null,
        description: t.description || null,
      }));

      const merged = [...paystackTopups, ...manualTopups]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = merged.length;
      const from = (topupsPage - 1) * pageSize;
      const pageRows = merged.slice(from, from + pageSize);

      setTopups(pageRows);
      setTopupsTotal(total);
    } catch {
      if (reqId !== topupsReqId.current) return;
      toastRef.current({ title: 'Failed to load top-ups', variant: 'destructive' });
    } finally {
      if (reqId === topupsReqId.current) setTopupsLoading(false);
    }
  }, [customerId, topupsPage, pageSize]);

  // ─── Load Wallet Txs (paginated) ───
  const loadWalletTxs = useCallback(async () => {
    if (!customerId) return;
    const reqId = ++walletTxsReqId.current;
    setWalletTxsLoading(true);
    try {
      const from = (walletTxsPage - 1) * pageSize;
      const { data, count, error } = await supabase
        .from('wallet_transactions')
        .select('id, type, amount, description, reference, created_at, balance_before, balance_after, admin_id, admin_users!wallet_transactions_admin_id_fkey(name)', { count: 'exact' })
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (reqId !== walletTxsReqId.current) return;
      if (error) throw error;
      setWalletTxs((data || []).map((t: any) => ({
        id: t.id, type: t.type, amount: Number(t.amount), description: t.description || '',
        reference: t.reference || '', created_at: t.created_at,
        balance_before: t.balance_before != null ? Number(t.balance_before) : null,
        balance_after: t.balance_after != null ? Number(t.balance_after) : null,
        admin_id: t.admin_id, admin_name: t.admin_users?.name || null,
        source: classifyTxSource({ type: t.type, description: t.description || '', admin_id: t.admin_id }),
      })));
      setWalletTxsTotal(count || 0);
    } catch {
      if (reqId !== walletTxsReqId.current) return;
      toastRef.current({ title: 'Failed to load wallet transactions', variant: 'destructive' });
    } finally {
      if (reqId === walletTxsReqId.current) setWalletTxsLoading(false);
    }
  }, [customerId, walletTxsPage, pageSize]);

  // ─── Load Notes ───
  const loadNotes = useCallback(async () => {
    if (!customerId) return;
    setNotesLoading(true);
    try {
      const { data, error } = await supabase
        .from('admin_notes')
        .select('id, admin_name, note, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });
      if (!mountedRef.current) return;
      if (error) throw error;
      setNotes((data || []) as AdminNote[]);
    } catch {
      // Silently fail
    } finally {
      if (mountedRef.current) setNotesLoading(false);
    }
  }, [customerId]);

  // ─── Load Referrer Info ───
  const loadReferrer = useCallback(async () => {
    if (!customer?.referred_by) { setReferrer(null); setCommissionFromCustomer(0); return; }
    setReferrerLoading(true);
    try {
      const { data: refData } = await supabase
        .from('customers')
        .select('id, full_name, username, email, affiliate_code, status, created_at')
        .eq('affiliate_code', customer.referred_by)
        .limit(1)
        .single();
      if (!mountedRef.current) return;
      setReferrer(refData as ReferrerInfo | null);

      // Calculate commission generated from this customer's delivered orders
      // Commission = sum(total_amount) * affiliate_rate / 100
      const [rateRes, ordersRes] = await Promise.all([
        supabase.from('platform_settings').select('value').eq('key', 'affiliate_rate').single(),
        supabase.from('orders').select('total_amount').eq('customer_id', customer.id).eq('status', 'delivered').limit(1000),
      ]);
      if (!mountedRef.current) return;
      const rate = parseFloat(rateRes.data?.value || '2') / 100;
      const totalDelivered = (ordersRes.data || []).reduce((s: number, r: any) => s + Number(r.total_amount), 0);
      setCommissionFromCustomer(Math.round(totalDelivered * rate * 100) / 100);
    } catch {
      if (mountedRef.current) setReferrer(null);
    } finally {
      if (mountedRef.current) setReferrerLoading(false);
    }
  }, [customer?.referred_by, customer?.id]);

  // ─── Load Tags ───
  const loadTags = useCallback(async () => {
    if (!customerId) return;
    setTagsLoading(true);
    try {
      const { data, error } = await supabase
        .from('customer_tags')
        .select('tag')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: true });
      if (!mountedRef.current) return;
      if (error) throw error;
      setCustomerTags((data || []).map((r: any) => r.tag));
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setTagsLoading(false);
    }
  }, [customerId]);

  const addTag = async (tag: string) => {
    if (!customerId || !authUser) return;
    try {
      if (!adminCacheRef.current) {
        const { data: adminRow, error: adminErr } = await supabase.from('admin_users').select('id, name').eq('auth_user_id', authUser.id).maybeSingle();
        if (adminErr) throw new Error('Failed to look up admin: ' + adminErr.message);
        if (!adminRow) throw new Error('Admin not found. Your auth account may not be linked to an admin record.');
        adminCacheRef.current = { id: adminRow.id, name: adminRow.name };
      }
      const { error } = await supabase.from('customer_tags').insert({
        customer_id: customerId, tag, created_by: adminCacheRef.current.id,
      });
      if (error) throw error;
      setCustomerTags(prev => [...prev, tag]);
      setShowTagPicker(false);
      toast({ title: `Tag "${tag}" added`, variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Failed to add tag', description: err?.message, variant: 'destructive' });
    }
  };

  const removeTag = async (tag: string) => {
    if (!customerId) return;
    try {
      const { error } = await supabase.from('customer_tags').delete().eq('customer_id', customerId).eq('tag', tag);
      if (error) throw error;
      setCustomerTags(prev => prev.filter(t => t !== tag));
      toast({ title: `Tag "${tag}" removed`, variant: 'success' });
    } catch {
      toast({ title: 'Failed to remove tag', variant: 'destructive' });
    }
  };

  // ─── Effects ───
  useEffect(() => { loadCustomer(); loadNotes(); loadTags(); }, [loadCustomer, loadNotes, loadTags]);
  useEffect(() => { loadReferrer(); }, [loadReferrer]);
  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { loadTopups(); }, [loadTopups]);
  useEffect(() => { loadWalletTxs(); }, [loadWalletTxs]);

  // Reset to page 1 when filters change (skip initial mount)
  const filtersInitialized = useRef(false);
  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    setOrdersPage(1);
  }, [debouncedOrderSearch, orderStatusFilter, orderSort]);

  // Throttled realtime refresh — coalesce rapid events (e.g. batch order updates)
  const realtimeCooldown = useRef(false);
  const realtimeRefreshAll = useCallback(() => {
    if (realtimeCooldown.current || !mountedRef.current) return;
    realtimeCooldown.current = true;
    loadCustomer(); loadOrders(); loadTopups(); loadWalletTxs(); loadNotes(); loadTags();
    setTimeout(() => { realtimeCooldown.current = false; }, 2000);
  }, [loadCustomer, loadOrders, loadTopups, loadWalletTxs, loadNotes, loadTags]);

  useRealtimeRefresh(REALTIME_TABLES, realtimeRefreshAll, `admin-cust-detail-${customerId}`);

  // ─── Computed ───
  const avgOrderValue = statsData.totalOrders > 0 ? statsData.totalSpent / statsData.totalOrders : 0;
  const ordersTotalPages = Math.max(1, Math.ceil(ordersTotal / pageSize));
  const topupsTotalPages = Math.max(1, Math.ceil(topupsTotal / pageSize));
  const walletTxsTotalPages = Math.max(1, Math.ceil(walletTxsTotal / pageSize));

  // Clamp current page if it exceeds total pages (safety net for pageSize/filter changes)
  useEffect(() => {
    if (ordersPage > 1 && ordersPage > ordersTotalPages) setOrdersPage(Math.max(1, ordersTotalPages));
  }, [ordersPage, ordersTotalPages]);
  useEffect(() => {
    if (topupsPage > 1 && topupsPage > topupsTotalPages) setTopupsPage(Math.max(1, topupsTotalPages));
  }, [topupsPage, topupsTotalPages]);
  useEffect(() => {
    if (walletTxsPage > 1 && walletTxsPage > walletTxsTotalPages) setWalletTxsPage(Math.max(1, walletTxsTotalPages));
  }, [walletTxsPage, walletTxsTotalPages]);

  // ─── Activity Timeline ───
  const timeline = useMemo(() => {
    if (!customer) return [];
    const items: { icon: React.ReactNode; title: string; time: string; ts: number; accent: string }[] = [];
    items.push({ icon: <UserCheck className="w-3.5 h-3.5" />, title: 'Signed up', time: format(new Date(customer.created_at), 'MMM d, yyyy · h:mm a'), ts: new Date(customer.created_at).getTime(), accent: 'bg-primary/15 text-primary' });
    if (customer.email_verified) {
      items.push({ icon: <Mail className="w-3.5 h-3.5" />, title: 'Email verified', time: 'Verified', ts: new Date(customer.created_at).getTime() + 1, accent: 'bg-success/15 text-success' });
    }
    if (statsData.lastTopup) {
      items.push({ icon: <CreditCard className="w-3.5 h-3.5" />, title: 'Latest top-up', time: format(new Date(statsData.lastTopup), 'MMM d, yyyy · h:mm a'), ts: new Date(statsData.lastTopup).getTime(), accent: 'bg-teal/15 text-teal' });
    }
    if (statsData.lastOrder) {
      items.push({ icon: <ShoppingCart className="w-3.5 h-3.5" />, title: 'Latest order', time: format(new Date(statsData.lastOrder), 'MMM d, yyyy · h:mm a'), ts: new Date(statsData.lastOrder).getTime(), accent: 'bg-purple/15 text-purple' });
    }
    return items.sort((a, b) => b.ts - a.ts);
  }, [customer, statsData]);

  // ─── Save Note (caches admin identity to avoid repeated lookups) ───
  const saveNote = async () => {
    if (!newNote.trim() || !customerId || !authUser) return;
    setSavingNote(true);
    try {
      if (!adminCacheRef.current) {
        const { data: adminRow, error: adminErr } = await supabase
          .from('admin_users').select('id, name').eq('auth_user_id', authUser.id).maybeSingle();
        if (adminErr || !adminRow) throw new Error('Could not identify admin user');
        adminCacheRef.current = { id: adminRow.id, name: adminRow.name };
      }
      const admin = adminCacheRef.current;
      const { error } = await supabase.from('admin_notes').insert({
        customer_id: customerId, admin_id: admin.id, admin_name: admin.name, note: newNote.trim(),
      });
      if (error) throw error;
      setNewNote('');
      toast({ title: 'Note saved', variant: 'success' });
      loadNotes();
    } catch (err: any) {
      toast({ title: 'Failed to save note', description: err?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setSavingNote(false);
    }
  };

  // ─── Delete Note ───
  const deleteNote = async (noteId: string) => {
    try {
      const { error } = await supabase.from('admin_notes').delete().eq('id', noteId);
      if (error) throw error;
      setNotes(prev => prev.filter(n => n.id !== noteId));
      toast({ title: 'Note deleted', variant: 'success' });
    } catch {
      toast({ title: 'Failed to delete note', variant: 'destructive' });
    }
  };

  // ─── Wallet Credit/Debit Action ───
  const handleWalletAction = async () => {
    if (!customerId || !walletAction || walletActionLoading) return;
    const numAmount = parseFloat(walletAmount);
    if (!numAmount || numAmount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }
    if (!walletReason.trim()) {
      toast({ title: 'Please provide a reason', variant: 'destructive' });
      return;
    }
    setWalletActionLoading(true);
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: walletAction, customer_id: customerId, amount: numAmount, reason: walletReason.trim(),
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: walletAction === 'credit_wallet' ? 'Wallet credited' : 'Wallet debited', description: `${formatGHS(numAmount)} — ${walletReason.trim()}`, variant: 'success' });
      setWalletAction(null);
      setWalletAmount('');
      setWalletReason('');
      loadCustomer();
      loadWalletTxs();
    } catch (err: any) {
      toast({ title: 'Wallet action failed', description: err?.message || 'Please try again', variant: 'destructive' });
    } finally {
      setWalletActionLoading(false);
    }
  };

  // ─── Commission Action ───
  const commissionActionLabels: Record<CommissionAction, string> = {
    credit_commission: 'Credit Commission',
    deduct_commission: 'Deduct Available Commission',
    reverse_commission: 'Reverse Commission Earnings',
  };

  const handleCommissionAction = async () => {
    if (!customerId || !commissionAction || commissionActionLoading) return;
    const numAmount = parseFloat(commissionAmount);
    if (!numAmount || numAmount <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }
    if (!commissionReason.trim()) {
      toast({ title: 'Please provide a reason', variant: 'destructive' });
      return;
    }
    setCommissionActionLoading(true);
    try {
      const { data, error } = await invokeAdminFunction('admin-customer-action', {
        action: commissionAction, customer_id: customerId, amount: numAmount, reason: commissionReason.trim(),
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: commissionActionLabels[commissionAction] + ' successful',
        description: `${formatGHS(numAmount)} — ${commissionReason.trim()}`,
        variant: 'success',
      });
      setCommissionAction(null);
      setCommissionAmount('');
      setCommissionReason('');
      loadCustomer();
    } catch (err: any) {
      toast({ title: 'Commission action failed', description: err?.message || 'Please try again', variant: 'destructive' });
    } finally {
      setCommissionActionLoading(false);
    }
  };

  // ─── Loading State ───
  if (loading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-8 w-48" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)}
          </div>
          <Skeleton className="h-10 w-full sm:w-96 rounded-lg" />
          <div className="grid md:grid-cols-2 gap-4">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ─── Error State ───
  if (error || !customer) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center py-20 space-y-4 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">{error || 'Customer not found'}</p>
            <p className="text-sm text-muted-foreground mt-1">The customer record could not be loaded.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/admin/customers')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Customers
            </Button>
            <Button variant="default" onClick={() => { setLoading(true); setError(null); loadCustomer(); }}>
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ─── Card Renderers ───
  const renderOrderCard = (o: Order) => (
    <MobileCard key={o.id} fields={[
      { label: 'Order', value: <span className="font-mono text-primary text-xs">{o.short_id}</span> },
      { label: 'Status', value: <StatusBadge status={o.status} /> },
      { label: 'Product', value: `${o.bundle_size} ${o.network}` },
      { label: 'Amount', value: <span className="font-semibold">{formatGHS(o.total_amount)}</span> },
      { label: 'Date', value: <span className="text-xs text-muted-foreground">{fmtDate(o.created_at)}</span> },
      { label: 'Phone', value: <span className="font-mono text-xs">{o.recipient_phone}</span> },
    ]} />
  );

  const renderTopupCard = (t: Topup) => (
    <MobileCard key={t.id} fields={[
      { label: 'ID', value: <span className="font-mono text-primary text-xs">{t.short_id}</span> },
      { label: 'Status', value: <StatusBadge status={t.status} /> },
      { label: 'Amount', value: <span className="font-semibold">{formatGHS(t.amount)}</span> },
      { label: 'Method', value: t.is_manual
        ? <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px]">Manual Credit</Badge>
        : <span className="capitalize">{t.method}</span> },
      { label: 'Date', value: <span className="text-xs text-muted-foreground">{fmtDate(t.created_at)}</span> },
      { label: t.is_manual ? 'By' : 'Number', value: <span className="font-mono text-xs">{t.is_manual ? (t.admin_name || 'Admin') : t.momo_number}</span> },
    ]} />
  );

  const walletTxSources = [...new Set(walletTxs.map(t => t.source))].sort();
  const filteredWalletTxs = walletTxs.filter(t => {
    const q = walletTxSearch.trim().toLowerCase();
    const matchesSearch = !q || t.description.toLowerCase().includes(q) || t.reference.toLowerCase().includes(q);
    const matchesType = walletTxTypeFilter === 'all' || t.type === walletTxTypeFilter;
    const matchesSource = walletTxSourceFilter === 'all' || t.source === walletTxSourceFilter;
    return matchesSearch && matchesType && matchesSource;
  });
  const walletTxCredits = filteredWalletTxs.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const walletTxDebits = filteredWalletTxs.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);

  const getWalletTxDetailFields = (t: WalletTx): DetailField[] => [
    { label: 'Type', value: <Badge variant="outline" className={`text-xs ${t.type === 'credit' ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>{t.type === 'credit' ? '+ Credit' : '− Debit'}</Badge> },
    ...(t.balance_before != null ? [{ label: 'Balance Before', value: formatGHS(t.balance_before) }] : []),
    { label: 'Amount', value: <span className={`font-semibold ${t.type === 'credit' ? 'text-success' : 'text-destructive'}`}>{t.type === 'credit' ? '+' : '−'}{formatGHS(t.amount)}</span> },
    ...(t.balance_after != null ? [{ label: 'Balance After', value: <span className="font-semibold">{formatGHS(t.balance_after)}</span> }] : []),
    { label: 'Source', value: t.source },
    { label: 'Description', value: t.description.replace(/\s*\(webhook\)/gi, '') || '—' },
    { label: 'Reference', value: <span className="font-mono text-xs">{t.reference || '—'}</span> },
    { label: 'Processed By', value: t.admin_name || 'System' },
    { label: 'Date', value: fmtDate(t.created_at) },
  ];

  const renderWalletTxCard = (tx: WalletTx) => (
    <MobileCard key={tx.id} fields={[
      { label: 'Type', value: <Badge variant={tx.type === 'credit' ? 'success' : 'destructive'} className="text-[10px]">{tx.type === 'credit' ? '+ Credit' : '− Debit'}</Badge> },
      { label: 'Amount', value: <span className={`font-semibold ${tx.type === 'credit' ? 'text-success' : 'text-destructive'}`}>{tx.type === 'credit' ? '+' : '−'}{formatGHS(tx.amount)}</span> },
      { label: 'Before', value: <span className="text-xs">{tx.balance_before != null ? formatGHS(tx.balance_before) : '—'}</span> },
      { label: 'After', value: <span className="text-xs font-medium">{tx.balance_after != null ? formatGHS(tx.balance_after) : '—'}</span> },
      { label: 'Source', value: <span className="text-xs">{tx.source}</span> },
      { label: 'Date', value: <span className="text-xs text-muted-foreground">{fmtDate(tx.created_at)}</span> },
    ]} action={
      <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setWalletTxDetail(tx)}>
        <Eye className="w-3.5 h-3.5" /> View Details
      </Button>
    } />
  );

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        {/* Header */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}
          className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/customers')} className="self-start gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Customers
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-display font-bold text-foreground tracking-tight truncate">{customer.full_name}</h1>
              <StatusBadge status={customer.status} />
            </div>
            {/* Customer Tags */}
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {customerTags.map(tag => (
                <Badge key={tag} variant="secondary" className="text-[10px] gap-1 pl-2 pr-1 py-0.5 group/tag">
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 transition-colors opacity-0 group-hover/tag:opacity-100"
                  >
                    <X className="w-2.5 h-2.5 text-destructive" />
                  </button>
                </Badge>
              ))}
              <div className="relative">
                <button
                  onClick={() => setShowTagPicker(!showTagPicker)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                >
                  <Plus className="w-2.5 h-2.5" /> Add Tag
                </button>
                {showTagPicker && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[160px]">
                    {PREDEFINED_TAGS.filter(t => !customerTags.includes(t)).map(tag => (
                      <button
                        key={tag}
                        onClick={() => addTag(tag)}
                        className="w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-accent transition-colors text-foreground"
                      >
                        {tag}
                      </button>
                    ))}
                    {PREDEFINED_TAGS.filter(t => !customerTags.includes(t)).length === 0 && (
                      <p className="text-xs text-muted-foreground px-2 py-1">All tags applied</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Customer since {fmtShort(customer.created_at)}</p>
          </div>
          {/* Quick Actions — desktop: inline buttons, mobile: compact with dropdown */}
          {/* Desktop buttons */}
          <div className="hidden sm:flex gap-2 self-center shrink-0 flex-wrap">
            {authUser?.adminRole === 'Super Admin' && (
              <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"
                onClick={() => { setWalletAction('credit_wallet'); setWalletAmount(''); setWalletReason(''); }}>
                <Plus className="w-3.5 h-3.5 text-success" /> Credit Wallet
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"
              onClick={() => { setWalletAction('debit_wallet'); setWalletAmount(''); setWalletReason(''); }}>
              <ArrowUpDown className="w-3.5 h-3.5 text-destructive" /> Debit Wallet
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"
              onClick={() => navigate(`/admin/wallet-ledger?customer=${customerId}`)}>
              <Wallet className="w-3.5 h-3.5" /> Wallet History
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"
              onClick={() => navigate(`/admin/orders?customer=${customerId}`)}>
              <ShoppingCart className="w-3.5 h-3.5" /> Orders
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"
              onClick={() => navigate(`/admin/topups?customer=${customerId}`)}>
              <CreditCard className="w-3.5 h-3.5" /> Top-ups
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8"
              onClick={() => navigate(`/admin/support?customer=${customerId}`)}>
              <StickyNote className="w-3.5 h-3.5" /> Tickets
            </Button>
          </div>
          {/* Mobile dropdown */}
          <div className="flex sm:hidden self-start">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8">
                  <MoreHorizontal className="w-4 h-4" /> Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {authUser?.adminRole === 'Super Admin' && (
                  <DropdownMenuItem onClick={() => { setWalletAction('credit_wallet'); setWalletAmount(''); setWalletReason(''); }}>
                    <Plus className="w-4 h-4 mr-2 text-success" /> Credit Wallet
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => { setWalletAction('debit_wallet'); setWalletAmount(''); setWalletReason(''); }}>
                  <ArrowUpDown className="w-4 h-4 mr-2 text-destructive" /> Debit Wallet
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate(`/admin/wallet-ledger?customer=${customerId}`)}>
                  <Wallet className="w-4 h-4 mr-2" /> Wallet History
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/admin/orders?customer=${customerId}`)}>
                  <ShoppingCart className="w-4 h-4 mr-2" /> Orders
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/admin/topups?customer=${customerId}`)}>
                  <CreditCard className="w-4 h-4 mr-2" /> Top-ups
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/admin/support?customer=${customerId}`)}>
                  <StickyNote className="w-4 h-4 mr-2" /> Tickets
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </motion.div>

        {/* Stat Cards */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-2.5 lg:gap-3">
          <MiniStatCard label="Total Orders" value={String(statsData.totalOrders)} icon={<ShoppingCart className="w-3.5 h-3.5" />} />
          <MiniStatCard label="Total Top-ups" value={String(statsData.totalTopups)} icon={<CreditCard className="w-3.5 h-3.5" />} />
          <MiniStatCard label="Total Spent" value={formatGHS(statsData.totalSpent)} icon={<TrendingUp className="w-3.5 h-3.5" />} />
          <MiniStatCard label="Wallet Balance" value={formatGHS(customer.wallet_balance)} icon={<Wallet className="w-3.5 h-3.5" />} />
          <MiniStatCard label="Avg Order Value" value={formatGHS(avgOrderValue)} icon={<ArrowUpDown className="w-3.5 h-3.5" />} />
          <MiniStatCard label="Last Order" value={statsData.lastOrder ? fmtShort(statsData.lastOrder) : '—'} icon={<Clock className="w-3.5 h-3.5" />} />
          <MiniStatCard label="Last Top-up" value={statsData.lastTopup ? fmtShort(statsData.lastTopup) : '—'} icon={<Clock className="w-3.5 h-3.5" />} />
          <MiniStatCard label="Customer Since" value={fmtShort(customer.created_at)} icon={<Calendar className="w-3.5 h-3.5" />} />
        </motion.div>

        {/* Tabs */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}>
          <Tabs defaultValue="overview" className="w-full">
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <TabsList className="w-max sm:w-auto flex gap-0.5">
                <TabsTrigger value="overview" className="gap-1 text-xs sm:text-sm"><User className="w-3.5 h-3.5 hidden sm:block" /> Overview</TabsTrigger>
                <TabsTrigger value="orders" className="gap-1 text-xs sm:text-sm"><ShoppingCart className="w-3.5 h-3.5 hidden sm:block" /> Orders</TabsTrigger>
                <TabsTrigger value="topups" className="gap-1 text-xs sm:text-sm"><CreditCard className="w-3.5 h-3.5 hidden sm:block" /> Top-ups</TabsTrigger>
                <TabsTrigger value="transactions" className="gap-1 text-xs sm:text-sm"><Wallet className="w-3.5 h-3.5 hidden sm:block" /> Transactions</TabsTrigger>
                <TabsTrigger value="activity" className="gap-1 text-xs sm:text-sm"><Clock className="w-3.5 h-3.5 hidden sm:block" /> Activity</TabsTrigger>
                <TabsTrigger value="notes" className="gap-1 text-xs sm:text-sm"><StickyNote className="w-3.5 h-3.5 hidden sm:block" /> Notes</TabsTrigger>
                <TabsTrigger value="security" className="gap-1 text-xs sm:text-sm"><ShieldAlert className="w-3.5 h-3.5 hidden sm:block" /> Security</TabsTrigger>
              </TabsList>
            </div>

            {/* ─── OVERVIEW TAB ─── */}
            <TabsContent value="overview" className="mt-4 space-y-3 sm:space-y-4">
              <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
                <div className="glass-card p-4 sm:p-5 space-y-0.5">
                  <h3 className="text-sm font-display font-bold text-foreground mb-3">Customer Information</h3>
                  <InfoRow icon={<User className="w-4 h-4" />} label="Full Name" value={customer.full_name} />
                  <InfoRow icon={<Hash className="w-4 h-4" />} label="Username" value={customer.username || <span className="text-muted-foreground/50 italic">Not set</span>} />
                  <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={customer.email} />
                  <InfoRow icon={<Phone className="w-4 h-4" />} label="Phone" value={<span className="font-mono">{customer.phone}</span>} />
                  <InfoRow icon={<Hash className="w-4 h-4" />} label="Customer ID" value={<span className="font-mono text-[11px] break-all">{customer.id}</span>} />
                  <InfoRow icon={<Calendar className="w-4 h-4" />} label="Signup Date" value={fmtDate(customer.created_at)} />
                  <InfoRow icon={<UserCheck className="w-4 h-4" />} label="Email Verified" value={
                    customer.email_verified
                      ? <Badge variant="success" className="text-[10px]">Verified</Badge>
                      : <Badge variant="warning" className="text-[10px]">Unverified</Badge>
                  } />
                </div>
                <div className="glass-card p-4 sm:p-5 space-y-0.5">
                  <h3 className="text-sm font-display font-bold text-foreground mb-3">Affiliate &amp; Financial</h3>
                  <InfoRow icon={<Hash className="w-4 h-4" />} label="Affiliate Code" value={<span className="font-mono">{customer.affiliate_code}</span>} />
                  <InfoRow icon={<UserCheck className="w-4 h-4" />} label="Referred By" value={customer.referred_by || <span className="text-muted-foreground/50 italic">None</span>} />
                  <InfoRow icon={<Wallet className="w-4 h-4" />} label="Wallet Balance" value={<span className="font-semibold">{formatGHS(customer.wallet_balance)}</span>} />
                  <InfoRow icon={<TrendingUp className="w-4 h-4" />} label="Total Commission" value={formatGHS(customer.total_commission)} />
                  <InfoRow icon={<TrendingUp className="w-4 h-4" />} label="Available Commission" value={<span className="text-primary font-semibold">{formatGHS(customer.available_commission)}</span>} />
                   <InfoRow icon={<ShoppingCart className="w-4 h-4" />} label="Delivered Orders" value={String(statsData.deliveredOrders)} />
                   <InfoRow icon={<XCircle className="w-4 h-4" />} label="Failed Orders" value={String(statsData.failedOrders)} />
                   {authUser?.adminRole === 'Super Admin' && (
                   <div className="flex flex-wrap gap-1.5 pt-3 border-t border-border/50">
                     <Button size="sm" variant="outline" className="gap-1.5 text-[11px] h-7"
                       onClick={() => { setCommissionAction('credit_commission'); setCommissionAmount(''); setCommissionReason(''); }}>
                       <Plus className="w-3 h-3 text-success" /> Credit Commission
                     </Button>
                     <Button size="sm" variant="outline" className="gap-1.5 text-[11px] h-7"
                       onClick={() => { setCommissionAction('deduct_commission'); setCommissionAmount(''); setCommissionReason(''); }}>
                       <ArrowUpDown className="w-3 h-3 text-warning" /> Deduct Available
                     </Button>
                     <Button size="sm" variant="outline" className="gap-1.5 text-[11px] h-7"
                       onClick={() => { setCommissionAction('reverse_commission'); setCommissionAmount(''); setCommissionReason(''); }}>
                       <AlertTriangle className="w-3 h-3 text-destructive" /> Reverse Earnings
                     </Button>
                   </div>
                   )}
                 </div>
               </div>

              {/* Referral Information */}
              <div className="glass-card p-4 sm:p-5">
                <h3 className="text-sm font-display font-bold text-foreground mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> Referral Information
                </h3>
                {referrerLoading ? (
                  <div className="space-y-2.5">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-5 w-2/3" />
                  </div>
                ) : !customer.referred_by ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Link2 className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-sm font-medium">No referral information available</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">This customer signed up without a referral code</p>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-x-6">
                    <div className="space-y-0.5">
                      <InfoRow icon={<Link2 className="w-4 h-4" />} label="Referral Code Used" value={<span className="font-mono">{customer.referred_by}</span>} />
                      <InfoRow icon={<User className="w-4 h-4" />} label="Referrer Name" value={
                        referrer?.id ? (
                          <button
                            onClick={() => navigate(`/admin/customers/${referrer.id}`)}
                            className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors font-medium cursor-pointer min-h-[32px] min-w-[44px] inline-flex items-center"
                          >
                            {referrer.full_name}
                          </button>
                        ) : (
                          <span className="text-muted-foreground/50 italic">Unknown</span>
                        )
                      } />
                      <InfoRow icon={<Hash className="w-4 h-4" />} label="Referrer Username" value={referrer?.username || <span className="text-muted-foreground/50 italic">Not set</span>} />
                      <InfoRow icon={<Mail className="w-4 h-4" />} label="Referrer Email" value={referrer?.email || <span className="text-muted-foreground/50 italic">Unknown</span>} />
                    </div>
                    <div className="space-y-0.5">
                      <InfoRow icon={<UserCheck className="w-4 h-4" />} label="Referrer Status" value={
                        referrer ? <StatusBadge status={referrer.status} /> : <span className="text-muted-foreground/50 italic">Unknown</span>
                      } />
                      <InfoRow icon={<Calendar className="w-4 h-4" />} label="Referral Date" value={fmtDate(customer.created_at)} />
                      <InfoRow icon={<TrendingUp className="w-4 h-4" />} label="Commission Generated" value={
                        <span className="font-semibold text-primary">{formatGHS(commissionFromCustomer)}</span>
                      } />
                      <InfoRow icon={<Wallet className="w-4 h-4" />} label="Signup Source" value="Referral Link" />
                    </div>
                  </div>
                )}
              </div>

              {/* Referrals Made by This Customer */}
              <CustomerReferralsSection customerId={customer.id} affiliateCode={customer.affiliate_code} />
            </TabsContent>

            {/* ─── ORDERS TAB ─── */}
            <TabsContent value="orders" className="mt-4 space-y-3">
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search order ID or phone..." value={orderSearch} onChange={e => setOrderSearch(e.target.value)} className="pl-10" />
                </div>
                <div className="flex gap-2">
                  <Select value={orderStatusFilter} onValueChange={setOrderStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[150px]">
                      <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending_confirmation">Processing</SelectItem>
                      <SelectItem value="delivered">Delivered</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="rejected">Refunded</SelectItem>
                      <SelectItem value="customer_cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={orderSort} onValueChange={v => setOrderSort(v as 'newest' | 'oldest' | 'highest')}>
                    <SelectTrigger className="w-full sm:w-[140px]">
                      <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="oldest">Oldest</SelectItem>
                      <SelectItem value="highest">Highest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="min-h-[120px]">
              {ordersLoading ? <SectionLoader /> : orders.length === 0 ? (
                <EmptyState icon={ShoppingCart} message="No orders found" />
              ) : isMobile ? (
                <div className="space-y-2">
                  {orders.map(renderOrderCard)}
                </div>
              ) : (
                <div className="glass-card glow-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="p-3 font-medium text-muted-foreground text-xs">Order ID</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Product</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Phone</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Date</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Amount</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map(o => (
                          <tr key={o.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                            <td className="p-3 font-mono text-xs text-primary">{o.short_id}</td>
                            <td className="p-3 text-foreground whitespace-nowrap">{o.bundle_size} {o.network}</td>
                            <td className="p-3 text-muted-foreground font-mono text-xs">{o.recipient_phone}</td>
                            <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(o.created_at)}</td>
                            <td className="p-3 font-semibold text-foreground whitespace-nowrap">{formatGHS(o.total_amount)}</td>
                            <td className="p-3"><StatusBadge status={o.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              </div>
              {!ordersLoading && <Pagination currentPage={ordersPage} totalPages={ordersTotalPages} onPageChange={setOrdersPage} totalItems={ordersTotal} label="orders" />}
            </TabsContent>

            {/* ─── TOP-UPS TAB ─── */}
            <TabsContent value="topups" className="mt-4 space-y-4">
              <div className="min-h-[120px]">
              {topupsLoading ? <SectionLoader /> : topups.length === 0 ? (
                <EmptyState icon={CreditCard} message="No top-ups yet" />
              ) : isMobile ? (
                <div className="space-y-2">
                  {topups.map(renderTopupCard)}
                </div>
              ) : (
                <div className="glass-card glow-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="p-3 font-medium text-muted-foreground text-xs">ID</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Amount</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Method</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Number</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Date</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topups.map(t => (
                          <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                            <td className="p-3 font-mono text-xs text-primary">{t.short_id}</td>
                            <td className="p-3 font-semibold text-foreground whitespace-nowrap">{formatGHS(t.amount)}</td>
                            <td className="p-3 text-foreground">
                              {t.is_manual
                                ? <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px]">Manual Credit</Badge>
                                : <span className="capitalize">{t.method}</span>}
                            </td>
                            <td className="p-3 text-muted-foreground font-mono text-xs">
                              {t.is_manual ? (t.admin_name ? `By ${t.admin_name}` : 'Admin') : t.momo_number}
                            </td>
                            <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(t.created_at)}</td>
                            <td className="p-3"><StatusBadge status={t.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              </div>
              {!topupsLoading && <Pagination currentPage={topupsPage} totalPages={topupsTotalPages} onPageChange={setTopupsPage} totalItems={topupsTotal} label="top-ups" />}

            </TabsContent>

            {/* ─── TRANSACTIONS TAB ─── */}
            <TabsContent value="transactions" className="mt-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-sm font-display font-bold text-foreground">Wallet Transactions</h3>
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5 text-success">
                    <ArrowUpCircle className="w-4 h-4" />
                    <span className="font-semibold">{formatGHS(walletTxCredits)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-destructive">
                    <ArrowDownCircle className="w-4 h-4" />
                    <span className="font-semibold">{formatGHS(walletTxDebits)}</span>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1 sm:max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search description or reference..." value={walletTxSearch} onChange={e => setWalletTxSearch(e.target.value)} className="pl-10 h-9" />
                </div>
                <div className="flex gap-2.5">
                  <Select value={walletTxTypeFilter} onValueChange={setWalletTxTypeFilter}>
                    <SelectTrigger className="w-full sm:w-[130px] h-9"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                      <SelectItem value="debit">Debit</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={walletTxSourceFilter} onValueChange={setWalletTxSourceFilter}>
                    <SelectTrigger className="w-full sm:w-[170px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      {walletTxSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="min-h-[120px]">
              {walletTxsLoading ? <SectionLoader /> : filteredWalletTxs.length === 0 ? (
                <EmptyState icon={Wallet} message="No wallet transactions found" />
              ) : isMobile ? (
                <div className="space-y-2">
                  {filteredWalletTxs.map(renderWalletTxCard)}
                </div>
              ) : (
                <div className="glass-card glow-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="p-3 font-medium text-muted-foreground text-xs">Date</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Type</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs text-right">Before</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs text-right">Amount</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs text-right">After</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Source</th>
                          <th className="p-3 font-medium text-muted-foreground text-xs">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredWalletTxs.map(tx => (
                          <tr key={tx.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                            <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(tx.created_at)}</td>
                            <td className="p-3">
                              <Badge variant="outline" className={`text-[10px] ${tx.type === 'credit' ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                                {tx.type === 'credit' ? '+ Credit' : '− Debit'}
                              </Badge>
                            </td>
                            <td className="p-3 text-right text-xs text-muted-foreground">{tx.balance_before != null ? formatGHS(tx.balance_before) : '—'}</td>
                            <td className={`p-3 text-right font-semibold whitespace-nowrap ${tx.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                              {tx.type === 'credit' ? '+' : '−'}{formatGHS(tx.amount)}
                            </td>
                            <td className="p-3 text-right text-xs font-medium text-foreground">{tx.balance_after != null ? formatGHS(tx.balance_after) : '—'}</td>
                            <td className="p-3"><span className="text-xs text-muted-foreground">{tx.source}</span></td>
                            <td className="p-3">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWalletTxDetail(tx)}>
                                <Eye className="w-4 h-4 text-muted-foreground" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              </div>
              {!walletTxsLoading && <Pagination currentPage={walletTxsPage} totalPages={walletTxsTotalPages} onPageChange={setWalletTxsPage} totalItems={walletTxsTotal} label="transactions" />}
            </TabsContent>

            {/* ─── ACTIVITY TAB ─── */}
            <TabsContent value="activity" className="mt-4">
              <div className="glass-card p-4 sm:p-5">
                <h3 className="text-sm font-display font-bold text-foreground mb-4">Activity Timeline</h3>
                {timeline.length === 0 ? (
                  <EmptyState icon={Clock} message="No activity recorded yet" />
                ) : (
                  <div className="space-y-4 relative before:absolute before:left-[13px] before:top-4 before:bottom-4 before:w-px before:bg-border/40">
                    {timeline.map((item, i) => (
                      <TimelineItem key={i} icon={item.icon} title={item.title} time={item.time} accent={item.accent} />
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ─── NOTES TAB ─── */}
            <TabsContent value="notes" className="mt-4">
              <div className="glass-card p-4 sm:p-5 space-y-4">
                <h3 className="text-sm font-display font-bold text-foreground">Admin Notes</h3>
                <p className="text-xs text-muted-foreground -mt-2">Internal notes visible only to administrators.</p>
                <Textarea
                  placeholder="Add a note about this customer (e.g. VIP customer, payment issue resolved, flagged for review)..."
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  className="min-h-[80px]"
                />
                <Button size="sm" onClick={saveNote} disabled={!newNote.trim() || savingNote} className="gap-1.5">
                  {savingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {savingNote ? 'Saving...' : 'Save Note'}
                </Button>

                {notesLoading ? (
                  <div className="space-y-2 mt-4">
                    {[1, 2].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
                  </div>
                ) : notes.length === 0 ? (
                  <EmptyState icon={StickyNote} message="No notes yet — add the first one above" />
                ) : (
                  <div className="space-y-2 mt-2">
                    {notes.map(n => (
                      <div key={n.id} className="p-3 rounded-lg bg-muted/40 border border-border/30 group">
                        <p className="text-sm text-foreground whitespace-pre-wrap">{n.note}</p>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                            <span>{n.admin_name || 'Admin'}</span>
                            <span>·</span>
                            <span>{fmtDate(n.created_at)}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            onClick={() => deleteNote(n.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ─── SECURITY TAB ─── */}
            <TabsContent value="security" className="mt-4">
              <div className="grid md:grid-cols-2 gap-3 sm:gap-4">
                <div className="glass-card p-4 sm:p-5">
                  <h3 className="text-sm font-display font-bold text-foreground mb-3">Risk Overview</h3>
                  <InfoRow icon={<XCircle className="w-4 h-4" />} label="Failed Orders" value={String(statsData.failedOrders)} />
                  <InfoRow icon={<RefreshCw className="w-4 h-4" />} label="Refunded Orders" value={String(statsData.refundedOrders)} />
                  <InfoRow icon={<ShieldAlert className="w-4 h-4" />} label="Account Status" value={<StatusBadge status={customer.status} />} />
                  <InfoRow icon={<Mail className="w-4 h-4" />} label="Email Verified" value={
                    customer.email_verified
                      ? <span className="flex items-center gap-1 text-success text-xs font-medium"><CheckCircle className="w-3.5 h-3.5" /> Yes</span>
                      : <span className="flex items-center gap-1 text-destructive text-xs font-medium"><XCircle className="w-3.5 h-3.5" /> No</span>
                  } />
                </div>
                <div className="glass-card p-4 sm:p-5">
                  <h3 className="text-sm font-display font-bold text-foreground mb-3">Account Details</h3>
                  <InfoRow icon={<Hash className="w-4 h-4" />} label="Customer ID" value={<span className="font-mono text-[11px] break-all">{customer.id}</span>} />
                  <InfoRow icon={<Calendar className="w-4 h-4" />} label="Created" value={fmtDate(customer.created_at)} />
                  <InfoRow icon={<Wallet className="w-4 h-4" />} label="Current Balance" value={<span className="font-semibold">{formatGHS(customer.wallet_balance)}</span>} />
                  <InfoRow icon={<TrendingUp className="w-4 h-4" />} label="Total Spent" value={formatGHS(statsData.totalSpent)} />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>

      {/* Wallet Credit/Debit Dialog */}
      <Dialog open={!!walletAction} onOpenChange={open => { if (!open) setWalletAction(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{walletAction === 'credit_wallet' ? 'Credit Wallet' : 'Debit Wallet'}</DialogTitle>
            <DialogDescription>
              {walletAction === 'credit_wallet'
                ? `Add funds to ${customer.full_name}'s wallet (Current: ${formatGHS(customer.wallet_balance)})`
                : `Deduct from ${customer.full_name}'s wallet (Current: ${formatGHS(customer.wallet_balance)})`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Amount (GH₵)</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={walletAmount}
                onChange={e => setWalletAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Reason (required)</label>
              <Input
                placeholder="e.g. Refund for failed delivery, bonus credit..."
                value={walletReason}
                onChange={e => setWalletReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletAction(null)} disabled={walletActionLoading}>Cancel</Button>
            <Button
              onClick={handleWalletAction}
              disabled={walletActionLoading || !walletAmount || !walletReason.trim()}
              className="gap-1.5"
              variant={walletAction === 'debit_wallet' ? 'destructive' : 'default'}
            >
              {walletActionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {walletAction === 'credit_wallet' ? 'Credit Wallet' : 'Debit Wallet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commission Action Dialog */}
      <Dialog open={!!commissionAction} onOpenChange={open => { if (!open) setCommissionAction(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{commissionAction ? commissionActionLabels[commissionAction] : ''}</DialogTitle>
            <DialogDescription>
              {commissionAction === 'credit_commission' && `Add to ${customer.full_name}'s total & available commission (Current: ${formatGHS(customer.available_commission)} available of ${formatGHS(customer.total_commission)} total)`}
              {commissionAction === 'deduct_commission' && `Deduct from available commission only. Total earned remains unchanged. (Available: ${formatGHS(customer.available_commission)})`}
              {commissionAction === 'reverse_commission' && `Reverse commission earnings — reduces BOTH total earned and available commission. (Total: ${formatGHS(customer.total_commission)}, Available: ${formatGHS(customer.available_commission)})`}
            </DialogDescription>
          </DialogHeader>
          {commissionAction === 'reverse_commission' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">
                <strong>Warning:</strong> This permanently reduces the customer's total earned commission record. Only use for genuine commission reversals (e.g. fraudulent referrals). This action cannot be easily undone.
              </p>
            </div>
          )}
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Amount (GH₵)</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={commissionAmount}
                onChange={e => setCommissionAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Reason (required)</label>
              <Input
                placeholder={commissionAction === 'reverse_commission' ? 'e.g. Fraudulent referral reversal...' : 'e.g. Manual commission adjustment...'}
                value={commissionReason}
                onChange={e => setCommissionReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommissionAction(null)} disabled={commissionActionLoading}>Cancel</Button>
            <Button
              onClick={handleCommissionAction}
              disabled={commissionActionLoading || !commissionAmount || !commissionReason.trim()}
              className="gap-1.5"
              variant={commissionAction === 'reverse_commission' ? 'destructive' : commissionAction === 'deduct_commission' ? 'destructive' : 'default'}
            >
              {commissionActionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {commissionAction ? commissionActionLabels[commissionAction] : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet Transaction Detail Dialog */}
      <DetailViewDialog
        open={!!walletTxDetail}
        onOpenChange={open => { if (!open) setWalletTxDetail(null); }}
        title="Transaction Details"
        subtitle="Complete information about this transaction"
        fields={walletTxDetail ? getWalletTxDetailFields(walletTxDetail) : []}
      />
    </AdminLayout>
  );
}
