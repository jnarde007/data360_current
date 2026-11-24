import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatGHS } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';
import { Pagination } from '@/components/Pagination';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileCard } from '@/components/MobileCard';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { Users, Link2 } from 'lucide-react';

interface AdminReferral {
  id: string;
  full_name: string;
  username: string;
  email: string;
  signup_date: string;
  status: string;
  commission_earned: number;
}

interface Props {
  customerId: string;
  affiliateCode: string;
}

const PAGE_SIZE = 10;

export function CustomerReferralsSection({ customerId, affiliateCode }: Props) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [referrals, setReferrals] = useState<AdminReferral[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadReferrals = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('admin_get_customer_referrals', { p_customer_id: customerId });
      if (error) throw error;
      setReferrals((data || []) as AdminReferral[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { loadReferrals(); }, [loadReferrals]);

  const activeCount = referrals.filter(r => r.status === 'active').length;
  const totalCommission = referrals.reduce((s, r) => s + Number(r.commission_earned), 0);
  const totalPages = Math.max(1, Math.ceil(referrals.length / PAGE_SIZE));
  const paginated = referrals.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="glass-card p-4 sm:p-5">
      <h3 className="text-sm font-display font-bold text-foreground mb-3 flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" /> Customers Referred by This User
      </h3>

      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : referrals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Link2 className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-sm font-medium">No referrals made</p>
          <p className="text-xs text-muted-foreground/60 mt-1">This customer hasn't referred anyone yet</p>
        </div>
      ) : (
        <>
          {/* Mini stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-lg bg-muted/40 border border-border/30 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Total</p>
              <p className="text-lg font-bold text-foreground tabular-nums">{referrals.length}</p>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border/30 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Active</p>
              <p className="text-lg font-bold text-success tabular-nums">{activeCount}</p>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border/30 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Commission</p>
              <p className="text-lg font-bold text-primary tabular-nums">{formatGHS(totalCommission)}</p>
            </div>
          </div>

          {/* List */}
          {isMobile ? (
            <div className="space-y-2">
              {paginated.map(r => (
                <MobileCard key={r.id} fields={[
                  { label: 'Name', value: (
                    <button onClick={() => navigate(`/admin/customers/${r.id}`)}
                      className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30 font-medium text-xs">
                      {r.full_name}
                    </button>
                  )},
                  { label: 'Status', value: <StatusBadge status={r.status as any} /> },
                  { label: 'Signup', value: <span className="text-xs text-muted-foreground">{format(new Date(r.signup_date), 'MMM d, yyyy')}</span> },
                  { label: 'Commission', value: <span className="font-semibold text-xs">{formatGHS(Number(r.commission_earned))}</span> },
                ]} />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/30">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left bg-muted/20">
                    <th className="p-2.5 font-medium text-muted-foreground text-xs">Name</th>
                    <th className="p-2.5 font-medium text-muted-foreground text-xs">Username</th>
                    <th className="p-2.5 font-medium text-muted-foreground text-xs">Email</th>
                    <th className="p-2.5 font-medium text-muted-foreground text-xs">Signup</th>
                    <th className="p-2.5 font-medium text-muted-foreground text-xs">Status</th>
                    <th className="p-2.5 font-medium text-muted-foreground text-xs text-right">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(r => (
                    <tr key={r.id} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                      <td className="p-2.5">
                        <button onClick={() => navigate(`/admin/customers/${r.id}`)}
                          className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors font-medium cursor-pointer">
                          {r.full_name}
                        </button>
                      </td>
                      <td className="p-2.5 text-muted-foreground text-xs">{r.username ? `@${r.username}` : '—'}</td>
                      <td className="p-2.5 text-muted-foreground text-xs">{r.email}</td>
                      <td className="p-2.5 text-muted-foreground text-xs whitespace-nowrap">{format(new Date(r.signup_date), 'MMM d, yyyy')}</td>
                      <td className="p-2.5"><StatusBadge status={r.status as any} /></td>
                      <td className="p-2.5 text-right font-semibold text-foreground tabular-nums">{formatGHS(Number(r.commission_earned))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={referrals.length} label="referrals" />
        </>
      )}
    </div>
  );
}
