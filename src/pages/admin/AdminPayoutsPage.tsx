import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Search, RefreshCw, Download, CheckCircle2, XCircle, RotateCcw, Eye } from "lucide-react";
import { exportRowsToCSV } from "@/lib/csv-export";

type PayoutRow = {
  id: string;
  short_id: string;
  payout_type: "affiliate" | "store";
  owner_id: string;
  amount: number;
  net_amount: number;
  status: string;
  rail: string;
  momo_number: string;
  momo_name: string;
  network: string;
  paystack_transfer_code: string | null;
  paystack_transfer_reference: string | null;
  failure_reason: string | null;
  admin_note: string | null;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  customers?: { full_name: string; email: string; phone: string } | null;
};

const STATUS_VARIANT: Record<string, { className: string; label: string }> = {
  pending_approval: { className: "bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Pending Approval" },
  approved: { className: "bg-primary text-primary-foreground", label: "Approved" },
  processing: { className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", label: "Processing" },
  success: { className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Success" },
  failed: { className: "bg-rose-500/15 text-rose-700 dark:text-rose-300", label: "Failed" },
  reversed: { className: "bg-orange-500/15 text-orange-700 dark:text-orange-300", label: "Reversed" },
  cancelled: { className: "bg-gray-500/15 text-gray-700 dark:text-gray-300", label: "Cancelled" },
};

function StatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANT[status] ?? { className: "", label: status };
  return <Badge className={`${v.className} font-medium border-0`}>{v.label}</Badge>;
}

export default function AdminPayoutsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<PayoutRow | null>(null);
  const [cancelDialog, setCancelDialog] = useState<PayoutRow | null>(null);
  const [momoDialog, setMomoDialog] = useState<PayoutRow | null>(null);
  const [momoNote, setMomoNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payouts")
        .select("*, customers!payouts_owner_id_fkey(full_name,email,phone)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as unknown) as PayoutRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data;
    if (tab !== "all") rows = rows.filter((r) => r.status === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.short_id.toLowerCase().includes(q) ||
        r.momo_number.toLowerCase().includes(q) ||
        (r.customers?.full_name || "").toLowerCase().includes(q) ||
        (r.customers?.email || "").toLowerCase().includes(q) ||
        (r.paystack_transfer_reference || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, tab, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length || 0 };
    (data || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [data]);

  const approveAndInitiate = useMutation({
    mutationFn: async (id: string) => {
      const { data: ap, error } = await supabase.rpc("admin_approve_payout", { p_payout_id: id, p_rail: "paystack" });
      if (error) throw error;
      const apr = ap as any;
      if (apr?.error) throw new Error(apr.error);
      const { data: res, error: e2 } = await supabase.functions.invoke("payout-initiate", { body: { payout_id: id } });
      if (e2) throw e2;
      const r = res as any;
      if (r?.error) throw new Error(r.error);
      return r;
    },
    onSuccess: () => {
      toast({ title: "Payout initiated", description: "Paystack transfer has been started." });
      qc.invalidateQueries({ queryKey: ["admin-payouts"] });
    },
    onError: (e: any) => toast({ title: "Initiation failed", description: e.message, variant: "destructive" }),
  });

  const retryPayout = useMutation({
    mutationFn: async (id: string) => {
      const { data: res, error } = await supabase.functions.invoke("payout-retry", { body: { payout_id: id } });
      if (error) throw error;
      const r = res as any;
      if (r?.error) throw new Error(r.error);
      return r;
    },
    onSuccess: () => {
      toast({ title: "Retry initiated" });
      qc.invalidateQueries({ queryKey: ["admin-payouts"] });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });

  const cancelPayout = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data: res, error } = await supabase.rpc("admin_cancel_payout", { p_payout_id: id, p_reason: reason });
      if (error) throw error;
      const r = res as any;
      if (r?.error) throw new Error(r.error);
      return r;
    },
    onSuccess: () => {
      toast({ title: "Payout cancelled", description: "Funds released back to available balance." });
      qc.invalidateQueries({ queryKey: ["admin-payouts"] });
      setCancelDialog(null);
      setCancelReason("");
    },
    onError: (e: any) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  const markPaidMomo = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { data: res, error } = await supabase.rpc("admin_mark_payout_paid_momo", { p_payout_id: id, p_note: note || null });
      if (error) throw error;
      const r = res as any;
      if (r?.error) throw new Error(r.error);
      return r;
    },
    onSuccess: () => {
      toast({ title: "Marked as paid via MoMo", description: "Payout completed and funds finalized." });
      qc.invalidateQueries({ queryKey: ["admin-payouts"] });
      setMomoDialog(null);
      setMomoNote("");
    },
    onError: (e: any) => toast({ title: "Could not mark as paid", description: e.message, variant: "destructive" }),
  });

  const onExport = () => {
    if (!filtered.length) return;
    const rows = filtered.map((r) => ({
      short_id: r.short_id,
      type: r.payout_type,
      recipient_name: r.customers?.full_name || "",
      recipient_email: r.customers?.email || "",
      momo_number: r.momo_number,
      momo_name: r.momo_name,
      network: r.network,
      amount_ghs: Number(r.amount).toFixed(2),
      net_amount_ghs: Number(r.net_amount).toFixed(2),
      status: r.status,
      rail: r.rail,
      paystack_transfer_code: r.paystack_transfer_code || "",
      paystack_reference: r.paystack_transfer_reference || "",
      failure_reason: r.failure_reason || "",
      created_at: r.created_at,
      approved_at: r.approved_at || "",
      completed_at: r.completed_at || "",
    }));
    exportRowsToCSV(`payouts-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
      { key: "short_id", label: "ID" },
      { key: "type", label: "Type" },
      { key: "recipient_name", label: "Recipient" },
      { key: "recipient_email", label: "Email" },
      { key: "momo_number", label: "Momo" },
      { key: "momo_name", label: "Momo Name" },
      { key: "network", label: "Network" },
      { key: "amount_ghs", label: "Amount (GHS)" },
      { key: "net_amount_ghs", label: "Net (GHS)" },
      { key: "status", label: "Status" },
      { key: "rail", label: "Rail" },
      { key: "paystack_transfer_code", label: "Transfer Code" },
      { key: "paystack_reference", label: "Reference" },
      { key: "failure_reason", label: "Failure Reason" },
      { key: "created_at", label: "Created" },
      { key: "approved_at", label: "Approved" },
      { key: "completed_at", label: "Completed" },
    ]);
  };

  const totals = useMemo(() => {
    const t = { count: filtered.length, sum: 0, success: 0, failed: 0 };
    filtered.forEach((r) => {
      t.sum += Number(r.amount || 0);
      if (r.status === "success") t.success += Number(r.amount || 0);
      if (r.status === "failed" || r.status === "reversed") t.failed += Number(r.amount || 0);
    });
    return t;
  }, [filtered]);

  const renderActions = (r: any) => (
    <>
                          {r.status === "pending_approval" && (
                            <>
                              <Button size="sm" variant="default" className="ml-1" onClick={() => approveAndInitiate.mutate(r.id)} disabled={approveAndInitiate.isPending}>
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve & Send
                              </Button>
                              <Button size="sm" variant="ghost" className="ml-1 text-rose-600" onClick={() => setCancelDialog(r)}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {r.status === "approved" && (
                            <>
                              <Button size="sm" variant="default" className="ml-1" onClick={() => approveAndInitiate.mutate(r.id)} disabled={approveAndInitiate.isPending}>Send Now</Button>
                              <Button size="sm" variant="ghost" className="ml-1 text-rose-600" onClick={() => setCancelDialog(r)}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {r.status === "failed" && (
                            <>
                              <Button size="sm" variant="outline" className="ml-1" onClick={() => retryPayout.mutate(r.id)} disabled={retryPayout.isPending}>
                                <RotateCcw className="h-4 w-4 mr-1" /> Retry
                              </Button>
                              <Button size="sm" variant="outline" className="ml-1 text-emerald-700 dark:text-emerald-300" onClick={() => setMomoDialog(r)}>
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Paid via MoMo
                              </Button>
                            </>
                          )}
    </>
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Payouts</h1>
            <p className="text-sm text-muted-foreground">Affiliate &amp; store commission payouts via Paystack Transfers.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} disabled={!filtered.length}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-xs text-muted-foreground">Filtered total</div><div className="text-xl font-semibold">{totals.count}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Volume (GHS)</div><div className="text-xl font-semibold">{totals.sum.toFixed(2)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Successful (GHS)</div><div className="text-xl font-semibold text-emerald-600">{totals.success.toFixed(2)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Failed/Reversed (GHS)</div><div className="text-xl font-semibold text-rose-600">{totals.failed.toFixed(2)}</div></Card>
        </div>

        <Card className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by ID, name, email, momo or Paystack ref" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="all">All ({counts.all || 0})</TabsTrigger>
              <TabsTrigger value="pending_approval">Pending ({counts.pending_approval || 0})</TabsTrigger>
              <TabsTrigger value="approved">Approved ({counts.approved || 0})</TabsTrigger>
              <TabsTrigger value="processing">Processing ({counts.processing || 0})</TabsTrigger>
              <TabsTrigger value="success">Success ({counts.success || 0})</TabsTrigger>
              <TabsTrigger value="failed">Failed ({counts.failed || 0})</TabsTrigger>
              <TabsTrigger value="reversed">Reversed ({counts.reversed || 0})</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled ({counts.cancelled || 0})</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-4">
              <div className="md:hidden space-y-2.5">
                {isLoading ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
                ) : filtered.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No payouts.</p>
                ) : filtered.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-border bg-card p-3.5 space-y-2" onClick={() => setDetail(r)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{r.customers?.full_name || "—"}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{r.short_id} · <span className="capitalize font-sans">{r.payout_type}</span></p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{r.network} · {r.momo_number}</span>
                      <span className="font-semibold text-sm">GHS {Number(r.amount).toFixed(2)}</span>
                    </div>
                    <p className="text-[10.5px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                    <div className="flex flex-wrap gap-1 [&>button]:ml-0" onClick={(e) => e.stopPropagation()}>
                      {renderActions(r)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left p-2">ID</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Recipient</th>
                      <th className="text-left p-2">Momo</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Created</th>
                      <th className="text-right p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No payouts.</td></tr>
                    ) : filtered.map((r) => (
                      <tr key={r.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-mono text-xs">{r.short_id}</td>
                        <td className="p-2 capitalize">{r.payout_type}</td>
                        <td className="p-2">
                          <div className="font-medium">{r.customers?.full_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.customers?.email}</div>
                        </td>
                        <td className="p-2">
                          <div>{r.momo_number}</div>
                          <div className="text-xs text-muted-foreground">{r.network} · {r.momo_name}</div>
                        </td>
                        <td className="p-2 text-right font-medium">GHS {Number(r.amount).toFixed(2)}</td>
                        <td className="p-2"><StatusBadge status={r.status} /></td>
                        <td className="p-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="p-2 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => setDetail(r)}><Eye className="h-4 w-4" /></Button>
                          {renderActions(r)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </Card>

        {/* Detail dialog */}
        <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{detail?.short_id}</DialogTitle></DialogHeader>
            {detail && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-muted-foreground text-xs">Type</div><div className="capitalize">{detail.payout_type}</div></div>
                <div><div className="text-muted-foreground text-xs">Status</div><div><StatusBadge status={detail.status} /></div></div>
                <div><div className="text-muted-foreground text-xs">Recipient</div><div>{detail.customers?.full_name}</div></div>
                <div><div className="text-muted-foreground text-xs">Email</div><div>{detail.customers?.email}</div></div>
                <div><div className="text-muted-foreground text-xs">Momo</div><div>{detail.network} · {detail.momo_number}</div></div>
                <div><div className="text-muted-foreground text-xs">Momo Name</div><div>{detail.momo_name}</div></div>
                <div><div className="text-muted-foreground text-xs">Amount</div><div>GHS {Number(detail.amount).toFixed(2)}</div></div>
                <div><div className="text-muted-foreground text-xs">Net</div><div>GHS {Number(detail.net_amount).toFixed(2)}</div></div>
                <div className="col-span-2"><div className="text-muted-foreground text-xs">Paystack Transfer Code</div><div className="font-mono text-xs">{detail.paystack_transfer_code || "—"}</div></div>
                <div className="col-span-2"><div className="text-muted-foreground text-xs">Paystack Reference</div><div className="font-mono text-xs">{detail.paystack_transfer_reference || "—"}</div></div>
                {detail.failure_reason && <div className="col-span-2"><div className="text-muted-foreground text-xs">Failure Reason</div><div className="text-rose-600">{detail.failure_reason}</div></div>}
                {detail.admin_note && <div className="col-span-2"><div className="text-muted-foreground text-xs">Admin Note</div><div>{detail.admin_note}</div></div>}
                <div><div className="text-muted-foreground text-xs">Created</div><div>{new Date(detail.created_at).toLocaleString()}</div></div>
                <div><div className="text-muted-foreground text-xs">Completed</div><div>{detail.completed_at ? new Date(detail.completed_at).toLocaleString() : "—"}</div></div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Cancel dialog */}
        <Dialog open={!!cancelDialog} onOpenChange={(o) => !o && (setCancelDialog(null), setCancelReason(""))}>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancel payout {cancelDialog?.short_id}?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Funds will be released back to the recipient's available balance. This cannot be undone.</p>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. wrong momo number, customer requested" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCancelDialog(null)}>Keep</Button>
              <Button variant="destructive" onClick={() => cancelDialog && cancelPayout.mutate({ id: cancelDialog.id, reason: cancelReason })} disabled={cancelPayout.isPending}>
                Confirm cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Mark as paid via MoMo dialog */}
        <Dialog open={!!momoDialog} onOpenChange={(o) => !o && (setMomoDialog(null), setMomoNote(""))}>
          <DialogContent>
            <DialogHeader><DialogTitle>Mark {momoDialog?.short_id} as paid via MoMo?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              Confirm you have sent GHS {momoDialog ? Number(momoDialog.amount).toFixed(2) : ""} to {momoDialog?.momo_name} ({momoDialog?.network} · {momoDialog?.momo_number}) manually via Mobile Money.
              The payout will be marked as paid and the locked funds finalized. This cannot be undone.
            </p>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Textarea value={momoNote} onChange={(e) => setMomoNote(e.target.value)} placeholder="e.g. MoMo transaction ID" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setMomoDialog(null)}>Back</Button>
              <Button onClick={() => momoDialog && markPaidMomo.mutate({ id: momoDialog.id, note: momoNote })} disabled={markPaidMomo.isPending}>
                Confirm paid via MoMo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
