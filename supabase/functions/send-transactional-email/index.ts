import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { WelcomeEmail } from "../_shared/email-templates/welcome.tsx";
import { OrderConfirmationEmail } from "../_shared/email-templates/order-confirmation.tsx";
import { WalletTopupEmail } from "../_shared/email-templates/wallet-topup.tsx";
import { OrderDeliveredEmail } from "../_shared/email-templates/order-delivered.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_NAME = "data360";
const SITE_URL = "https://buy-data360.com";
const FROM_DOMAIN = "notify.buy-data360.com";
const SENDER_DOMAIN = "notify.buy-data360.com";

interface EmailPayload {
  template: "welcome" | "order-confirmation" | "wallet-topup" | "order-delivered";
  customer_id: string;
  data: Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload: EmailPayload = await req.json();
    const { template, customer_id, data } = payload;

    if (!template || !customer_id) {
      return new Response(JSON.stringify({ error: "Missing template or customer_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch customer
    const { data: customer } = await supabase
      .from("customers")
      .select("email, full_name")
      .eq("id", customer_id)
      .single();

    if (!customer?.email) {
      return new Response(JSON.stringify({ error: "Customer email not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build message_id for dedup
    const messageId = `${template}-${data.short_id || data.reference || customer_id}-${Date.now()}`;

    // Dedup check
    const dedupKey = data.short_id
      ? `${template}-${data.short_id}`
      : `${template}-${customer_id}`;

    const { data: existing } = await supabase
      .from("email_send_log")
      .select("id")
      .eq("message_id", dedupKey)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`Email already sent: ${dedupKey}`);
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });

    let subject = "";
    let element: React.ReactElement;

    switch (template) {
      case "welcome":
        subject = `Welcome to ${SITE_NAME}!`;
        element = React.createElement(WelcomeEmail, {
          siteName: SITE_NAME,
          siteUrl: SITE_URL,
          customerName: customer.full_name || undefined,
        });
        break;

      case "order-confirmation":
        subject = `Order ${data.short_id} received — ${data.bundle_size} ${data.network}`;
        element = React.createElement(OrderConfirmationEmail, {
          siteName: SITE_NAME,
          customerName: customer.full_name || undefined,
          recipientPhone: data.recipient_phone,
          network: data.network,
          bundleSize: data.bundle_size,
          totalAmount: Number(data.total_amount).toFixed(2),
          shortId: data.short_id,
          orderedAt: now,
        });
        break;

      case "wallet-topup":
        subject = `GHS ${Number(data.amount).toFixed(2)} added to your wallet`;
        element = React.createElement(WalletTopupEmail, {
          siteName: SITE_NAME,
          siteUrl: SITE_URL,
          customerName: customer.full_name || undefined,
          amount: Number(data.amount).toFixed(2),
          newBalance: Number(data.new_balance).toFixed(2),
          method: data.method || "Mobile Money",
          shortId: data.short_id,
          approvedAt: now,
        });
        break;

      case "order-delivered":
        subject = `${data.bundle_size} ${data.network} delivered — ${data.short_id}`;
        element = React.createElement(OrderDeliveredEmail, {
          siteName: SITE_NAME,
          customerName: customer.full_name || undefined,
          recipientPhone: data.recipient_phone,
          network: data.network,
          bundleSize: data.bundle_size,
          totalAmount: Number(data.total_amount).toFixed(2),
          shortId: data.short_id,
          deliveredAt: now,
        });
        break;

      default:
        return new Response(JSON.stringify({ error: `Unknown template: ${template}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const html = await renderAsync(element);
    const text = await renderAsync(element, { plainText: true });

    // Fetch latest run_id for Lovable Email API
    const { data: runIdSetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "lovable_run_id")
      .maybeSingle();

    const run_id = typeof runIdSetting?.value === "string" ? runIdSetting.value.trim() : "";
    if (!run_id) {
      throw new Error("Missing email delivery session");
    }

    // Log pending
    await supabase.from("email_send_log").insert({
      message_id: dedupKey,
      template_name: template,
      recipient_email: customer.email,
      status: "pending",
    });

    // Enqueue for Lovable Cloud delivery
    const { error: enqueueError } = await supabase.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        run_id,
        message_id: dedupKey,
        to: customer.email,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: "transactional",
        label: template,
        queued_at: new Date().toISOString(),
      },
    });

    if (enqueueError) {
      console.error("Failed to enqueue email:", enqueueError);
      return new Response(JSON.stringify({ error: "Failed to enqueue" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`${template} email enqueued for ${customer.email}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-transactional-email error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
