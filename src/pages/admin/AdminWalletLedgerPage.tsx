import { useState, useEffect, useCallback, useRef } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { formatGHS } from '@/lib/mock-data';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2, ArrowUpCircle, ArrowDownCircle, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { DateFilter, filterByDate, type DatePreset } from '@/components/DateFilter';
import { Pagination } from '@/components/Pagination';
import { MobileCard } from '@/components/MobileCard';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSearchParams } from 'react-router-dom';
import { DetailViewDialog, type DetailField } from '@/components/DetailViewDialog';

interface WalletTx {
  id: string; customer_id: string; customer_name: string; customer_email: string;
  customer_phone: string; type: string; amount: number; description: string;
  reference: string; admin_id: string | null; admin_name: string | null;
  created_at: string; source: string;
  balance_before: number | null; balance_after: number | null;
}

function classifySource(tx: { type: string; description: string; admin_id: string | null; reference: string }): string {
  if (tx.admin_id) return tx.type === 'credit' ? 'Manual Credit' : 'Manual Debit';
  const desc = tx.description.toLowerCase();
  if (desc.includes('data purchase') || desc.includes('order')) return 'Order Purchase';
  if (desc.includes('top-up') || desc.includes('topup')) return 'Topup Approval';
  if (desc.includes('paystack')) return 'Paystack Topup';
  if (desc.includes('refund')) return 'Refund';
  if (desc.includes('commission') || desc.includes('affiliate')) return 'Affiliate Commission';
  return tx.type === 'credit' ? 'Credit' : 'Debit';
}

const ROWS_PER_PAGE = 20;

