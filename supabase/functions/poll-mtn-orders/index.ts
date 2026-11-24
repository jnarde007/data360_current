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
    // Find all Portal-02 (MTN) orders that are still pending or processing
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, short_id, network, status, provider_name, provider_reference, provider_order_id, customer_id, bundle_size, total_amount, recipient_phone, buyer_phone")
      .eq("provider_name", "Portal-02")
      .in("status", ["pending", "processing"])
      .not("provider_reference", "eq", "")
      .limit(50);

    if (error) throw error;
    if (!orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ checked: 0, message: "No MTN orders to poll" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch MTN API config
    const { data: config } = await supabase
      .from("network_api_configs")
      .select("api_key, api_base_url")
      .eq("network", "MTN")
      .single();

    if (!config || !config.api_key) {
      return new Response(
        JSON.stringify({ error: "No MTN API config found" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine poll source
    let pollSource = "cron";
    try { const body = await req.clone().json(); if (body?.time === "fast-poll") pollSource = "fast-poll"; } catch (_) {}

    console.log(JSON.stringify({ event: "mtn_poll_start", source: pollSource, order_count: orders.length, timestamp: new Date().toISOString() }));

    let updated = 0;
    let checked = 0;
    const results: any[] = [];

    for (const order of orders) {
      checked++;
      try {
        const ref = order.provider_reference;
        const statusUrl = `${config.api_base_url}/order/status/${ref}`;

        const res = await fetch(statusUrl, {
          method: "GET",
          headers: {
            "x-api-key": config.api_key,
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) {
          const body = await res.text();
          console.error(`MTN status check failed for ${ref}:`, res.status, body);
          results.push({ short_id: order.short_id, ref, error: `HTTP ${res.status}` });
          continue;
        }

        const data = await res.json();
        const currentLocalStatus = order.status;

        // Portal-02 status response: { success, order: { status, items, ... }, authMethod }
        const orderObj = data.order || data;
        const itemStatus = Array.isArray(orderObj.items) && orderObj.items.length > 0 ? orderObj.items[0].status : null;
        const providerStatus = (itemStatus || orderObj.status || data.status || data.state || "").toLowerCase();

        console.log(JSON.stringify({ event: "mtn_poll_check", source: pollSource, short_id: order.short_id, order_id: order.id, ref, local_status: currentLocalStatus, provider_status: providerStatus, order_status: orderObj.status, item_status: itemStatus, timestamp: new Date().toISOString() }));

        const statusMap: Record<string, string> = {
          pending: "pending",
          queued: "pending",
          processing: "processing",
          completed: "delivered",
          delivered: "delivered",
          success: "delivered",
          failed: "failed",
          cancelled: "failed",
          refunded: "refunded",
          refund: "refunded",
          reversed: "refunded",
        };

        const mappedStatus = statusMap[providerStatus];

        if (mappedStatus === "refunded") {
          // Portal-02 auto-refunded this order → refund our customer.
          await supabase
            .from("orders")
            .update({ provider_response: data })
            .eq("id", order.id);

          const { data: refundRes, error: refundErr } = await supabase.functions.invoke(
            "process-order-refund",
            {
              body: {
                order_id: order.id,
                provider_reference: ref,
                provider_name: "Portal-02",
                reason: "Portal-02 confirmed refund",
              },
            },
          );

          updated++;
          results.push({ short_id: order.short_id, ref, status: "refunded", refund: refundRes ?? refundErr });
          console.log(JSON.stringify({ event: "mtn_provider_refund", short_id: order.short_id, order_id: order.id, ref, from: currentLocalStatus, source: pollSource, refund: refundRes ?? String(refundErr), timestamp: new Date().toISOString() }));

        } else if (mappedStatus === "delivered") {
          await supabase
            .from("orders")
            .update({ status: "delivered", provider_response: data })
            .eq("id", order.id);

          updated++;
          results.push({ short_id: order.short_id, ref, status: "delivered" });
          console.log(JSON.stringify({ event: "mtn_status_transition", short_id: order.short_id, order_id: order.id, ref, from: currentLocalStatus, to: "delivered", source: pollSource, timestamp: new Date().toISOString() }));

          // Trigger delivery email
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                template: "order-delivered",
                customer_id: order.customer_id,
                data: {
                  short_id: order.short_id,
                  recipient_phone: order.recipient_phone,
                  network: order.network,
                  bundle_size: order.bundle_size,
                  total_amount: order.total_amount,
                },
              }),
            });
          } catch (emailErr) {
            console.error(`Failed to send delivery email for ${order.short_id}:`, emailErr);
          }

          // Delivered SMS removed — business decision: no SMS on delivery

        } else if (mappedStatus === "failed") {
          await supabase
            .from("orders")
            .update({ status: "failed", provider_response: data })
            .eq("id", order.id);

          updated++;
          results.push({ short_id: order.short_id, ref, status: "failed" });
          console.log(JSON.stringify({ event: "mtn_status_transition", short_id: order.short_id, order_id: order.id, ref, from: currentLocalStatus, to: "failed", source: pollSource, timestamp: new Date().toISOString() }));

        } else if (mappedStatus === "processing" && currentLocalStatus === "pending") {
          await supabase
            .from("orders")
            .update({ status: "processing", provider_response: data })
            .eq("id", order.id);

          updated++;
          results.push({ short_id: order.short_id, ref, status: "processing" });
          console.log(JSON.stringify({ event: "mtn_status_transition", short_id: order.short_id, order_id: order.id, ref, from: "pending", to: "processing", source: pollSource, timestamp: new Date().toISOString() }));

        } else {
          results.push({ short_id: order.short_id, ref, status: providerStatus, action: "no_change" });
        }

        // Small delay between API calls
        if (checked < orders.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (orderErr) {
        console.error(`Error polling MTN order ${order.short_id}:`, orderErr);
        results.push({ short_id: order.short_id, error: String(orderErr) });
      }
    }

    console.log(`MTN poller: checked ${checked}, updated ${updated}`);

    return new Response(
      JSON.stringify({ checked, updated, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("poll-mtn-orders error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
