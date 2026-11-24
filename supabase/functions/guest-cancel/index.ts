import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Marks a pending guest payment_attempt as abandoned when the user
 * cancels/closes the Paystack popup. Mirrors the registered-flow
 * cleanup so abandoned attempts don't pollute pending queues.
 *
 * Safe by design:
 *  - Only updates rows still in 'pending' status (never overwrites successful/finalized)
 *  - Only updates rows where buyer_type = 'guest'
 *  - Always uses service_role; reference is the only required input
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const { reference } = await req.json();
    if (!reference || typeof reference !== "string") {
      return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400, headers: h });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existing } = await supabase
      .from("payment_attempts")
      .select("id, status, event_log, buyer_type")
      .eq("paystack_reference", reference)
      .maybeSingle();

    if (!existing) {
      return new Response(JSON.stringify({ ok: true, skipped: "not_found" }), { status: 200, headers: h });
    }

    if (existing.buyer_type !== "guest") {
      return new Response(JSON.stringify({ ok: true, skipped: "not_guest" }), { status: 200, headers: h });
    }

    if (existing.status !== "pending") {
      return new Response(JSON.stringify({ ok: true, skipped: `status_${existing.status}` }), { status: 200, headers: h });
    }

    const log = Array.isArray(existing.event_log) ? existing.event_log : [];
    await supabase
      .from("payment_attempts")
      .update({
        status: "abandoned",
        updated_at: new Date().toISOString(),
        event_log: [
          ...log,
          {
            type: "abandoned",
            source: "guest_callback",
            reason: "user_cancelled_popup",
            timestamp: new Date().toISOString(),
          },
        ],
      })
      .eq("id", existing.id)
      .eq("status", "pending"); // guard against race with webhook/finalize

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
