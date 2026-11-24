import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Stale payment recovery job.
 * Finds pending/processing payment_attempts older than 5 minutes and
 * delegates each to the canonical finalize-payment function.
 * Also checks partially_completed attempts for potential retry.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    // Mobile Money charges sometimes get approved by the customer well after our
    // system gave up. Re-check abandoned attempts from the last 48h against Paystack.
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Fetch stale pending (>5 min) and stale processing (>10 min, to avoid interfering with active finalization)
    const { data: stalePending } = await supabase
      .from("payment_attempts")
      .select("id, paystack_reference, status, created_at, updated_at, event_log, recovery_attempts")
      .eq("status", "pending")
      .lt("created_at", fiveMinAgo)
      .order("created_at", { ascending: true })
      .limit(15);

    const { data: staleProcessing } = await supabase
      .from("payment_attempts")
      .select("id, paystack_reference, status, created_at, updated_at, event_log, recovery_attempts")
      .eq("status", "processing")
      .lt("updated_at", tenMinAgo)
      .order("created_at", { ascending: true })
      .limit(10);

    // Re-verify recently abandoned attempts: MoMo can finalize on Paystack after we abandoned.
    const { data: abandonedAttempts } = await supabase
      .from("payment_attempts")
      .select("id, paystack_reference, status, created_at, updated_at, event_log, recovery_attempts")
      .eq("status", "abandoned")
      .gte("created_at", fortyEightHoursAgo)
      .lt("updated_at", fiveMinAgo)
      .or("recovery_attempts.is.null,recovery_attempts.lt.3")
      .order("created_at", { ascending: false })
      .limit(20);

    // Mark each stale-processing attempt with an audit event before re-finalization
    if (staleProcessing && staleProcessing.length > 0) {
      for (const sp of staleProcessing) {
        const log = Array.isArray(sp.event_log) ? sp.event_log : [];
        await supabase.from("payment_attempts").update({
          event_log: [...log, {
            type: "stale_processing_detected",
            stuck_for_seconds: Math.round((Date.now() - new Date(sp.updated_at).getTime()) / 1000),
            timestamp: new Date().toISOString(),
          }],
        }).eq("id", sp.id);
      }
    }

    const staleAttempts = [...(stalePending || []), ...(staleProcessing || []), ...(abandonedAttempts || [])];

    if (!staleAttempts || staleAttempts.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { status: 200, headers: h });
    }

    let recovered = 0;
    let failed = 0;
    let abandoned = 0;

    for (const attempt of staleAttempts) {
      const reference = attempt.paystack_reference;
      const existingLog = Array.isArray(attempt.event_log) ? attempt.event_log : [];
      const recoveryCount = (attempt.recovery_attempts || 0) + 1;

      // Skip if too many recovery attempts already
      if (recoveryCount > 5) {
        const age = Date.now() - new Date(attempt.created_at).getTime();
        if (age > 60 * 60 * 1000) {
          await supabase.from("payment_attempts").update({
            status: "abandoned",
            error_message: `Abandoned after ${recoveryCount} recovery attempts over 1+ hour`,
            recovery_attempts: recoveryCount,
            last_recovery_at: new Date().toISOString(),
            event_log: [...existingLog, { type: "recovery_abandoned_max_retries", timestamp: new Date().toISOString() }],
            updated_at: new Date().toISOString(),
          }).eq("id", attempt.id).eq("status", attempt.status);
          abandoned++;
        }
        continue;
      }

      try {
        const { data: result, error: invokeErr } = await supabase.functions.invoke("finalize-payment", {
          body: { reference, source: "recovery" },
        });

        if (invokeErr) {
          console.error(`[recover-stale-payments] finalize-payment error ref=${reference}:`, invokeErr);
          failed++;
          continue;
        }

        const res = result as any;

        if (res?.success || res?.finalized || res?.already_processed) {
          recovered++;
        } else if (res?.error) {
          if (res.paystack_status && ["failed", "abandoned", "reversed"].includes(res.paystack_status)) {
            failed++;
          } else {
            const age = Date.now() - new Date(attempt.created_at).getTime();
            if (age > 30 * 60 * 1000) {
              await supabase.from("payment_attempts").update({
                status: "abandoned",
                error_message: `Abandoned after 30+ minutes: ${res.error}`,
                recovery_attempts: recoveryCount,
                last_recovery_at: new Date().toISOString(),
                event_log: [...existingLog, { type: "recovery_abandoned", error: res.error, timestamp: new Date().toISOString() }],
                updated_at: new Date().toISOString(),
              }).eq("id", attempt.id).eq("status", attempt.status);
              abandoned++;
            }
          }
        }
      } catch (e) {
        console.error(`[recover-stale-payments] Error processing ref=${reference}:`, e);
        failed++;
      }
    }

    console.log(`[recover-stale-payments] Done: ${recovered} recovered, ${failed} failed, ${abandoned} abandoned`);

    return new Response(
      JSON.stringify({ processed: staleAttempts.length, recovered, failed, abandoned }),
      { status: 200, headers: h }
    );
  } catch (error) {
    console.error("[recover-stale-payments] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
