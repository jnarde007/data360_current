import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatGHS } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';
import { Pagination } from '@/components/Pagination';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';
import { Users, TrendingUp, UserCheck, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };
const PAGE_SIZE = 10;

interface Referral {
  id: string;
  masked_name: string;
  username: string;
  signup_date: string;
  status: string;
  commission_earned: number;
}

export function CustomerReferralList() {
  const isMobile = useIsMobile();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const loadReferrals = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_referrals');
      if (error) throw error;
      setReferrals((data || []) as Referral[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReferrals(); }, [loadReferrals]);

  const filtered = search
    ? referrals.filter(r => {
        const q = search.toLowerCase();
        return r.masked_name.toLowerCase().includes(q) || r.username.toLowerCase().includes(q);
      })
    : referrals;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeCount = referrals.filter(r => r.status === 'active').length;
  const totalCommission = referrals.reduce((s, r) => s + Number(r.commission_earned), 0);
  const pendingCommission = referrals.filter(r => r.status === 'active' && r.commission_earned === 0).length;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm lg:text-base font-display font-bold text-foreground">Your Referrals</h2>
        <div className="flex-1 h-px bg-border/60" />
      </div>

      {/* Summary stats */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-4">
        {[
          { label: 'Total Referrals', value: String(referrals.length), icon: <Users className="w-4 h-4" />, iconClass: 'icon-box-primary', accent: 'border-t-primary/40', valueColor: 'text-primary' },
          { label: 'Active', value: String(activeCount), icon: <UserCheck className="w-4 h-4" />, iconClass: 'icon-box-success', accent: 'border-t-success/40', valueColor: 'text-success' },
          { label: 'Commission Earned', value: formatGHS(totalCommission), icon: <TrendingUp className="w-4 h-4" />, iconClass: 'icon-box-amber', accent: 'border-t-amber/40', valueColor: 'text-amber' },
          { label: 'Pending Earners', value: String(pendingCommission), icon: <Users className="w-4 h-4" />, iconClass: 'icon-box-purple', accent: 'border-t-purple/40', valueColor: 'text-purple' },
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

      {/* Referral list */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} transition={{ duration: 0.4, delay: 0.15 }}>
        <div className="glass-card overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="px-4 pt-4 pb-3 border-b border-border/50">
            <div className="flex items-center gap-3">
              <h3 className="font-display font-semibold text-foreground text-sm flex items-center gap-2 mr-auto">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                Referred Users
                <span className="text-xs font-normal text-muted-foreground">({filtered.length})</span>
              </h3>
              <div className="relative min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-8 h-8 text-xs" />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm font-medium">{referrals.length === 0 ? 'No referrals yet' : 'No matching referrals'}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {referrals.length === 0 ? 'Share your referral link to start earning commissions' : 'Try a different search term'}
              </p>
            </div>
          ) : isMobile ? (
            <div className="space-y-0 divide-y divide-border/40">
              {paginated.map(r => (
                <div key={r.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-foreground">{r.masked_name}</span>
                    <StatusBadge status={r.status as any} />
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {r.username && <span>@{r.username}</span>}
                    <span>{format(new Date(r.signup_date), 'MMM d, yyyy')}</span>
                    <span className="ml-auto font-semibold text-foreground tabular-nums">{formatGHS(Number(r.commission_earned))}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="p-3 font-medium text-muted-foreground text-xs">Name</th>
                    <th className="p-3 font-medium text-muted-foreground text-xs">Username</th>
                    <th className="p-3 font-medium text-muted-foreground text-xs">Signup Date</th>
                    <th className="p-3 font-medium text-muted-foreground text-xs">Status</th>
                    <th className="p-3 font-medium text-muted-foreground text-xs text-right">Commission Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(r => (
                    <tr key={r.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-foreground font-medium">{r.masked_name}</td>
                      <td className="p-3 text-muted-foreground text-xs">{r.username ? `@${r.username}` : '—'}</td>
                      <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{format(new Date(r.signup_date), 'MMM d, yyyy')}</td>
                      <td className="p-3"><StatusBadge status={r.status as any} /></td>
                      <td className="p-3 text-right font-semibold text-foreground tabular-nums">{formatGHS(Number(r.commission_earned))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={filtered.length} label="referrals" />
        </div>
      </motion.div>
    </section>
  );
}
