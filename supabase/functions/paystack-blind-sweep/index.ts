import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Paystack Blind Sweep — safety-net reconciliation.
 *
 * Lists recent successful transactions from Paystack and detects ones that
 * have NO local trace (no payment_attempt, no topup, no wallet_transaction,
 * no order, no checker_purchase). For each missing transaction:
 *   - Wallet top-ups → recovered via canonical credit_wallet_paystack RPC
 *   - Direct data/checker orders → flagged as needs_review payment_attempt
 *     (we never blindly create orders without a pre-checkout record)
 *   - Anything ambiguous → flagged as needs_review
 *
 * Idempotency is guaranteed by:
 *   - PSK-{reference} unique constraint on wallet_transactions
 *   - paystack_reference unique constraint on payment_attempts
 *   - Existing checks before any RPC call
 *
 * Schedule: every ~20 minutes via pg_cron. Admin-triggerable.
 */

interface PaystackTx {
  id: number;
  reference: string;
  amount: number; // pesewas
  status: string;
  paid_at: string | null;
  currency: string;
  channel: string;
  customer?: { email?: string | null; phone?: string | null };
  metadata?: any;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  const stats = {
    scanned: 0,
    already_local: 0,
    recovered_topup: 0,
    flagged_needs_review: 0,
    skipped_unsafe: 0,
    errors: 0,
  };

  const startedAt = Date.now();
  let hoursBack = 24;
  let dryRun = false;
  let triggeredBy = "cron";

  try {
    // ── 0. Optional config ──────────────────────────────────
    try {
      const body = await req.json();
      if (body?.hours_back && Number.isFinite(body.hours_back)) {
        hoursBack = Math.min(72, Math.max(1, Number(body.hours_back)));
      }
      if (body?.dry_run === true) dryRun = true;
      if (typeof body?.triggered_by === "string" && body.triggered_by.length <= 32) {
        triggeredBy = body.triggered_by;
      }
    } catch {
      /* GET / cron — no body */
    }

    // ── 1. Get Paystack secret ──────────────────────────────
    const { data: settingRow } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "paystack_secret_key")
      .single();

    const paystackSecret = settingRow?.value;
    if (!paystackSecret) {
      console.error("[paystack-blind-sweep] secret key not configured");
      return new Response(JSON.stringify({ error: "Paystack not configured" }), { status: 500, headers: h });
    }

    // ── 2. List successful transactions on Paystack ─────────
    const fromIso = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    const toIso = new Date().toISOString();

    const transactions: PaystackTx[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 5; // hard cap → 500 txns per sweep

    while (page <= maxPages) {
      const url = new URL("https://api.paystack.co/transaction");
      url.searchParams.set("status", "success");
      url.searchParams.set("from", fromIso);
      url.searchParams.set("to", toIso);
      url.searchParams.set("perPage", String(perPage));
      url.searchParams.set("page", String(page));

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      });

      if (!res.ok) {
        console.error(`[paystack-blind-sweep] Paystack list failed page=${page} status=${res.status}`);
        break;
      }

      const json = await res.json();
      const batch: PaystackTx[] = json?.data || [];
      transactions.push(...batch);

