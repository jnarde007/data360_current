import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload = await req.json();
    console.log("Webhook received:", JSON.stringify(payload));

    const { event, orderId, localOrderId, reference, status, recipient, volume, timestamp, previousStatus } = payload;

    // Find local order: try localOrderId (direct PK), then provider_reference, then provider_order_id
    let order: any = null;

    if (localOrderId) {
      const { data } = await supabase.from("orders").select("*").eq("id", localOrderId).maybeSingle();
      order = data;
      console.log(`Lookup by localOrderId=${localOrderId}: ${order ? "found" : "not found"}`);
    }

    if (!order && reference) {
      const { data } = await supabase.from("orders").select("*").eq("provider_reference", reference).maybeSingle();
      order = data;
      console.log(`Lookup by provider_reference=${reference}: ${order ? "found" : "not found"}`);
    }

    if (!order && orderId) {
      const { data } = await supabase.from("orders").select("*").eq("provider_order_id", orderId).maybeSingle();
      order = data;
      console.log(`Lookup by provider_order_id=${orderId}: ${order ? "found" : "not found"}`);
    }

    // Final fallback: orderId might be a local UUID
    if (!order && orderId) {
      const { data } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
      order = data;
      console.log(`Lookup by id=${orderId}: ${order ? "found" : "not found"}`);
    }

    if (!order) {
      console.log("No matching order found for payload:", JSON.stringify({ localOrderId, reference, orderId }));
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map provider status to local status
    const statusMap: Record<string, string> = {
      pending: "pending",
      processing: "processing",
      completed: "delivered",
      delivered: "delivered",
      success: "delivered",
      failed: "failed",
      cancelled: "failed",
      refunded: "rejected",
      resolved: "delivered",
    };

    const localStatus = statusMap[(status || event || "").toLowerCase()] || order.status;

    // For transition checks: use previousStatus from payload if provided (admin pre-updates the DB),
    // otherwise fall back to the order's current DB status.
    const priorStatus = previousStatus || order.status;

    // Append to webhook history
    const existingHistory = Array.isArray(order.webhook_history) ? order.webhook_history : [];
    const webhookEntry = {
      event,
      status,
      reference,
      orderId,
      localOrderId,
      recipient,
      volume,
      timestamp: timestamp || new Date().toISOString(),
      received_at: new Date().toISOString(),
    };

    await supabase
      .from("orders")
      .update({
        status: localStatus,
        webhook_history: [...existingHistory, webhookEntry],
      })
      .eq("id", order.id);

    // Send delivery confirmation email when status transitions to delivered
    if (localStatus === "delivered" && priorStatus !== "delivered" && order.customer_id) {
      supabase.functions.invoke("send-transactional-email", {
        body: {
          template: "order-delivered",
          customer_id: order.customer_id,
          data: {
            recipient_phone: order.recipient_phone,
            network: order.network,
            bundle_size: order.bundle_size,
            total_amount: order.total_amount,
            short_id: order.short_id,
          },
        },
      }).catch((e: any) => console.error("Delivery email error:", e));
    }

    // Delivered SMS removed — business decision: no SMS on delivery

    // Provider-confirmed refund / rejection → unified automatic refund pipeline.
    // process-order-refund owns idempotency, destination routing (wallet vs
    // Paystack vs MoMo fallback), the refunds ledger and buyer SMS.
    const rawStatus = (status || event || "").toLowerCase();
    const providerRefunded = ["refunded", "refund", "reversed"].includes(rawStatus);
    if (localStatus === "rejected" && priorStatus !== "rejected") {
      try {
        const refundRes = await supabase.functions.invoke("process-order-refund", {
          body: {
            order_id: order.id,
            provider_reference: reference || order.provider_reference || "",
            provider_name: order.provider_name || "Portal-02",
            reason: providerRefunded
              ? "Provider confirmed refund"
              : `Provider marked order ${rawStatus || "rejected"}`,
          },
        });
        console.log(`Refund pipeline result for ${order.short_id}:`, JSON.stringify(refundRes.data ?? refundRes.error));
      } catch (e) {
        console.error("Refund pipeline invocation failed:", e);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
