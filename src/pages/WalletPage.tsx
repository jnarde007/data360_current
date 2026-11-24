import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { formatGHS } from '@/lib/mock-data';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ArrowUpRight, ArrowDownLeft, Wallet, Search, Loader2, LifeBuoy } from 'lucide-react';
import { DetailViewDialog } from '@/components/DetailViewDialog';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DateFilter, filterByDate, type DatePreset } from '@/components/DateFilter';
import { Pagination } from '@/components/Pagination';
import { MobileCard } from '@/components/MobileCard';
import { useIsMobile } from '@/hooks/use-mobile';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

const cleanWalletDescription = (description: string) => {
  return description
    .replace(/\s*\((?:webhook|paystack\s*hook|paystackhook)\)\s*/gi, ' ')
    .replace(/\bpaystack\s*hook\b/gi, 'Paystack')
    .replace(/\bpaystackhook\b/gi, 'Paystack')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

interface WalletTxn {
  id: string; type: string; amount: number; description: string;
  reference: string; created_at: string; admin_name?: string;
  balance_before?: number | null; balance_after?: number | null;
}

export default function WalletPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [txns, setTxns] = useState<WalletTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customDate, setCustomDate] = useState<Date>();
  const [detailTxn, setDetailTxn] = useState<WalletTxn | null>(null);
  const [reportIssueTxn, setReportIssueTxn] = useState<WalletTxn | null>(null);
  const deepLinkedRef = useRef(false);

  const loadTransactions = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*, admin_users!wallet_transactions_admin_id_fkey(name)')
        .eq('customer_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) {
        const { data: fallbackData } = await supabase.from('wallet_transactions').select('*').eq('customer_id', user!.id).order('created_at', { ascending: false });
        setTxns((fallbackData || []) as WalletTxn[]);
        return;
      }
      setTxns((data || []).map((t: any) => ({ ...t, admin_name: t.admin_users?.name || undefined })));
    } catch { /* silent */ } finally { setLoading(false); }
  }, [user?.id]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);
  useRealtimeRefresh(['wallet_transactions', 'customers'], loadTransactions, 'customer-wallet-live');

  // Deep-link: auto-open transaction detail from ?txn= param
  useEffect(() => {
    if (deepLinkedRef.current || loading || txns.length === 0) return;
    const txnParam = searchParams.get('txn');
    if (!txnParam) return;
    const match = txns.find(t => t.id === txnParam || t.reference === txnParam);
    if (match) {
      deepLinkedRef.current = true;
      setDetailTxn(match);
      setSearchParams({}, { replace: true });
    }
  }, [txns, loading, searchParams]);

  const filtered = useMemo(() => {
    return filterByDate(
      txns.filter(t => {
        const matchType = typeFilter === 'all' || t.type === typeFilter;
        const q = search.toLowerCase();
        const sanitizedDescription = cleanWalletDescription(t.description).toLowerCase();
        const matchSearch = !q || t.reference.toLowerCase().includes(q) || sanitizedDescription.includes(q);
        return matchType && matchSearch;
      }),
      t => t.created_at, datePreset, customDate
    );
  }, [txns, typeFilter, search, datePreset, customDate]);

  const totalCredit = filtered.filter(t => t.type === 'credit').reduce((s, t) => s + Number(t.amount), 0);
  const totalDebit = filtered.filter(t => t.type === 'debit').reduce((s, t) => s + Number(t.amount), 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleReset = () => {
    setSearch(''); setTypeFilter('all'); setRowsPerPage(10); setCurrentPage(1); setDatePreset('all'); setCustomDate(undefined);
  };

  if (loading) {
    return <CustomerLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></CustomerLayout>;
  }

  return (
    <CustomerLayout>
      <div className="space-y-6 sm:space-y-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4 }}>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">Wallet</h1>
          <p className="text-sm text-muted-foreground mt-1">Your balance and transaction history</p>
        </motion.div>

        {/* Balance & Stats */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Account Summary</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.05 }}
            className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="col-span-2 sm:col-span-1 glass-card p-3.5 sm:p-5 text-center card-hover card-shine border-l-[3px] border-l-success/50">
              <div className="icon-box icon-box-md sm:icon-box-lg icon-box-success mx-auto mb-2.5">
                <Wallet className="w-4 sm:w-5 h-4 sm:h-5" />
              </div>
              <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Balance</p>
              <p className="text-lg sm:text-2xl font-display font-bold text-foreground mt-1">{formatGHS(user?.wallet_balance || 0)}</p>
              <Button size="sm" className="mt-3 gradient-primary text-primary-foreground border-0 text-xs" style={{ borderRadius: 'calc(var(--card-radius) - 4px)' }} onClick={() => navigate('/topup')}>Top Up</Button>
            </div>
            <div className="glass-card p-3.5 sm:p-5 text-center card-hover card-shine border-l-[3px] border-l-teal/50">
              <div className="icon-box icon-box-md sm:icon-box-lg icon-box-teal mx-auto mb-2.5">
                <ArrowDownLeft className="w-4 sm:w-5 h-4 sm:h-5" />
              </div>
              <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Credits</p>
              <p className="text-base sm:text-xl font-display font-bold text-teal mt-1">{formatGHS(totalCredit)}</p>
            </div>
            <div className="glass-card p-3.5 sm:p-5 text-center card-hover card-shine border-l-[3px] border-l-destructive/50">
              <div className="icon-box icon-box-md sm:icon-box-lg icon-box-destructive mx-auto mb-2.5">
                <ArrowUpRight className="w-4 sm:w-5 h-4 sm:h-5" />
              </div>
              <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Debits</p>
              <p className="text-base sm:text-xl font-display font-bold text-destructive mt-1">{formatGHS(totalDebit)}</p>
            </div>
          </motion.div>
        </section>

        {/* Filters */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Transactions</h2>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}
            className="glass-card p-3 sm:p-4 space-y-3 card-shine">
          <DateFilter datePreset={datePreset} customDate={customDate} onPresetChange={p => { setDatePreset(p); setCurrentPage(1); }} onCustomDateChange={d => { setCustomDate(d); setCurrentPage(1); }} />
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search ref or description..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="pl-10" />
            </div>
            <div className="flex gap-3">
              <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-full sm:w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="debit">Debit</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(rowsPerPage)} onValueChange={v => { setRowsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={handleReset} className="shrink-0">Reset</Button>
            </div>
          </div>
          </motion.div>

        {/* Transactions */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.15 }}>
          <div className="px-1 pb-2">
            <p className="text-sm text-primary font-medium">Showing {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</p>
          </div>

          {isMobile ? (
            <div className="space-y-2">
              {paginated.length === 0 && <p className="text-center text-muted-foreground py-12">No transactions found</p>}
              {paginated.map(t => (
                <div key={t.id} className="glass-card glow-border p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setDetailTxn(t)}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Type</span>
                      <Badge variant={t.type === 'credit' ? 'default' : 'destructive'} className="text-[10px]">
                        {t.type === 'credit' ? <ArrowDownLeft className="w-3 h-3 mr-1" /> : <ArrowUpRight className="w-3 h-3 mr-1" />}
                        {t.type}
                      </Badge>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs shrink-0 text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); setReportIssueTxn(t); }}>
                      <LifeBuoy className="w-3.5 h-3.5" />
                      Report
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</p>
                      <p className={`font-semibold ${t.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                        {t.type === 'credit' ? '+' : '-'}{formatGHS(Number(t.amount))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</p>
                      <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                    {(t.balance_before != null || t.balance_after != null) && (
                      <div className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{t.balance_before != null ? formatGHS(t.balance_before) : '—'}</span>
                        <span>→</span>
                        <span className="font-medium text-foreground">{t.balance_after != null ? formatGHS(t.balance_after) : '—'}</span>
                      </div>
                    )}
                    <div className="col-span-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</p>
                      <p className="text-xs text-muted-foreground truncate">{cleanWalletDescription(t.description)}</p>
                    </div>
                  </div>
                </div>
              ))}
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="transactions" />
            </div>
          ) : (
            <div className="glass-card glow-border overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-muted-foreground font-medium">Date</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Type</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-right">Before</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-right">Amount</TableHead>
                      <TableHead className="text-muted-foreground font-medium text-right">After</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Description</TableHead>
                      <TableHead className="text-muted-foreground font-medium">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">No transactions found</TableCell></TableRow>
                    ) : (
                      paginated.map(t => (
                        <TableRow key={t.id} className="hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => setDetailTxn(t)}>
                          <TableCell className="text-foreground whitespace-nowrap">
                            {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {' '}<span className="text-muted-foreground text-xs">{new Date(t.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={t.type === 'credit' ? 'default' : 'destructive'} className="text-xs">
                              {t.type === 'credit' ? <ArrowDownLeft className="w-3 h-3 mr-1" /> : <ArrowUpRight className="w-3 h-3 mr-1" />}
                              {t.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {t.balance_before != null ? formatGHS(t.balance_before) : '—'}
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${t.type === 'credit' ? 'text-success' : 'text-destructive'}`}>
                            {t.type === 'credit' ? '+' : '-'}{formatGHS(Number(t.amount))}
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium text-foreground">
                            {t.balance_after != null ? formatGHS(t.balance_after) : '—'}
                          </TableCell>
                          <TableCell className="text-foreground text-sm">
                            {cleanWalletDescription(t.description)}
                          </TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setReportIssueTxn(t)}>
                              <LifeBuoy className="w-3.5 h-3.5" />
                              Report
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} label="transactions" />
            </div>
          )}
        </motion.div>
        </section>

        {/* Detail Dialog */}
        <DetailViewDialog
          open={!!detailTxn}
          onOpenChange={() => setDetailTxn(null)}
          title="Transaction Details"
          fields={detailTxn ? [
            { label: 'Date', value: new Date(detailTxn.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + new Date(detailTxn.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
            { label: 'Type', value: <Badge variant={detailTxn.type === 'credit' ? 'default' : 'destructive'} className="text-xs">{detailTxn.type}</Badge> },
            ...(detailTxn.balance_before != null ? [{ label: 'Balance Before', value: formatGHS(detailTxn.balance_before) }] : []),
            { label: 'Amount', value: <span className={`font-semibold ${detailTxn.type === 'credit' ? 'text-success' : 'text-destructive'}`}>{detailTxn.type === 'credit' ? '+' : '-'}{formatGHS(Number(detailTxn.amount))}</span> },
            ...(detailTxn.balance_after != null ? [{ label: 'Balance After', value: <span className="font-semibold text-foreground">{formatGHS(detailTxn.balance_after)}</span> }] : []),
            { label: 'Description', value: cleanWalletDescription(detailTxn.description) },
            { label: 'Reference', value: <span className="font-mono text-xs">{detailTxn.reference}</span> },
          ] : []}
          onReportIssue={() => {
            const t = detailTxn;
            if (t) {
              setDetailTxn(null);
              setReportIssueTxn(t);
            }
          }}
        />
        {reportIssueTxn && (
          <CreateTicketDialog
            open={!!reportIssueTxn}
            onOpenChange={(v) => { if (!v) setReportIssueTxn(null); }}
            defaultCategory={
              reportIssueTxn.description.toLowerCase().includes('refund') ? 'Refund issue'
              : reportIssueTxn.description.toLowerCase().includes('top-up') || reportIssueTxn.reference.startsWith('TOP-') ? 'Wallet top-up issue'
              : 'Payment issue'
            }
            relatedWalletTransactionId={reportIssueTxn.id}
          />
        )}
      </div>
    </CustomerLayout>
  );
}
