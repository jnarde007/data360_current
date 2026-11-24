import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Normalise a Ghana phone number to international format (233XXXXXXXXX).
 * Accepts 0XX, +233XX, or 233XX formats.
 */
function normalizeGhanaPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("0")) return "233" + cleaned.slice(1);
  return cleaned;
}

interface SmsRequest {
  to: string;
  message: string;
  event_type?: string;
  related_order_id?: string;
  related_purchase_id?: string;
  customer_id?: string;
  idempotency_key?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const h = { ...corsHeaders, "Content-Type": "application/json" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body: SmsRequest = await req.json();
    const { to, message, event_type, related_order_id, related_purchase_id, customer_id, idempotency_key } = body;

    if (!to || !message) {
      return new Response(JSON.stringify({ error: "Missing 'to' or 'message'" }), { status: 400, headers: h });
    }

    const normalizedPhone = normalizeGhanaPhone(to);

    // ── Idempotency check ──────────────────────────────────────
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from("sms_send_log")
        .select("id, status")
        .eq("event_type", event_type || "")
        .eq("recipient_phone", normalizedPhone)
        .eq("error_message", idempotency_key)
        .in("status", ["sent"])
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[send-sms] Duplicate blocked: ${idempotency_key}`);
        return new Response(JSON.stringify({ success: true, duplicate: true }), { status: 200, headers: h });
      }
    }

    // ── Load Wittyflow config from platform_settings ───────────
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", ["sms_api_base_url", "sms_app_id", "sms_app_secret", "sms_sender_id", "sms_callback_url"]);

    const cfg: Record<string, string> = {};
    settings?.forEach((s: any) => { cfg[s.key] = s.value; });

    const apiBaseUrl = (cfg.sms_api_base_url || "").replace(/\/+$/, "");
    const appId = cfg.sms_app_id || "";
    const appSecret = cfg.sms_app_secret || "";
    const senderId = cfg.sms_sender_id || "DATA360";
    const callbackUrl = cfg.sms_callback_url || "";

    if (!apiBaseUrl || !appId || !appSecret) {
      console.warn("[send-sms] Wittyflow not configured (missing base URL, app_id, or app_secret)");
      await supabase.from("sms_send_log").insert({
        event_type: event_type || "unknown",
        recipient_phone: normalizedPhone,
        message_body: message,
        status: "skipped",
        error_message: "Wittyflow not configured",
        related_order_id: related_order_id || null,
        related_purchase_id: related_purchase_id || null,
        customer_id: customer_id || null,
      });
      return new Response(JSON.stringify({ success: false, skipped: true, reason: "SMS not configured" }), { status: 200, headers: h });
    }

    // ── Create log entry (pending) ─────────────────────────────
    const { data: logEntry } = await supabase.from("sms_send_log").insert({
      event_type: event_type || "unknown",
      recipient_phone: normalizedPhone,
      message_body: message,
      status: "pending",
      related_order_id: related_order_id || null,
      related_purchase_id: related_purchase_id || null,
      customer_id: customer_id || null,
    }).select("id").single();

    const logId = logEntry?.id;

    // ── Send via Wittyflow ─────────────────────────────────────
    const providerPayload: Record<string, any> = {
      app_id: appId,
      app_secret: appSecret,
      from: senderId,
      to: normalizedPhone,
      type: 1, // plain text
      message: message,
    };
    if (callbackUrl) {
      providerPayload.callback_url = callbackUrl;
    }

    const sendUrl = `${apiBaseUrl}/messages/send`;
    console.log(`[send-sms] Sending to ${normalizedPhone} via ${sendUrl}`);

    const providerRes = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerPayload),
    });

    const providerData = await providerRes.text();
    let parsedResponse: any;
    try { parsedResponse = JSON.parse(providerData); } catch { parsedResponse = { raw: providerData }; }

    const sent = providerRes.ok;
    const finalStatus = sent ? "sent" : "failed";
    const errorMsg = sent
      ? (idempotency_key || "")
      : (parsedResponse?.message || parsedResponse?.error || `HTTP ${providerRes.status}`);

    // ── Update log entry ───────────────────────────────────────
    if (logId) {
      await supabase.from("sms_send_log").update({
        status: finalStatus,
        provider_response: parsedResponse,
        error_message: errorMsg,
      }).eq("id", logId);
    }

    console.log(`[send-sms] Result: ${finalStatus} for ${normalizedPhone}`);

    return new Response(JSON.stringify({
      success: sent,
      status: finalStatus,
      log_id: logId,
      message_id: parsedResponse?.message_id || null,
    }), { status: 200, headers: h });

  } catch (error) {
    console.error("[send-sms] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
