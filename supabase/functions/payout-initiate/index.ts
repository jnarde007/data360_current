// payout-initiate: admin-only. Given an approved payout, create the Paystack
// transfer recipient (or reuse cached) and initiate a transfer. Marks the
// payout as 'processing' on accept, 'failed' on Paystack reject (releasing the
// lock back to available balance via apply_payout_failure).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { getPaystackSecret, ensureRecipient, initiateTransfer } from "../_shared/paystack-transfer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: h });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await userClient.auth.getClaims(token);
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: h });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Confirm caller is admin
    const { data: isAdminData } = await admin.rpc("has_role", {
      _user_id: claims.claims.sub,
      _role: "admin",
    });
    // Fallback: check admin_users
    let isAdmin = !!isAdminData;
    if (!isAdmin) {
      const { data: adminRow } = await admin.from("admin_users").select("id").eq("id", claims.claims.sub).maybeSingle();
      isAdmin = !!adminRow;
    }
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: h });
    }

    const { payout_id } = await req.json();
    if (!payout_id) {
      return new Response(JSON.stringify({ error: "Missing payout_id" }), { status: 400, headers: h });
    }

    const { data: payout, error: payoutErr } = await admin
      .from("payouts")
      .select("*")
      .eq("id", payout_id)
      .single();
    if (payoutErr || !payout) {
      return new Response(JSON.stringify({ error: "Payout not found" }), { status: 404, headers: h });
    }
    if (payout.status !== "approved") {
      return new Response(JSON.stringify({ error: `Payout must be approved (current: ${payout.status})` }), { status: 400, headers: h });
    }
    if (payout.rail !== "paystack") {
      return new Response(JSON.stringify({ error: "Payout rail is not paystack" }), { status: 400, headers: h });
    }

    const secret = await getPaystackSecret(admin);

    // 1. Recipient
    let recipientCode: string;
    try {
      const r = await ensureRecipient({
        supabase: admin,
        secret,
        customerId: payout.owner_id,
        network: payout.network,
        momoNumber: payout.momo_number,
        momoName: payout.momo_name,
      });
      recipientCode = r.recipient_code;
    } catch (e: any) {
      console.error("[payout-initiate] recipient error:", e.message);
      await admin.rpc("apply_payout_failure", {
        p_payout_id: payout.id,
        p_new_status: "failed",
        p_reason: `Recipient creation failed: ${e.message}`,
        p_response: { error: e.message },
      });
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: h });
    }

    // 2. Initiate transfer with idempotent reference
    const reference = `PT-${payout.id.replace(/-/g, "").slice(0, 16)}-${Date.now()}`;
    const t = await initiateTransfer({
      secret,
      recipientCode,
      amountGHS: Number(payout.net_amount),
      reference,
      reason: payout.payout_type === "affiliate"
        ? `Affiliate commission payout ${payout.short_id}`
        : `Store commission payout ${payout.short_id}`,
    });

    if (!t.ok) {
      console.error("[payout-initiate] transfer failed:", t.error);
      await admin.rpc("apply_payout_failure", {
        p_payout_id: payout.id,
        p_new_status: "failed",
        p_reason: t.error || "Transfer initiation failed",
        p_response: t.data || {},
      });
      return new Response(JSON.stringify({ error: t.error, data: t.data }), { status: 502, headers: h });
    }

    // 3. Mark processing. Paystack returns status='success' instantly only for
    //    OTP-disabled accounts that complete same-cycle; the webhook is still
    //    the source of truth. We mark 'processing' here regardless and let the
    //    webhook (or reconcile cron) finalize.
    const transferCode = t.data?.transfer_code || "";
    await admin.rpc("mark_payout_processing", {
      p_payout_id: payout.id,
      p_recipient_code: recipientCode,
      p_transfer_code: transferCode,
      p_transfer_reference: reference,
      p_response: t.data,
    });

    // If Paystack already returned a terminal status, apply it now (OTP-disabled flow)
    const paystackStatus = (t.data?.status || "").toLowerCase();
    if (paystackStatus === "success") {
      await admin.rpc("apply_payout_success", { p_payout_id: payout.id, p_response: t.data });
    } else if (paystackStatus === "failed" || paystackStatus === "reversed") {
      await admin.rpc("apply_payout_failure", {
        p_payout_id: payout.id,
        p_new_status: paystackStatus,
        p_reason: t.data?.reason || "",
        p_response: t.data,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      payout_id: payout.id,
      transfer_code: transferCode,
      reference,
      paystack_status: paystackStatus,
    }), { status: 200, headers: h });
  } catch (e) {
    console.error("[payout-initiate] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