      if (batch.length < perPage) break;
      page++;
    }

    stats.scanned = transactions.length;
    console.log(`[paystack-blind-sweep] Scanned ${stats.scanned} successful txns (last ${hoursBack}h)`);

    if (transactions.length === 0) {
      await logRun(supabase, { stats, hoursBack, dryRun, triggeredBy, startedAt, succeeded: true });
      return new Response(JSON.stringify({ ...stats, dry_run: dryRun, hours_back: hoursBack }), { status: 200, headers: h });
    }

    // ── 3. Bulk presence check (one query per table) ────────
    const refs = transactions.map((t) => t.reference);
    const pskRefs = refs.map((r) => `PSK-${r}`);

    const [
      { data: existingAttempts },
      { data: existingTopups },
      { data: existingWalletTx },
      { data: existingOrders },
      { data: existingPurchases },
      { data: existingAfa },
    ] = await Promise.all([
      supabase.from("payment_attempts").select("paystack_reference,status").in("paystack_reference", refs),
      supabase.from("topups").select("payment_reference").in("payment_reference", [...refs, ...pskRefs]),
      supabase
        .from("wallet_transactions")
        .select("reference")
        .eq("type", "credit")
        .in("reference", [...refs, ...pskRefs]),
      supabase.from("orders").select("payment_reference").in("payment_reference", refs),
      supabase.from("checker_purchases").select("payment_reference").in("payment_reference", refs),
      supabase.from("afa_registrations").select("payment_reference").in("payment_reference", refs),
    ]);

    const knownRefs = new Set<string>();
    for (const r of existingAttempts || []) knownRefs.add(r.paystack_reference);
    for (const r of existingTopups || []) knownRefs.add((r.payment_reference || "").replace(/^PSK-/, ""));
    for (const r of existingWalletTx || []) knownRefs.add((r.reference || "").replace(/^PSK-/, ""));
    for (const r of existingOrders || []) knownRefs.add(r.payment_reference);
    for (const r of existingPurchases || []) knownRefs.add(r.payment_reference);
    for (const r of existingAfa || []) knownRefs.add(r.payment_reference);


    // ── 4. Process each missing txn ─────────────────────────
    for (const tx of transactions) {
      if (knownRefs.has(tx.reference)) {
        stats.already_local++;
        continue;
      }

      const metadata = tx.metadata || {};
      const txType: string = metadata.type || "";
      const amountGHS = tx.amount / 100;

      try {
        // ─── AFA: NEVER auto-credit; only flag if truly orphaned ───
        if (txType === "afa" || (typeof tx.reference === "string" && tx.reference.startsWith("AFA-"))) {
          if (dryRun) {
            stats.flagged_needs_review++;
            continue;
          }
          await flagOrphan(supabase, tx, metadata, amountGHS, "afa");
          stats.flagged_needs_review++;
          continue;
        }

        // ─── Wallet top-up: SAFE auto-recovery ───
        if (txType === "wallet_topup" || metadata.purpose === "wallet_topup") {
          if (dryRun) {
            stats.recovered_topup++;
            continue;
          }
          await recoverWalletTopup(supabase, tx, metadata, amountGHS);
          stats.recovered_topup++;
          continue;
        }

        // ─── Order/checker payments: needs_review (canonical flow can't reconstruct) ───
        if (txType === "data_direct" || txType === "checker_direct") {
          if (dryRun) {
            stats.flagged_needs_review++;
            continue;
          }
          await flagOrphan(supabase, tx, metadata, amountGHS, txType);
          stats.flagged_needs_review++;
          continue;
        }


        // ─── Untyped: try to infer from credit_amount metadata (legacy top-up) ───
        const hasCreditAmount =
          metadata.credit_amount != null ||
          (Array.isArray(metadata.custom_fields) &&
            metadata.custom_fields.some((f: any) => f?.variable_name === "credit_amount"));

        if (hasCreditAmount && metadata.customer_id) {
          if (dryRun) {
            stats.recovered_topup++;
            continue;
          }
          await recoverWalletTopup(supabase, tx, metadata, amountGHS);
          stats.recovered_topup++;
          continue;
        }

        // ─── Anything else: needs_review, never guess ───
        if (dryRun) {
          stats.flagged_needs_review++;
          continue;
        }
        await flagOrphan(supabase, tx, metadata, amountGHS, txType || "unknown");
        stats.flagged_needs_review++;
      } catch (err) {
        console.error(`[paystack-blind-sweep] error processing ref=${tx.reference}:`, err);
        stats.errors++;
      }
    }

    // ── 5. Single admin notification if anything happened ───
    if (!dryRun && (stats.recovered_topup > 0 || stats.flagged_needs_review > 0)) {
      try {
        await supabase.from("notifications").insert({
          target_type: "admin",
          target_id: null,
          type: stats.flagged_needs_review > 0 ? "failure" : "wallet",
          title: stats.flagged_needs_review > 0 ? "Blind Sweep: Orphan Payments Found" : "Blind Sweep: Top-ups Recovered",
          message:
            `Recovered ${stats.recovered_topup} wallet top-up(s), flagged ${stats.flagged_needs_review} payment(s) for review ` +
            `(scanned ${stats.scanned} from last ${hoursBack}h).`,
          metadata: { ...stats, hours_back: hoursBack, alert_type: "blind_sweep" },
        });
      } catch (_) { /* non-fatal */ }
    }

    console.log(`[paystack-blind-sweep] Done:`, stats);
    await logRun(supabase, { stats, hoursBack, dryRun, triggeredBy, startedAt, succeeded: true });
    return new Response(JSON.stringify({ ...stats, dry_run: dryRun, hours_back: hoursBack }), { status: 200, headers: h });
  } catch (error) {
    console.error("[paystack-blind-sweep] fatal:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    try {
      await logRun(supabase, { stats, hoursBack, dryRun, triggeredBy, startedAt, succeeded: false, errorMessage: msg });
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg, ...stats }), { status: 500, headers: h });
  }
});

