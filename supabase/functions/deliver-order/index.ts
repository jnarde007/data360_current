import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { resolveMtnProvider, mustHoldMtnSubmission, validateMtnIgetPurchase, capacitiesFromCatalog } from "../_shared/mtn-provider-policy.ts";
import { resolveIgetConfig } from "../_shared/iget-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeGhanaPhone(phone: string): string {
  const cleaned = phone.replace(/\s+/g, "").replace(/^0/, "233");
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  return cleaned;
}

function parseVolume(bundleSize: string): number | null {
  const match = bundleSize.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const reqBody = await req.json();
    const { order_id } = reqBody;
    if (!order_id) {
      return new Response(JSON.stringify({ error: "Missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atomic claim: only proceed if order is in a claimable status.
    // This prevents duplicate API submissions when cron and manual trigger race.
    const claimableStatuses = ["pending_confirmation", "pending"];
    const terminalStatuses = ["rejected", "refunded", "customer_cancelled", "cancelled_before_processing"];

    // Attempt atomic claim by updating status to a transient 'submitting' state.
    // CRITICAL: only claim orders that have NOT already been handed to a provider
    // (provider_reference must be null/empty). Without this guard, a second
    // invocation can re-claim an order whose first submission already succeeded,
    // re-submit it, hit DUPLICATE_ORDER, and trigger a wrongful auto-refund while
    // the provider still fulfils the original submission.
    const { data: claimed, error: claimError } = await supabase
      .from("orders")
      .update({ status: "submitting" })
      .eq("id", order_id)
      .in("status", claimableStatuses)
      .or("provider_reference.is.null,provider_reference.eq.")
      .select("*");


    if (claimError) throw claimError;

    if (!claimed || claimed.length === 0) {
      // Order wasn't claimable — check why
      const { data: existing } = await supabase
        .from("orders")
        .select("status, provider_reference")
        .eq("id", order_id)
        .single();

      if (existing && existing.provider_reference) {
        // Already submitted to provider on a previous call — do NOT resubmit.
        console.log(JSON.stringify({
          event: "deliver_order_skipped_already_submitted",
          order_id, current_status: existing.status,
          provider_reference: existing.provider_reference,
        }));
        return new Response(
          JSON.stringify({ success: true, skipped: true, message: "Order already submitted to provider" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }


      if (!existing) {
        return new Response(JSON.stringify({ error: "Order not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (terminalStatuses.includes(existing.status)) {
        return new Response(
          JSON.stringify({ error: `Order is in terminal status '${existing.status}' and cannot be processed` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Already being processed by another call (submitting, processing, delivered, etc.)
      console.log(JSON.stringify({ event: "deliver_order_skipped_already_claimed", order_id, current_status: existing.status }));
      return new Response(
        JSON.stringify({ success: true, skipped: true, message: `Order already in '${existing.status}' status` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const order = claimed[0];

    // MTN orders must not be purchased again if a prior submission may exist.
    // Mark for admin investigation — never auto-reroute to the other provider
    // or create a manual duplicate.
    if (order.network === 'MTN' && mustHoldMtnSubmission(order)) {
      await supabase.from('orders').update({
        status: 'failed',
        provider_response: { error: 'SUBMISSION_UNCERTAIN', detail: 'A provider submission may already exist; admin reconciliation required before any retry.' },
      }).eq('id', order_id);
      return new Response(JSON.stringify({ success: true, skipped: true, message: 'MTN submission requires provider reconciliation before any retry' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Defense-in-depth: a real customer order must be backed by either a verified
    // Paystack payment OR a wallet debit transaction. This blocks any synthetic /
    // diagnostic row from ever reaching a provider API. Customer flow already
    // satisfies this — finalize-payment sets payment_verified_at, and
    // place_order (wallet) writes a wallet_transactions debit before insert.
    {
      const isWallet = (order.payment_method || "").toLowerCase() === "wallet";
      const hasPaystackProof = !!order.payment_verified_at;
      let paymentProven = isWallet || hasPaystackProof;

      if (isWallet) {
        const { data: tx } = await supabase
          .from("wallet_transactions")
          .select("id")
          .eq("reference", order.short_id)
          .eq("type", "debit")
          .limit(1);
        paymentProven = !!(tx && tx.length > 0);
      }

      if (!paymentProven) {
        await supabase
          .from("orders")
          .update({ status: "rejected", provider_response: { error: "payment_not_verified_guard" } })
          .eq("id", order_id);
        await supabase.from("provider_call_attempts").insert({
          kind: "blocked",
          provider: "unknown",
          endpoint: "deliver-order",
          outcome: "denied",
          blocked_reason: "payment_not_verified",
          source: "deliver-order",
          payload_summary: { order_id, short_id: order.short_id, payment_method: order.payment_method },
        });
        return new Response(
          JSON.stringify({ error: "Real orders are disabled without verified payment. Admin approval is required." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch network config
    const { data: config } = await supabase
      .from("network_api_configs")
      .select("*")
      .eq("network", order.network)
      .single();

    // Defense-in-depth: route to manual if API is disabled OR network is no longer
    // available for purchase. New orders can't be created when available_for_purchase=false
    // (RPC blocks them), but a toggle flip after order creation must never push the order
    // to a provider API.
    // MTN orders pinned to iGet/Portal-02 at creation are governed by the
    // MTN provider toggles (snapshotted on the order), not the legacy
    // network_api_configs.enabled flag. Pinned Manual / legacy unpinned
    // MTN orders still follow the legacy flag.
    // Admin "Send to API" on an MTN order pinned to Manual (created while both
    // MTN API toggles were OFF): re-pin to the currently enabled provider.
    // Only for never-submitted orders; the DB trigger enforces the same rule.
    if (order.network === 'MTN' && order.provider_name === 'Manual' && reqBody?.admin_send === true) {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: authData } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
      const uid = authData?.user?.id;
      const { data: adminRow } = uid
        ? await supabase.from('admin_users').select('id').eq('auth_user_id', uid).eq('status', 'active').maybeSingle()
        : { data: null };
      const { data: mtnSettings } = await supabase.from('mtn_provider_settings').select('*').eq('singleton', true).maybeSingle();
      const active = mtnSettings?.portal02_api_enabled ? 'Portal-02' : mtnSettings?.iget_api_enabled ? 'iGet' : null;
      if (adminRow && active && !mustHoldMtnSubmission(order)) {
        const bundleType = active === 'iGet' ? (mtnSettings?.iget_bundle_type || 'mtnup2u') : null;
        const { error: repinErr } = await supabase.from('orders')
          .update({ provider_name: active, provider_bundle_type: bundleType })
          .eq('id', order_id).eq('provider_name', 'Manual');
        if (!repinErr) {
          order.provider_name = active;
          order.provider_bundle_type = bundleType;
          console.log(JSON.stringify({ event: 'mtn_manual_repinned', order_id, short_id: order.short_id, provider: active, admin_id: adminRow.id }));
        } else {
          console.error('mtn repin failed', repinErr.message);
        }
      }
    }

    const mtnPinnedApi = order.network === 'MTN'
      && (order.provider_name === 'iGet' || order.provider_name === 'Portal-02')
      && !!order.provider_routing_version;
    const mtnPinnedManual = order.network === 'MTN' && order.provider_name === 'Manual';
    const apiDisabled = !config || mtnPinnedManual || (!mtnPinnedApi && !config.enabled);
    const networkUnavailable = !!config && config.available_for_purchase === false;
    if (apiDisabled || networkUnavailable) {
      await supabase
        .from("orders")
        .update({ delivery_mode: "manual", status: "pending" })
        .eq("id", order_id);

      console.log(JSON.stringify({
        event: "deliver_order_routed_manual",
        reason: networkUnavailable ? "network_unavailable_for_purchase" : "api_toggle_off",
        order_id, short_id: order.short_id, network: order.network,
        timestamp: new Date().toISOString(),
      }));

      return new Response(
        JSON.stringify({
          success: true,
          mode: "manual",
          message: networkUnavailable
            ? "Network unavailable for purchase, order routed to manual review"
            : "Network API not enabled, order is manual",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // API delivery
    const volume = parseVolume(order.bundle_size);
    if (!volume) {
      await supabase
        .from("orders")
        .update({ status: "failed", provider_response: { error: "Invalid bundle size" } })
        .eq("id", order_id);
      return new Response(JSON.stringify({ error: "Invalid bundle size" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extraParams = typeof config.extra_params === "object" ? config.extra_params : {};
    const providerName = order.network === 'MTN'
      ? resolveMtnProvider(order)
      : (extraParams as Record<string, string>).provider || "Portal-02";

    // MTN orders pinned to Manual (both provider toggles OFF at creation)
    // follow the existing manual workflow — no external API request.
    if (order.network === 'MTN' && providerName === 'Manual') {
      await supabase.from('orders').update({ status: 'pending', delivery_mode: 'manual' }).eq('id', order_id);
      return new Response(JSON.stringify({ success: true, mode: 'manual', message: 'MTN order pinned to manual processing at creation' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let providerUrl: string;
    let providerHeaders: Record<string, string>;
    let providerBody: Record<string, unknown>;

    if (providerName === "iGet") {
      console.log(JSON.stringify({ event: "iget_order_placed", order_id: order_id, short_id: order.short_id, network: order.network, bundle_size: order.bundle_size, recipient_phone: order.recipient_phone, timestamp: new Date().toISOString() }));
      // iGet API — used for Telecel, AirtelTigo, and (when toggled on) MTN.
      // MTN always uses the backend IGET_API_KEY secret and the bundle type
      // pinned to the order at creation — never the MTN row's Portal-02 key.
      const isMtn = order.network === 'MTN';
      // MTN iGet reuses the verified AirtelTigo/Telecel iGet key (same account).
      let igetConfigs = [config];
      if (isMtn) {
        const { data: sharedCfg } = await supabase
          .from("network_api_configs")
          .select("network, api_key")
          .in("network", ["Telecel", "AirtelTigo"])
          .not("api_key", "is", null)
          .neq("api_key", "")
          .limit(1)
          .maybeSingle();
        igetConfigs = sharedCfg ? [config, sharedCfg] : [config];
      }
      const igetConfig = resolveIgetConfig(order.network, igetConfigs, Deno.env.get("IGET_API_KEY") || "");
      const igetApiKey = igetConfig.api_key;
      const bundleType = isMtn
        ? (order.provider_bundle_type || "")
        : (extraParams as Record<string, string>).bundle_type;
      if (isMtn && igetApiKey && !/^[\x21-\x7E]+$/.test(igetApiKey)) {
        // Key contains non-ASCII characters; no request can be sent. Hold for admin (no provider call made).
        await supabase
          .from("orders")
          .update({ status: "pending", delivery_mode: "manual", provider_response: { error: "IGET_API_KEY contains invalid characters; re-enter the secret" } })
          .eq("id", order_id);
        return new Response(JSON.stringify({ success: false, held: true, error: "iGet API key contains invalid characters" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (isMtn && !igetApiKey) {
        await supabase
          .from("orders")
          .update({ status: "failed", provider_response: { error: "IGET_API_KEY secret not configured" } })
          .eq("id", order_id);
        return new Response(JSON.stringify({ error: "iGet API key not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (isMtn) {
        try {
          const { data: mtnItems } = await supabase
            .from("price_items")
            .select("product, size")
            .eq("network", "MTN");
          validateMtnIgetPurchase(order.recipient_phone, volume, bundleType, capacitiesFromCatalog(mtnItems || []));
        } catch (validationError) {
          await supabase
            .from("orders")
            .update({ status: "failed", provider_response: { error: (validationError as Error).message } })
            .eq("id", order_id);
          return new Response(JSON.stringify({ error: (validationError as Error).message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (!bundleType) {
        await supabase
          .from("orders")
          .update({ status: "failed", provider_response: { error: "Missing bundle_type in network config" } })
          .eq("id", order_id);
        return new Response(JSON.stringify({ error: `Missing bundle_type in ${order.network} config` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // MTN's config row holds Portal-02's base URL, so MTN iGet orders use
      // the fixed iGet base URL; AT/Telecel keep their own configured URL.
      const igetBaseUrl = igetConfig.api_base_url;
      providerUrl = `${igetBaseUrl}/api/developer/orders/place`;
      providerHeaders = {
        "Content-Type": "application/json",
        "X-API-Key": igetApiKey,
      };
      // iGet now rejects orders without a valid HTTPS callback URL.
      const igetWebhookUrl = ((extraParams as Record<string, string>).webhook_url
        || `${supabaseUrl}/functions/v1/order-webhook`).replace(/^http:/, "https:");
      providerBody = {
        recipientNumber: order.recipient_phone, // iGet expects local format (0xx...)
        capacity: volume,
        bundleType,
        webhookUrl: igetWebhookUrl,
        webhook_url: igetWebhookUrl,
        callbackUrl: igetWebhookUrl,
      };

    } else {
      // Portal-02 API — used for MTN
      const webhookUrl = (extraParams as Record<string, string>).webhook_url || `${supabaseUrl}/functions/v1/order-webhook`;
      const normalizedPhone = normalizeGhanaPhone(order.recipient_phone);

      providerUrl = `${config.api_base_url}/order/${order.network.toLowerCase()}`;
      providerHeaders = {
        "Content-Type": "application/json",
        "x-api-key": config.api_key,
      };
      providerBody = {
        type: "single",
        volume,
        phone: normalizedPhone,
        offerSlug: "master_beneficiary_data_bundle",
        webhookUrl,
      };
    }

    // For MTN, record that a submission is starting BEFORE calling the provider.
    // If the request times out or the function crashes, the order is held for
    // admin reconciliation instead of being blindly repurchased.
    if (order.network === 'MTN') {
      await supabase
        .from('orders')
        .update({ provider_submission_started_at: new Date().toISOString() })
        .eq('id', order_id);
    }

    let providerRes: Response;
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30_000);
      providerRes = await fetch(providerUrl, {
        method: "POST",
        headers: providerHeaders,
        body: JSON.stringify(providerBody),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
    } catch (fetchError) {
      // Timeout/network failure AFTER submission started: the provider may have
      // accepted the purchase. Never retry or reroute — flag for reconciliation.
      if (order.network === 'MTN') {
        await supabase.from('orders').update({
          status: 'failed',
          provider_submission_uncertain: true,
          provider_response: { error: 'SUBMISSION_UNCERTAIN', detail: (fetchError as Error).message },
        }).eq('id', order_id);
        return new Response(JSON.stringify({ success: false, error: 'Provider request uncertain; order held for admin reconciliation', uncertain: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw fetchError;
    }

    const providerData = await providerRes.json();

    if (providerRes.ok && (providerData.success || !providerData.error)) {
      // Determine initial status from the provider's actual response
      const statusMap: Record<string, string> = {
        pending: "pending",
        queued: "pending",
        processing: "processing",
        completed: "delivered",
        delivered: "delivered",
        success: "delivered",
        failed: "failed",
      };

      let initialStatus: string;
      if (providerName === "iGet") {
        // iGet (Telecel/AirtelTigo): derive status ONLY from data.order.status
        // Do NOT use success, transaction.status, or top-level status fields
        const igetOrderStatus = providerData.data?.order?.status;
        const normalised = (igetOrderStatus || "").toLowerCase();
        initialStatus = normalised ? (statusMap[normalised] || "pending") : "pending";
        console.log(JSON.stringify({ event: "iget_status_mapped", order_id, provider_order_status: igetOrderStatus, mapped_to: initialStatus, timestamp: new Date().toISOString() }));
      } else {
        // Portal-02 (MTN): respect the provider's reported status
        const providerStatus = (providerData.status || providerData.state || "").toLowerCase();
        initialStatus = statusMap[providerStatus] || "pending";
      }

      const updateData: Record<string, unknown> = {
        delivery_mode: "api",
        provider_name: providerName,
        provider_response: providerData,
        status: initialStatus,
      };

      if (providerName === "iGet" && providerData.data?.order) {
        updateData.provider_order_id = providerData.data.order.id || "";
        updateData.provider_reference = providerData.data.order.orderReference || "";
      } else {
        updateData.provider_order_id = providerData.orderId || "";
        updateData.provider_reference = providerData.reference || "";
      }

      await supabase
        .from("orders")
        .update(updateData)
        .eq("id", order_id);

      // Fire-and-forget: trigger fast polls so the customer doesn't wait for cron
      const triggerPoll = (fnName: string, delayMs: number, label: string) => {
        setTimeout(async () => {
          console.log(JSON.stringify({ event: `${fnName}_fast_poll_trigger`, label, order_id: order_id, short_id: order.short_id, network: order.network, delay_ms: delayMs, timestamp: new Date().toISOString() }));
          try {
            await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({ time: "fast-poll" }),
            });
          } catch (_) { /* non-critical */ }
        }, delayMs);
      };

      if (providerName === "iGet") {
        triggerPoll("poll-iget-orders", 15_000, "fast_poll_15s");
        triggerPoll("poll-iget-orders", 45_000, "fast_poll_45s");
      } else if (providerName === "Portal-02") {
        triggerPoll("poll-mtn-orders", 15_000, "fast_poll_15s");
        triggerPoll("poll-mtn-orders", 45_000, "fast_poll_45s");
      }

      return new Response(
        JSON.stringify({ success: true, mode: "api", provider: providerName, provider_reference: updateData.provider_reference }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      const failureReason =
        providerData?.error ||
        providerData?.message ||
        "Provider could not fulfill the order";
      const failureType = (providerData?.type || "").toString().toUpperCase();

      // Safety: if Portal-02 reports DUPLICATE_ORDER and this order already
      // carries a provider_reference from us, the ORIGINAL submission is in
      // flight and will be fulfilled by the provider. We must NOT mark failed
      // or refund — restore status to pending and let the poller resolve it.
      if (
        providerName === "Portal-02" &&
        failureType === "DUPLICATE_ORDER" &&
        order.provider_reference
      ) {
        await supabase
          .from("orders")
          .update({ status: "pending" })
          .eq("id", order_id);

        console.log(JSON.stringify({
          event: "deliver_order_duplicate_ignored",
          order_id, short_id: order.short_id,
          provider_reference: order.provider_reference,
          reason: "Duplicate-order from provider on already-submitted order; no refund",
          timestamp: new Date().toISOString(),
        }));

        return new Response(
          JSON.stringify({ success: true, skipped: true, message: "Order already submitted; provider duplicate ignored" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Provider rejected the order (insufficient balance, invalid bundle, etc.).
      // Mark failed so reject-order can pick it up, then invoke reject-order to
      // auto-refund the buyer (Paystack for guests/stores, wallet for registered).
      await supabase
        .from("orders")
        .update({
          delivery_mode: "api",
          provider_name: providerName,
          provider_response: providerData,
          status: "failed",
        })
        .eq("id", order_id);

      console.log(JSON.stringify({
        event: "deliver_order_provider_failed",
        order_id, short_id: order.short_id, network: order.network,
        provider: providerName, reason: failureReason,
        timestamp: new Date().toISOString(),
      }));

      // Fire-and-forget auto-refund — never block delivery response.
      try {
        await fetch(`${supabaseUrl}/functions/v1/reject-order`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            order_id,
            refund_reason: `Auto-refund: ${failureReason}`,
            is_full_override: false,
            initiated_by: "system_auto_refund",
          }),
        });
      } catch (e) {
        console.error("[deliver-order] auto-refund invocation failed:", e);
      }

      return new Response(
        JSON.stringify({ success: false, error: failureReason, auto_refund: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


  } catch (error) {
    console.error("deliver-order error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
