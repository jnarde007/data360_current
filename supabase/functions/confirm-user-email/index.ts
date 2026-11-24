import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Force-confirm the user's email in auth.users
    const { error } = await supabase.auth.admin.updateUserById(user_id, {
      email_confirm: true,
    });

    if (error) {
      console.error("Failed to confirm user:", error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also sync customers table
    await supabase
      .from("customers")
      .update({ email_verified: true })
      .eq("auth_user_id", user_id);

    // ── Send welcome email + account creation SMS ──────────────────
    // This path runs when email verification is disabled, so we send
    // the welcome email and account creation SMS here (equivalent to
    // what verify-email-token does when verification is enabled).
    try {
      const { data: customer } = await supabase
        .from("customers")
        .select("id, full_name, phone, username")
        .eq("auth_user_id", user_id)
        .maybeSingle();

      if (customer?.id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        // Trigger welcome email
        fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            template: "welcome",
            customer_id: customer.id,
            data: {},
          }),
        }).catch((e: any) => console.error("Welcome email error:", e));

        // Send account creation SMS to buyer phone
        if (customer.phone) {
          const uname = (customer.username || "").trim();
          const firstName = (customer.full_name || "").trim().split(/\s+/)[0] || "";
          const greeting = uname
            ? `Welcome ${uname}`
            : firstName
              ? `Welcome ${firstName}`
              : "Welcome";
          const smsMessage = `${greeting}\nYour account has been created successfully.\nYou can now place orders, fund your wallet, and track purchases anytime.`;
          supabase.functions.invoke("send-sms", {
            body: {
              to: customer.phone,
              message: smsMessage,
              event_type: "account_created",
              customer_id: customer.id,
              idempotency_key: `account_created_${customer.id}`,
            },
          }).catch((e: any) => console.error("Account creation SMS error:", e));
        }

        console.log(`[confirm-user-email] Welcome email + SMS triggered for customer ${customer.id}`);
      }
    } catch (welcomeErr) {
      console.error("Welcome email/SMS after auto-confirm failed:", welcomeErr);
      // Don't fail the confirmation response
    }

    return new Response(JSON.stringify({ confirmed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("confirm-user-email error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
