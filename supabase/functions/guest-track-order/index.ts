import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { handleTrackRequest } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Guest tracking edge function (orders, AFA registrations, checker purchases).
 *
 * Lookup methods:
 *  1. tracking_token (preferred) → single result
 *  2. reference (short_id like ORD-xxx, AFA-xxx, CHK-xxx, OR a tracking token) → single result
 *  3. buyer_phone → list of recent matches (masked)
 *  4. legacy: short_id + buyer_phone → single result
 *
 * When `store_slug` is supplied, every result is gated against `store_orders`
 * so only orders placed through that store are returned.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { status, body: out } = await handleTrackRequest(supabase, body);
    return new Response(JSON.stringify(out), { status, headers: h });
  } catch (error) {
    console.error("[guest-track-order] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