export default function AdminWalletLedgerPage() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customDate, setCustomDate] = useState<Date>();
  const [currentPage, setCurrentPage] = useState(1);
  const [detailTx, setDetailTx] = useState<WalletTx | null>(null);
  const deepLinkedRef = useRef(false);

  const loadTransactions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('id, customer_id, type, amount, description, reference, admin_id, created_at, balance_before, balance_after, customers(full_name, email, phone), admin_users!wallet_transactions_admin_id_fkey(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTransactions((data || []).map((t: any) => ({
        id: t.id, customer_id: t.customer_id, customer_name: t.customers?.full_name || 'Unknown',
        customer_email: t.customers?.email || '', customer_phone: t.customers?.phone || '',
        type: t.type, amount: Number(t.amount), description: t.description, reference: t.reference,
        admin_id: t.admin_id, admin_name: t.admin_users?.name || null, created_at: t.created_at,
        balance_before: t.balance_before != null ? Number(t.balance_before) : null,
        balance_after: t.balance_after != null ? Number(t.balance_after) : null,
        source: classifySource({ type: t.type, description: t.description, admin_id: t.admin_id, reference: t.reference }),
      })));
    } catch {
      toast({ title: 'Unable to load transactions', description: 'Please refresh the page and try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);
  useEffect(() => { setCurrentPage(1); }, [search, typeFilter, sourceFilter, datePreset, customDate]);

  useRealtimeRefresh(['wallet_transactions'], loadTransactions, 'admin-ledger-live');

  // Deep-link: auto-open transaction detail from ?txn= param
  useEffect(() => {
    if (deepLinkedRef.current || loading || transactions.length === 0) return;
    const txnParam = searchParams.get('txn');
    if (!txnParam) return;
    const match = transactions.find(t => t.id === txnParam || t.reference === txnParam);
    if (match) {
      deepLinkedRef.current = true;
      setDetailTx(match);
      setSearchParams({}, { replace: true });
    }
  }, [transactions, loading, searchParams]);

  const allSources = [...new Set(transactions.map(t => t.source))].sort();

  const filtered = filterByDate(
    transactions.filter(t => {
      const q = search.toLowerCase();
      const matchesSearch = !q || t.customer_name.toLowerCase().includes(q) || t.customer_email.toLowerCase().includes(q) || t.customer_phone.includes(q) || t.reference.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
      const matchesType = typeFilter === 'all' || t.type === typeFilter;
      const matchesSource = sourceFilter === 'all' || t.source === sourceFilter;
      return matchesSearch && matchesType && matchesSource;
    }),
    t => t.created_at, datePreset, customDate
  );

  const totalCredits = filtered.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const totalDebits = filtered.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  const getDetailFields = (t: WalletTx): DetailField[] => [
    { label: 'Customer', value: t.customer_name },
    { label: 'Email', value: t.customer_email || '—' },
    { label: 'Phone', value: t.customer_phone || '—' },
    { label: 'Type', value: <Badge variant="outline" className={`text-xs ${t.type === 'credit' ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>{t.type === 'credit' ? '+ Credit' : '− Debit'}</Badge> },
    ...(t.balance_before != null ? [{ label: 'Balance Before', value: formatGHS(t.balance_before) }] : []),
    { label: 'Amount', value: <span className={`font-semibold ${t.type === 'credit' ? 'text-success' : 'text-destructive'}`}>{t.type === 'credit' ? '+' : '−'}{formatGHS(t.amount)}</span> },
    ...(t.balance_after != null ? [{ label: 'Balance After', value: <span className="font-semibold">{formatGHS(t.balance_after)}</span> }] : []),
    { label: 'Source', value: t.source },
    { label: 'Description', value: t.description.replace(/\s*\(webhook\)/gi, '') },
    { label: 'Reference', value: <span className="font-mono text-xs">{t.reference}</span> },
    { label: 'Processed By', value: t.admin_name || 'System' },
    { label: 'Date', value: new Date(t.created_at).toLocaleString() },
  ];

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
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">Wallet Ledger</h1>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5 text-success">
              <ArrowUpCircle className="w-4 h-4" />
              <span className="font-semibold">{formatGHS(totalCredits)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-destructive">
              <ArrowDownCircle className="w-4 h-4" />
              <span className="font-semibold">{formatGHS(totalDebits)}</span>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-3">
          <DateFilter datePreset={datePreset} customDate={customDate} onPresetChange={setDatePreset} onCustomDateChange={setCustomDate} />
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search name, email, phone, ref..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
            </div>
            <div className="flex gap-3">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="debit">Debit</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {allSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Content */}
        {isMobile ? (
          <div className="space-y-3">
            {paginated.length === 0 && <p className="text-center text-muted-foreground py-8">No wallet transactions found</p>}
            {paginated.map(t => (
              <MobileCard key={t.id} fields={[
                { label: 'Customer', value: <span className="font-medium">{t.customer_name}</span> },
                {
                  label: 'Amount',
                  value: <span className={`font-semibold ${t.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                    {t.type === 'credit' ? '+' : '−'}{formatGHS(t.amount)}
                  </span>,
                },
                {
                  label: 'Type',
                  value: <Badge variant="outline" className={`text-[10px] ${t.type === 'credit' ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                    {t.type === 'credit' ? '+ Credit' : '− Debit'}
                  </Badge>,
                },
                { label: 'Source', value: <span className="text-xs">{t.source}</span> },
                { label: 'Date', value: <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</span> },
              ]} action={
                <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setDetailTx(t)}>
                  <Eye className="w-3.5 h-3.5" /> View Details
                </Button>
              } />
            ))}
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="transactions" />
          </div>
        ) : (
          <div className="glass-card glow-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="p-4 font-medium text-muted-foreground">Date</th>
                  <th className="p-4 font-medium text-muted-foreground">Customer</th>
                  <th className="p-4 font-medium text-muted-foreground">Type</th>
                  <th className="p-4 font-medium text-muted-foreground text-right">Before</th>
                  <th className="p-4 font-medium text-muted-foreground text-right">Amount</th>
                  <th className="p-4 font-medium text-muted-foreground text-right">After</th>
                  <th className="p-4 font-medium text-muted-foreground">Source</th>
                  <th className="p-4 font-medium text-muted-foreground">Details</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(t => (
                  <tr key={t.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                    <td className="p-4 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(t.created_at).toLocaleDateString()}{' '}
                      <span className="text-muted-foreground/60">{new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </td>
                    <td className="p-4">
                      <p className="font-medium text-foreground text-sm">{t.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{t.customer_phone || t.customer_email}</p>
                    </td>
                    <td className="p-4">
                      <Badge variant="outline" className={`text-xs ${t.type === 'credit' ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                        {t.type === 'credit' ? '+ Credit' : '− Debit'}
                      </Badge>
                    </td>
                    <td className="p-4 text-right text-xs text-muted-foreground">
                      {t.balance_before != null ? formatGHS(t.balance_before) : '—'}
                    </td>
                    <td className={`p-4 text-right font-semibold ${t.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                      {t.type === 'credit' ? '+' : '−'}{formatGHS(t.amount)}
                    </td>
                    <td className="p-4 text-right text-xs font-medium text-foreground">
                      {t.balance_after != null ? formatGHS(t.balance_after) : '—'}
                    </td>
                    <td className="p-4"><span className="text-xs text-muted-foreground">{t.source}</span></td>
                    <td className="p-4">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailTx(t)}>
                        <Eye className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">No wallet transactions found</p>}
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="transactions" />
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <DetailViewDialog
        open={!!detailTx}
        onOpenChange={open => { if (!open) setDetailTx(null); }}
        title="Transaction Details"
        subtitle="Complete information about this transaction"
        fields={detailTx ? getDetailFields(detailTx) : []}
      />
    </AdminLayout>
  );
}
