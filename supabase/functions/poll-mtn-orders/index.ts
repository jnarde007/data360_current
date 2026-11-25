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
    // Find all MTN orders (Portal-02 or PowerConnect) that are still pending or processing
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, short_id, network, status, provider_name, provider_reference, provider_order_id, customer_id, bundle_size, total_amount, recipient_phone, buyer_phone")
      .in("provider_name", ["Portal-02", "PowerConnect"])
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

    // Fetch Portal-02 config
    const { data: config } = await supabase
      .from("network_api_configs")
      .select("api_key, api_base_url")
      .eq("network", "MTN")
      .maybeSingle();

    const powerConnectKey = Deno.env.get("POWERCONNECT_API_KEY") || "";

    let pollSource = "cron";
    try { const body = await req.clone().json(); if (body?.time === "fast-poll") pollSource = "fast-poll"; } catch (_) {}

    console.log(JSON.stringify({ event: "mtn_poll_start", source: pollSource, order_count: orders.length, timestamp: new Date().toISOString() }));

    let updated = 0;
    let checked = 0;
    const results: any[] = [];

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

    for (const order of orders) {
      checked++;
      try {
        const ref = order.provider_reference;
        let providerStatus = "";
        let data: any = null;

        if (order.provider_name === "PowerConnect") {
          if (!powerConnectKey) {
            results.push({ short_id: order.short_id, ref, error: "POWERCONNECT_API_KEY missing" });
            continue;
          }
          const res = await fetch(`https://powerconnectgh.com/api/v1/order-status/${ref}`, {
            method: "GET",
            headers: {
              "x-api-key": powerConnectKey,
              "Content-Type": "application/json",
            },
          });
          if (!res.ok) {
            results.push({ short_id: order.short_id, ref, error: `PowerConnect HTTP ${res.status}` });
            continue;
          }
          data = await res.json();
          providerStatus = (data.status || data.order?.status || "").toLowerCase();
        } else {
          // Portal-02
          if (!config?.api_key) {
            results.push({ short_id: order.short_id, ref, error: "No Portal-02 config found" });
            continue;
          }
          const res = await fetch(`${config.api_base_url}/order/status/${ref}`, {
            method: "GET",
            headers: {
              "x-api-key": config.api_key,
              "Content-Type": "application/json",
            },
          });
          if (!res.ok) {
            results.push({ short_id: order.short_id, ref, error: `Portal-02 HTTP ${res.status}` });
            continue;
          }
          data = await res.json();
          const orderObj = data.order || data;
          const itemStatus = Array.isArray(orderObj.items) && orderObj.items.length > 0 ? orderObj.items[0].status : null;
          providerStatus = (itemStatus || orderObj.status || data.status || data.state || "").toLowerCase();
        }

        const mappedStatus = statusMap[providerStatus] || "pending";
        const currentLocalStatus = order.status;

        if (mappedStatus === "delivered" && currentLocalStatus !== "delivered") {
          await supabase.from("orders").update({ status: "delivered", provider_response: data }).eq("id", order.id);
          updated++;
          results.push({ short_id: order.short_id, ref, status: "delivered" });

          // Send delivery confirmation email
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
          } catch (_) {}
        } else if (mappedStatus === "failed" && currentLocalStatus !== "failed") {
          await supabase.from("orders").update({ status: "failed", provider_response: data }).eq("id", order.id);
          updated++;
          results.push({ short_id: order.short_id, ref, status: "failed" });
        } else if (mappedStatus === "processing" && currentLocalStatus === "pending") {
          await supabase.from("orders").update({ status: "processing", provider_response: data }).eq("id", order.id);
          updated++;
          results.push({ short_id: order.short_id, ref, status: "processing" });
        } else {
          results.push({ short_id: order.short_id, ref, status: providerStatus, action: "no_change" });
        }

        if (checked < orders.length) await new Promise((r) => setTimeout(r, 100));
      } catch (err: any) {
        results.push({ short_id: order.short_id, ref: order.provider_reference, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({ checked, updated, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
