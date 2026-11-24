import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, Wallet, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BalanceRow {
  provider: string;
  balance: number | null;
  currency: string | null;
  status: string;
  error_message: string | null;
  last_success_balance: number | null;
  last_success_at: string | null;
  last_checked_at: string;
  supported: boolean;
}

interface HistoryRow {
  id: string;
  provider: string;
  balance: number | null;
  currency: string | null;
  status: string;
  error_message: string | null;
  retrieved_at: string;
}

const fmt = (n: number | null | undefined, ccy?: string | null) =>
  n == null ? "—" : `${ccy || "GHS"} ${Number(n).toFixed(2)}`;

function StatusPill({ status }: { status: string }) {
  if (status === "online") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success">
        <CheckCircle2 className="w-3 h-3" /> Online
      </span>
    );
  }
  if (status === "unsupported") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        <Info className="w-3 h-3" /> Not supported
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-foreground">
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/15 text-destructive">
      <XCircle className="w-3 h-3" /> Offline
    </span>
  );
}

export default function AdminProviderBalancesPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [thresholds, setThresholds] = useState<Record<string, string>>({
    provider_balance_threshold_portal_02: "100",
    provider_balance_threshold_iget: "100",
  });
  const [savingThresholds, setSavingThresholds] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: cur }, { data: hist }, { data: settings }] = await Promise.all([
      supabase.from("provider_balance_current").select("*").order("provider"),
      supabase
        .from("provider_balance_history")
        .select("*")
        .order("retrieved_at", { ascending: false })
        .limit(50),
      supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", [
          "provider_balance_threshold_portal_02",
          "provider_balance_threshold_iget",
        ]),
    ]);
    setRows((cur || []) as BalanceRow[]);
    setHistory((hist || []) as HistoryRow[]);
    if (settings) {
      const m: Record<string, string> = { ...thresholds };
      settings.forEach((s: any) => { m[s.key] = s.value; });
      setThresholds(m);
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 60_000);
    return () => clearInterval(t);
  }, [loadAll]);

  const refreshBalances = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("fetch-provider-balances", {
        body: { source: "manual" },
      });
      if (error) throw error;
      await loadAll();
      toast({ title: "Balances refreshed" });
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const saveThresholds = async () => {
    setSavingThresholds(true);
    try {
      for (const [key, value] of Object.entries(thresholds)) {
        await supabase
          .from("platform_settings")
          .update({ value, updated_at: new Date().toISOString() })
          .eq("key", key);
      }
      toast({ title: "Thresholds saved" });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setSavingThresholds(false);
    }
  };

  const thresholdFor = (provider: string) =>
    Number(
      provider === "Portal-02"
        ? thresholds.provider_balance_threshold_portal_02
        : thresholds.provider_balance_threshold_iget
    );

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary" /> Provider Balances
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live wallet balances from upstream data providers. Auto-refreshed every 5 minutes.
            </p>
          </div>
          <Button onClick={refreshBalances} disabled={refreshing} className="gap-2">
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh Balances
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rows.map((r) => {
                const th = thresholdFor(r.provider);
                const isLow = r.status === "online" && r.balance != null && r.balance < th;
                return (
                  <div key={r.provider} className="glass-card glow-border p-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-display font-semibold text-foreground text-lg">{r.provider}</h3>
                        <p className="text-xs text-muted-foreground">
                          Last checked {r.last_checked_at ? formatDistanceToNow(new Date(r.last_checked_at), { addSuffix: true }) : "—"}
                        </p>
                      </div>
                      <StatusPill status={r.status} />
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className={`text-3xl font-bold ${isLow ? "text-destructive" : "text-foreground"}`}>
                        {r.status === "online" ? fmt(r.balance, r.currency) : r.status === "unsupported" ? "N/A" : fmt(r.last_success_balance, r.currency)}
                      </span>
                      {isLow && <AlertTriangle className="w-5 h-5 text-destructive" />}
                    </div>

                    {r.status === "offline" && r.last_success_at && (
                      <p className="text-xs text-muted-foreground">
                        Last successful: {fmt(r.last_success_balance, r.currency)} ({formatDistanceToNow(new Date(r.last_success_at), { addSuffix: true })})
                      </p>
                    )}
                    {r.error_message && (
                      <p className="text-xs text-destructive break-words">{r.error_message}</p>
                    )}
                    {r.status === "online" && (
                      <p className="text-xs text-muted-foreground">Threshold: {fmt(th, r.currency)}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Thresholds */}
            <div className="glass-card glow-border p-5 space-y-4">
              <h2 className="font-display font-semibold text-foreground">Low Balance Thresholds</h2>
              <p className="text-xs text-muted-foreground">
                Admins are notified when an online provider's balance drops below its threshold.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Portal-02 (GHS)</Label>
                  <Input
                    type="number"
                    value={thresholds.provider_balance_threshold_portal_02}
                    onChange={(e) =>
                      setThresholds((t) => ({ ...t, provider_balance_threshold_portal_02: e.target.value }))
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>iGet (GHS)</Label>
                  <Input
                    type="number"
                    value={thresholds.provider_balance_threshold_iget}
                    onChange={(e) =>
                      setThresholds((t) => ({ ...t, provider_balance_threshold_iget: e.target.value }))
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <Button onClick={saveThresholds} disabled={savingThresholds} className="gap-2">
                {savingThresholds && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Thresholds
              </Button>
            </div>

            {/* iGet limitation note */}
            <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground flex gap-3">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <strong className="text-foreground">iGet balance API not available.</strong> The iGet provider
                does not currently expose a public balance endpoint — all probed routes return 404. Monitor
                iGet wallet balance directly from the iGet dashboard. We will integrate it automatically as
                soon as the provider publishes a balance endpoint.
              </div>
            </div>

            {/* History */}
            <div className="glass-card glow-border p-5">
              <h2 className="font-display font-semibold text-foreground mb-4">Recent Balance Checks</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4">Provider</th>
                      <th className="py-2 pr-4">Balance</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Retrieved</th>
                      <th className="py-2 pr-4">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-medium">{h.provider}</td>
                        <td className="py-2 pr-4">{fmt(h.balance, h.currency)}</td>
                        <td className="py-2 pr-4"><StatusPill status={h.status} /></td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {formatDistanceToNow(new Date(h.retrieved_at), { addSuffix: true })}
                        </td>
                        <td className="py-2 pr-4 text-xs text-destructive max-w-xs truncate">
                          {h.error_message || ""}
                        </td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No history yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
