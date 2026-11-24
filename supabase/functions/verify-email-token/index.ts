import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { token } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up the token
    const { data: otpRecord, error: lookupError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("code", token)
      .eq("purpose", "email_verification")
      .eq("used", false)
      .maybeSingle();

    if (lookupError || !otpRecord) {
      return new Response(
        JSON.stringify({ verified: false, error: "Invalid or expired verification link" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiry
    if (new Date(otpRecord.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ verified: false, error: "This verification link has expired. Please request a new one." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark token as used
    await supabase
      .from("otp_codes")
      .update({ used: true })
      .eq("id", otpRecord.id);

    // Update customer's email_verified flag
    const { error: updateError } = await supabase
      .from("customers")
      .update({ email_verified: true })
      .eq("auth_user_id", otpRecord.user_id);

    if (updateError) {
      console.error("Failed to update email_verified:", updateError);
      throw new Error("Verification succeeded but failed to update account");
    }

    console.log(`Email verified for user ${otpRecord.user_id}`);

    // Send welcome email now that email is verified (fire & forget)
    try {
      const { data: customer } = await supabase
        .from("customers")
        .select("id, phone, full_name, username")
        .eq("auth_user_id", otpRecord.user_id)
        .maybeSingle();

      if (customer?.id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
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
        });
        console.log(`Welcome email triggered for customer ${customer.id}`);

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
      }
    } catch (welcomeErr) {
      console.error("Welcome email/SMS after verification failed:", welcomeErr);
      // Don't fail the verification response
    }

    return new Response(
      JSON.stringify({ verified: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("verify-email-token error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