// ─────────────────────────────────────────────────────────────
// Wallet top-up recovery (canonical idempotent path)
// ─────────────────────────────────────────────────────────────
async function recoverWalletTopup(
  supabase: any,
  tx: PaystackTx,
  metadata: any,
  amountGHS: number,
) {
  // Resolve customer
  let customerId: string | null = metadata.customer_id || null;

  if (!customerId && tx.customer?.email) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("email", tx.customer.email)
      .maybeSingle();
    customerId = data?.id || null;
  }

  if (!customerId) {
    // Can't safely credit — flag instead
    await flagOrphan(supabase, tx, metadata, amountGHS, "wallet_topup_no_customer");
    return;
  }

  // Resolve credit amount from metadata when present (top-ups exclude the 2% fee)
  let creditAmount: number | null = null;
  if (metadata.credit_amount != null && !isNaN(Number(metadata.credit_amount))) {
    creditAmount = Number(metadata.credit_amount);
  }
  if (creditAmount == null && Array.isArray(metadata.custom_fields)) {
    const cf = metadata.custom_fields.find((f: any) => f?.variable_name === "credit_amount");
    if (cf?.value != null && !isNaN(Number(cf.value))) creditAmount = Number(cf.value);
  }
  if (creditAmount == null) creditAmount = amountGHS;

  const pskRef = `PSK-${tx.reference}`;
  const description = `Wallet top-up via Paystack (recovered by blind sweep)`;

  const { data: result, error } = await supabase.rpc("credit_wallet_paystack", {
    p_customer_id: customerId,
    p_reference: pskRef,
    p_amount: creditAmount,
    p_description: description,
  });

  if (error) {
    console.error(`[blind-sweep] credit_wallet_paystack failed ref=${tx.reference}:`, error);
    throw error;
  }

  const r = result as any;
  if (r?.already_processed) {
    console.log(`[blind-sweep] already_processed (race) ref=${tx.reference}`);
    return;
  }
  if (r?.error) {
    console.error(`[blind-sweep] RPC returned error ref=${tx.reference}:`, r.error);
    throw new Error(r.error);
  }

  console.log(`[blind-sweep] Credited GHS ${creditAmount} → customer ${customerId} (ref=${tx.reference})`);

  // Send confirmation email (best-effort)
  supabase.functions.invoke("send-transactional-email", {
    body: {
      template: "wallet-topup",
      customer_id: customerId,
      data: {
        amount: creditAmount,
        new_balance: r.new_balance,
        method: "Paystack",
        short_id: pskRef,
      },
    },
  }).catch((e: any) => console.error("[blind-sweep] email error:", e));
}

// ─────────────────────────────────────────────────────────────
// Flag as needs_review (admin sees in Payment Recovery page)
// ─────────────────────────────────────────────────────────────
async function flagOrphan(
  supabase: any,
  tx: PaystackTx,
  metadata: any,
  amountGHS: number,
  txType: string,
) {
  const customerId = metadata.customer_id || "00000000-0000-0000-0000-000000000000";
  const buyerType = metadata.buyer_type || "registered";
  const buyerPhone = (metadata.buyer_phone || tx.customer?.phone || "").replace(/[^0-9]/g, "");
  const buyerEmail = metadata.buyer_email || tx.customer?.email || "";

  await supabase.from("payment_attempts").upsert(
    {
      paystack_reference: tx.reference,
      customer_id: customerId,
      attempt_type: txType || "unknown",
      status: "needs_review",
      amount: amountGHS,
      metadata,
      buyer_type: buyerType,
      buyer_phone: buyerPhone,
      buyer_email: buyerEmail,
      affiliate_code: metadata.affiliate_code || "",
      paystack_transaction_id: tx.id?.toString(),
      paystack_response: tx,
      webhook_received_at: null,
      error_message: `Orphan detected by blind sweep — Paystack success without local record (paid_at=${tx.paid_at})`,
      event_log: [
        {
          type: "blind_sweep_orphan",
          paystack_status: tx.status,
          paid_at: tx.paid_at,
          channel: tx.channel,
          tx_type: txType,
          timestamp: new Date().toISOString(),
        },
      ],
    },
    { onConflict: "paystack_reference" },
  );

  console.log(`[blind-sweep] Flagged orphan ref=${tx.reference} type=${txType} amount=GHS ${amountGHS}`);
}

// ─────────────────────────────────────────────────────────────
// Persist run summary to blind_sweep_runs (best-effort)
// ─────────────────────────────────────────────────────────────
async function logRun(
  supabase: any,
  opts: {
    stats: { scanned: number; already_local: number; recovered_topup: number; flagged_needs_review: number; skipped_unsafe: number; errors: number };
    hoursBack: number;
    dryRun: boolean;
    triggeredBy: string;
    startedAt: number;
    succeeded: boolean;
    errorMessage?: string;
  },
) {
  try {
    await supabase.from("blind_sweep_runs").insert({
      hours_back: opts.hoursBack,
      dry_run: opts.dryRun,
      scanned: opts.stats.scanned,
      already_local: opts.stats.already_local,
      recovered_topup: opts.stats.recovered_topup,
      flagged_needs_review: opts.stats.flagged_needs_review,
      skipped_unsafe: opts.stats.skipped_unsafe,
      errors: opts.stats.errors,
      succeeded: opts.succeeded,
      error_message: opts.errorMessage || null,
      triggered_by: opts.triggeredBy,
      duration_ms: Date.now() - opts.startedAt,
    });
  } catch (e) {
    console.error("[blind-sweep] logRun failed:", e);
  }
}
