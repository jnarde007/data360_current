import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveIgetConfig } from "../_shared/iget-config.ts";

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
    // Find all iGet orders that are still pending or processing
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, short_id, network, status, provider_name, provider_reference, provider_order_id, customer_id, bundle_size, total_amount, recipient_phone, buyer_phone")
      .eq("provider_name", "iGet")
      .in("status", ["pending", "processing"])
      .not("provider_reference", "eq", "")
      .limit(50);

    if (error) throw error;
    if (!orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ checked: 0, message: "No iGet orders to poll" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch iGet API configs for all networks that use iGet
    const igetNetworks = [...new Set(orders.map((o) => o.network))];
    const { data: configs } = await supabase
      .from("network_api_configs")
      .select("network, api_key, api_base_url")
      .in("network", [...new Set([...igetNetworks, "Telecel", "AirtelTigo"])]);

    const configMap: Record<string, { api_key: string; api_base_url: string }> = {};
    for (const network of igetNetworks) {
      const config = resolveIgetConfig(network, configs || [], Deno.env.get("IGET_API_KEY") || "");
      if (config.api_key && config.api_base_url) configMap[network] = config;
    }

    if (Object.keys(configMap).length === 0) {
      return new Response(
        JSON.stringify({ error: "No iGet API configs found for networks: " + igetNetworks.join(", ") }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine poll source
    let pollSource = "cron";
    try { const body = await req.clone().json(); if (body?.time === "fast-poll") pollSource = "fast-poll"; } catch (_) {}

    console.log(JSON.stringify({ event: "iget_poll_start", source: pollSource, order_count: orders.length, networks: igetNetworks, timestamp: new Date().toISOString() }));

    let updated = 0;
    let checked = 0;
    const results: any[] = [];

    for (const order of orders) {
      checked++;
      try {
        const config = configMap[order.network];
        if (!config) {
          results.push({ short_id: order.short_id, ref: order.provider_reference, error: `No config for network ${order.network}` });
          continue;
        }
        const ref = order.provider_reference;
        const statusUrl = `${config.api_base_url}/api/developer/orders/reference/${ref}`;

        const res = await fetch(statusUrl, {
          method: "GET",
          headers: { "X-API-Key": config.api_key },
        });

        if (!res.ok) {
          const body = await res.text();
          console.error(`iGet status check failed for ${ref}:`, res.status, body);
          results.push({ short_id: order.short_id, ref, error: `HTTP ${res.status}` });
          continue;
        }

        const data = await res.json();
        const igetOrder = data?.data?.order;

        if (!igetOrder) {
          results.push({ short_id: order.short_id, ref, error: "No order data in response" });
          continue;
        }

        const igetStatus = igetOrder.status;
        const currentLocalStatus = order.status;

        console.log(JSON.stringify({ event: "iget_poll_check", source: pollSource, short_id: order.short_id, order_id: order.id, network: order.network, ref, local_status: currentLocalStatus, provider_status: igetStatus, timestamp: new Date().toISOString() }));

        if (igetStatus === "completed") {
          const t0 = Date.now();
          // Mark as delivered
          await supabase
            .from("orders")
            .update({
              status: "delivered",
              provider_response: data.data,
            })
            .eq("id", order.id);
          const dbMs = Date.now() - t0;

          updated++;
          results.push({ short_id: order.short_id, ref, status: "delivered" });
          console.log(JSON.stringify({ event: "iget_status_transition", short_id: order.short_id, order_id: order.id, network: order.network, ref, from: currentLocalStatus, to: "delivered", db_update_ms: dbMs, source: pollSource, timestamp: new Date().toISOString() }));

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

        } else if (igetStatus === "failed") {
          const t0 = Date.now();
          // Mark as failed with reason
          await supabase
            .from("orders")
            .update({
              status: "failed",
              provider_response: {
                ...data.data,
                failure_reason: igetOrder.failureReason || "Unknown failure",
              },
            })
            .eq("id", order.id);
          const dbMs = Date.now() - t0;

          updated++;
          results.push({ short_id: order.short_id, ref, status: "failed", reason: igetOrder.failureReason });
          console.log(JSON.stringify({ event: "iget_status_transition", short_id: order.short_id, order_id: order.id, network: order.network, ref, from: currentLocalStatus, to: "failed", reason: igetOrder.failureReason || "Unknown", db_update_ms: dbMs, source: pollSource, timestamp: new Date().toISOString() }));

        } else if (igetStatus === "processing" && currentLocalStatus === "pending") {
          // Provider moved to processing — update local status to match
          await supabase
            .from("orders")
            .update({ status: "processing", provider_response: data.data })
            .eq("id", order.id);
          updated++;
          results.push({ short_id: order.short_id, ref, status: "processing" });
          console.log(JSON.stringify({ event: "iget_status_transition", short_id: order.short_id, order_id: order.id, network: order.network, ref, from: "pending", to: "processing", source: pollSource, timestamp: new Date().toISOString() }));

        } else {
          // Still pending/processing — no update needed
          results.push({ short_id: order.short_id, ref, status: igetStatus, action: "no_change" });
        }

        // Small delay between API calls to avoid rate limiting
        if (checked < orders.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (orderErr) {
        console.error(`Error polling order ${order.short_id}:`, orderErr);
        results.push({ short_id: order.short_id, error: String(orderErr) });
      }
    }

    console.log(`iGet poller: checked ${checked}, updated ${updated}`);

    return new Response(
      JSON.stringify({ checked, updated, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("poll-iget-orders error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
