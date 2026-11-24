import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { formatGHS } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileCard } from '@/components/MobileCard';
import { Pagination } from '@/components/Pagination';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Trophy, Users, TrendingUp, DollarSign, ArrowUpDown } from 'lucide-react';
import { format } from 'date-fns';

interface LeaderboardEntry {
  id: string;
  full_name: string;
  username: string;
  email: string;
  affiliate_code: string;
  status: string;
  signup_date: string;
  total_referrals: number;
  active_referrals: number;
  total_commission: number;
  referral_revenue: number;
}

type SortKey = 'total_referrals' | 'total_commission' | 'referral_revenue';

const PAGE_SIZE = 15;

export default function AdminReferralLeaderboardPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_referrals');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.rpc('admin_get_referral_leaderboard');
      if (error) throw error;
      setData((rows || []).map((r: any) => ({
        ...r,
        total_referrals: Number(r.total_referrals),
        active_referrals: Number(r.active_referrals),
        total_commission: Number(r.total_commission),
        referral_revenue: Number(r.referral_revenue),
      })));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
    setPage(1);
  };

  const filtered = useMemo(() => {
    let list = data;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.full_name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        r.affiliate_code.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortAsc ? diff : -diff;
    });
    return list;
  }, [data, search, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalReferrals = data.reduce((s, r) => s + r.total_referrals, 0);
  const totalCommission = data.reduce((s, r) => s + r.total_commission, 0);
  const totalRevenue = data.reduce((s, r) => s + r.referral_revenue, 0);

  const SortButton = ({ label, field }: { label: string; field: SortKey }) => (
    <button onClick={() => toggleSort(field)}
      className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider hover:text-foreground transition-colors ${sortKey === field ? 'text-primary' : 'text-muted-foreground'}`}>
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  if (loading) {
    return <AdminLayout><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" /> Referral Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Top-performing referrers across the platform</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Referrers', value: String(data.length), icon: <Users className="w-4 h-4 text-primary" />, sub: `${totalReferrals} total referrals` },
            { label: 'Commission Earned', value: formatGHS(totalCommission), icon: <TrendingUp className="w-4 h-4 text-primary" />, sub: 'all referrers' },
            { label: 'Referral Revenue', value: formatGHS(totalRevenue), icon: <DollarSign className="w-4 h-4 text-primary" />, sub: 'delivered order value' },
            { label: 'Avg Referrals', value: data.length ? (totalReferrals / data.length).toFixed(1) : '0', icon: <Users className="w-4 h-4 text-primary" />, sub: 'per referrer' },
          ].map(s => (
            <div key={s.label} className="glass-card glow-border p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">{s.icon}</div>
                <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              </div>
              <p className="text-xl sm:text-2xl font-display font-bold text-foreground tabular-nums">{s.value}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Search name, username, or code..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>

        {/* Table */}
        <div className="glass-card glow-border overflow-hidden">
          {isMobile ? (
            <div className="space-y-0 divide-y divide-border/40">
              {paginated.length === 0 && <p className="text-center text-muted-foreground py-12 text-sm">No referrers found</p>}
              {paginated.map((r, idx) => (
                <MobileCard key={r.id} fields={[
                  { label: 'Rank', value: <span className="font-bold text-primary">#{(page - 1) * PAGE_SIZE + idx + 1}</span> },
                  { label: 'Name', value: (
                    <button onClick={() => navigate(`/admin/customers/${r.id}`)}
                      className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30 font-medium text-xs">
                      {r.full_name}
                    </button>
                  )},
                  { label: 'Referrals', value: <span className="font-semibold">{r.total_referrals} ({r.active_referrals} active)</span> },
                  { label: 'Commission', value: <span className="font-semibold">{formatGHS(r.total_commission)}</span> },
                  { label: 'Revenue', value: <span className="font-semibold">{formatGHS(r.referral_revenue)}</span> },
                  { label: 'Status', value: <StatusBadge status={r.status as any} /> },
                ]} />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left bg-muted/30">
                    <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-12">#</th>
                    <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Customer</th>
                    <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Code</th>
                    <th className="p-3"><SortButton label="Referrals" field="total_referrals" /></th>
                    <th className="p-3"><SortButton label="Commission" field="total_commission" /></th>
                    <th className="p-3"><SortButton label="Revenue" field="referral_revenue" /></th>
                    <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-muted-foreground py-12">No referrers found</td></tr>
                  )}
                  {paginated.map((r, idx) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                      <td className="p-3 text-muted-foreground font-bold tabular-nums">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="p-3">
                        <button onClick={() => navigate(`/admin/customers/${r.id}`)}
                          className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors font-medium cursor-pointer">
                          {r.full_name}
                        </button>
                        <p className="text-xs text-muted-foreground">{r.username ? `@${r.username}` : r.email}</p>
                      </td>
                      <td className="p-3"><code className="text-xs bg-muted px-2 py-1 rounded font-mono">{r.affiliate_code}</code></td>
                      <td className="p-3 font-semibold tabular-nums">{r.total_referrals} <span className="text-xs font-normal text-muted-foreground">({r.active_referrals} active)</span></td>
                      <td className="p-3 font-semibold tabular-nums">{formatGHS(r.total_commission)}</td>
                      <td className="p-3 font-semibold tabular-nums">{formatGHS(r.referral_revenue)}</td>
                      <td className="p-3"><StatusBadge status={r.status as any} /></td>
                      <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{format(new Date(r.signup_date), 'MMM d, yyyy')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={filtered.length} label="referrers" />
        </div>
      </div>
    </AdminLayout>
  );
}
