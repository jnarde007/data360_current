import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Centralised AFA status transitions for "registered" and "rejected".
 *
 *  - registered: marks AFA registered + sends SMS to the buyer (idempotent).
 *  - rejected:   marks AFA rejected + refunds (wallet for registered users,
 *                Paystack for guests). Reuses the `refunds` table for
 *                idempotency via (order_id = afa.id, refund_amount).
 *
 * Body: { registration_id, new_status: 'registered'|'rejected', admin_note?, refund_reason? }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const { registration_id, new_status, admin_note, refund_reason } = await req.json();
    if (!registration_id || !["registered", "rejected"].includes(new_status)) {
      return new Response(JSON.stringify({ error: "Missing or invalid params" }), { status: 400, headers: h });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: afa, error: afaErr } = await supabase
      .from("afa_registrations").select("*").eq("id", registration_id).maybeSingle();
    if (afaErr || !afa) {
      return new Response(JSON.stringify({ error: "Registration not found" }), { status: 404, headers: h });
    }

    // Lock final statuses — prevent any further changes (incl. duplicate refund/SMS).
    if (afa.status === "registered" || afa.status === "rejected") {
      return new Response(
        JSON.stringify({ error: "This AFA registration is already finalized and cannot be changed." }),
        { status: 409, headers: h },
      );
    }

    // ────────── REGISTERED ──────────
    if (new_status === "registered") {
      const { error: updErr } = await supabase
        .from("afa_registrations")
        .update({ status: "registered", admin_note: admin_note ?? afa.admin_note, processed_at: new Date().toISOString() })
        .eq("id", registration_id);
      if (updErr) throw updErr;

      // Send SMS to the buyer's contact phone (registered or guest).
      const buyerPhone = afa.buyer_phone && afa.buyer_phone.length >= 9
        ? afa.buyer_phone
        : await resolveCustomerPhone(supabase, afa.customer_id);

      if (buyerPhone) {
        const regPhone = afa.registration_phone || "";
        const masked = regPhone.length >= 6 ? regPhone.slice(0, 4) + "****" + regPhone.slice(-2) : regPhone;
        const smsRef = shortRef(afa);
        const message = `Your registration for ${masked} is complete. Reference: ${smsRef}. Kasa saaaaa!`;

        supabase.functions.invoke("send-sms", {
          body: {
            to: buyerPhone,
            message,
            event_type: "afa_registered",
            customer_id: afa.customer_id || null,
            idempotency_key: `afa_registered_${registration_id}`,
          },
        }).catch((e: any) => console.error("[process-afa-status] SMS error:", e));
      }

      return new Response(JSON.stringify({ success: true, message: "Registered + SMS dispatched" }), { status: 200, headers: h });
    }

    // ────────── REJECTED (with refund) ──────────
    const isGuest = afa.buyer_type === "guest";
    const refundAmount = Number(afa.total_amount || 0);

    // Idempotency: refunds table unique (afa_registration_id) where status != refund_failed.
    const { data: existingRefund } = await supabase
      .from("refunds")
      .select("id, status")
      .eq("afa_registration_id", registration_id)
      .neq("status", "refund_failed")
      .maybeSingle();

    if (existingRefund) {
      await supabase.from("afa_registrations")
        .update({ status: "rejected", admin_note: admin_note ?? afa.admin_note, processed_at: new Date().toISOString() })
        .eq("id", registration_id);
      return new Response(JSON.stringify({
        success: true, message: "Rejected (refund already processed)", refund_status: existingRefund.status,
      }), { status: 200, headers: h });
    }

    // Legacy guard for registered users: skip if a wallet credit with the same ref already exists.
    if (!isGuest && afa.customer_id) {
      const refundRef = `REF-${afa.short_id}`;
      const { data: legacy } = await supabase
        .from("wallet_transactions")
        .select("id").eq("reference", refundRef).eq("type", "credit").maybeSingle();
      if (legacy) {
        await supabase.from("afa_registrations")
          .update({ status: "rejected", admin_note: admin_note ?? afa.admin_note, processed_at: new Date().toISOString() })
          .eq("id", registration_id);
        return new Response(JSON.stringify({ success: true, message: "Rejected (wallet refund already issued)" }), { status: 200, headers: h });
      }
    }

    // Resolve Paystack reference for guest refunds.
    let paystackTxId = "";
    let paystackRef = isGuest ? (afa.payment_reference || "") : "";

    // Create refund record up-front (locks idempotency).
    const { data: refundRow, error: refundInsertErr } = await supabase
      .from("refunds")
      .insert({
        order_id: null,
        afa_registration_id: registration_id,
        customer_id: afa.customer_id || null,
        buyer_type: isGuest ? "guest" : "registered",
        refund_method: isGuest ? "paystack" : "wallet",
        refund_amount: refundAmount,
        amount_paid: refundAmount,
        data_value: refundAmount,
        paystack_transaction_id: paystackTxId,
        paystack_reference: paystackRef,
        status: "refund_pending",
        refund_reason: refund_reason || "AFA registration rejected by admin",
        initiated_by: "admin",
        is_full_override: false,
        total_refunded: 0,
      })
      .select("id").single();

    if (refundInsertErr) {
      // Race: another reject created the refund first — treat as already handled.
      if ((refundInsertErr as any).code === "23505") {
        await supabase.from("afa_registrations")
          .update({ status: "rejected", admin_note: admin_note ?? afa.admin_note, processed_at: new Date().toISOString() })
          .eq("id", registration_id);
        return new Response(JSON.stringify({ success: true, message: "Rejected (refund already in progress)" }), { status: 200, headers: h });
      }
      throw refundInsertErr;
    }

    if (isGuest) {
      await processPaystackRefund(supabase, refundRow!.id, paystackRef, refundAmount, registration_id, afa.short_id);
      // Re-read refund status to determine copy + whether to send.
      const { data: r } = await supabase
        .from("refunds").select("status").eq("id", refundRow!.id).maybeSingle();
      const finalStatus = r?.status || "refund_pending";
      if (afa.buyer_phone && finalStatus !== "refund_failed") {
        const smsRef = shortRef(afa);
        const message = finalStatus === "refunded"
          ? `Your registration could not be completed. Your payment has been refunded. Reference: ${smsRef}.`
          : `Your registration could not be completed. Your refund has been initiated. Reference: ${smsRef}.`;
        try {
          await supabase.functions.invoke("send-sms", {
            body: {
              to: afa.buyer_phone,
              message,
              event_type: "refund_successful",
              idempotency_key: `afa_refund_guest_${registration_id}`,
            },
          });
        } catch (e: any) {
          console.error("[process-afa-status] guest refund SMS error:", e);
        }
      } else if (!afa.buyer_phone) {
        console.warn(`[process-afa-status] AFA ${afa.short_id}: no buyer_phone, skipping guest refund SMS`);
      }
    } else {
      await processWalletRefund(supabase, refundRow!.id, afa, refundAmount);
      // SMS to registered buyer (wallet refund is immediate -> always "refunded")
      if (afa.customer_id) {
        const phone = await resolveCustomerPhone(supabase, afa.customer_id);
        if (phone) {
          try {
            await supabase.functions.invoke("send-sms", {
              body: {
                to: phone,
                message: `Your registration could not be completed. Your payment has been refunded. Reference: ${shortRef(afa)}.`,
                event_type: "refund_successful",
                customer_id: afa.customer_id,
                idempotency_key: `afa_refund_wallet_${registration_id}`,
              },
            });
          } catch (e: any) {
            console.error("[process-afa-status] wallet refund SMS error:", e);
          }
        } else {
          console.warn(`[process-afa-status] AFA ${afa.short_id}: customer ${afa.customer_id} has no phone on file`);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: isGuest ? "Rejected and Paystack refund initiated" : "Rejected and wallet refunded",
      refund_method: isGuest ? "paystack" : "wallet",
    }), { status: 200, headers: h });
  } catch (e) {
    console.error("[process-afa-status] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});

function shortRef(afa: any): string {
  // Reference shown to customers — identical to the system short_id (e.g. 7A3F9C2B).
  if (afa?.short_id) return afa.short_id;
  return (afa?.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function resolveCustomerPhone(supabase: any, customerId: string | null): Promise<string> {
  if (!customerId) return "";
  const { data } = await supabase.from("customers").select("phone").eq("id", customerId).maybeSingle();
  return data?.phone || "";
}

async function processPaystackRefund(
  supabase: any, refundId: string, paystackRef: string, refundAmount: number,
  registrationId: string, shortId: string,
) {
  const { data: settingRow } = await supabase
    .from("platform_settings").select("value").eq("key", "paystack_secret_key").single();
  const secret = settingRow?.value;
  if (!secret) {
    await supabase.from("refunds").update({
      status: "refund_failed", error_message: "Paystack secret key not configured",
    }).eq("id", refundId);
    await supabase.from("afa_registrations").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", registrationId);
    throw new Error("Paystack secret key not configured");
  }

  // Resolve transaction id from reference.
  let txId = "";
  if (paystackRef) {
    const v = await fetch(`https://api.paystack.co/transaction/verify/${paystackRef}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const vd = await v.json();
    if (v.ok && vd.data?.id) {
      txId = String(vd.data.id);
      await supabase.from("refunds").update({ paystack_transaction_id: txId }).eq("id", refundId);
    }
  }

  if (!txId) {
    await supabase.from("refunds").update({
      status: "refund_failed",
      error_message: "No Paystack transaction id found for AFA refund",
    }).eq("id", refundId);
    await supabase.from("afa_registrations").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", registrationId);
    return;
  }

  const refundBody = { transaction: txId, amount: Math.round(refundAmount * 100) };
  try {
    const res = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(refundBody),
    });
    const data = await res.json();

    if (!res.ok || !data.status) {
      await supabase.from("refunds").update({
        status: "refund_failed",
        paystack_response: data,
        error_message: data.message || "Paystack refund API error",
      }).eq("id", refundId);
      await supabase.from("afa_registrations").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", registrationId);
      return;
    }

    const paystackRefundId = data.data?.id ? String(data.data.id) : "";
    const refundStatus = data.data?.status === "processed" ? "refunded" : "refund_pending";

    await supabase.from("refunds").update({
      status: refundStatus,
      paystack_refund_id: paystackRefundId,
      paystack_response: data,
      total_refunded: refundAmount,
      error_message: "",
    }).eq("id", refundId);

    await supabase.from("afa_registrations").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", registrationId);
    console.log(`[process-afa-status] AFA ${shortId} rejected, Paystack refund ${refundStatus} (${paystackRefundId})`);
  } catch (err) {
    await supabase.from("refunds").update({
      status: "refund_failed",
      error_message: err instanceof Error ? err.message : "Network error calling Paystack",
    }).eq("id", refundId);
    await supabase.from("afa_registrations").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", registrationId);
  }
}

async function processWalletRefund(supabase: any, refundId: string, afa: any, refundAmount: number) {
  await supabase.from("afa_registrations").update({ status: "rejected", processed_at: new Date().toISOString() }).eq("id", afa.id);

  if (!afa.customer_id) {
    await supabase.from("refunds").update({
      status: "refunded", total_refunded: 0,
      error_message: "No customer_id — no wallet to refund",
    }).eq("id", refundId);
    return;
  }

  const { data: cust, error: custErr } = await supabase
    .from("customers").select("wallet_balance").eq("id", afa.customer_id).single();
  if (custErr || !cust) throw new Error("Customer not found for AFA refund");

  const newBalance = Number(cust.wallet_balance) + refundAmount;
  await supabase.from("customers").update({ wallet_balance: newBalance }).eq("id", afa.customer_id);

  const refundRef = `REF-${afa.short_id}`;
  await supabase.from("wallet_transactions").insert({
    customer_id: afa.customer_id,
    type: "credit",
    amount: refundAmount,
    description: `Refund - AFA registration rejected (${afa.short_id})`,
    reference: refundRef,
  });

  await supabase.from("refunds").update({
    status: "refunded",
    total_refunded: refundAmount,
  }).eq("id", refundId);

  console.log(`[process-afa-status] AFA ${afa.short_id} rejected, wallet refund ${refundAmount} -> customer ${afa.customer_id}`);
}
