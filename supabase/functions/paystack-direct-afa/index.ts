import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Verifies a Paystack reference and creates an AFA registration.
 * Supports both registered customers and guests.
 *
 * Body:
 *   reference: string (required)
 *   buyer_type: 'registered' | 'guest'
 *   customer_id?: string (registered only)
 *   full_name: string
 *   registration_phone: string
 *   location: string
 *   buyer_phone?: string (guest only)
 *   buyer_email?: string (guest only)
 *   affiliate_code?: string (guest only)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json();
    const {
      reference, buyer_type, customer_id,
      full_name, registration_phone, location,
      buyer_phone = "", buyer_email = "", affiliate_code = "",
      store_slug = "",
    } = body;


    if (!reference || !full_name || !registration_phone || !location) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: h });
    }
    if (buyer_type === "registered" && !customer_id) {
      return new Response(JSON.stringify({ error: "customer_id required for registered users" }), { status: 400, headers: h });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get Paystack secret
    const { data: settingRow } = await supabase
      .from("platform_settings").select("value").eq("key", "paystack_secret_key").single();
    const paystackSecretKey = settingRow?.value;
    if (!paystackSecretKey) {
      return new Response(JSON.stringify({ error: "Paystack not configured" }), { status: 500, headers: h });
    }

    // Verify with Paystack
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData.data?.status !== "success") {
      return new Response(JSON.stringify({ error: "Payment verification failed" }), { status: 400, headers: h });
    }

    // Create AFA registration via the proper RPC
    let result: any;
    let smsTo = "";
    let smsCustomerId: string | null = null;

    if (buyer_type === "guest" && store_slug) {
      const { data, error } = await supabase.rpc("place_store_afa_paystack", {
        p_store_slug: store_slug,
        p_payment_reference: reference,
        p_full_name: full_name,
        p_registration_phone: registration_phone,
        p_location: location,
        p_buyer_phone: buyer_phone,
        p_buyer_email: buyer_email,
        p_affiliate_code: affiliate_code,
      });
      if (error) throw error;
      result = data as any;
      if (result?.error) return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: h });
      smsTo = (buyer_phone || "").replace(/[^0-9]/g, "");
    } else if (buyer_type === "guest") {
      const { data, error } = await supabase.rpc("place_afa_guest_paystack", {
        p_full_name: full_name,
        p_registration_phone: registration_phone,
        p_location: location,
        p_buyer_phone: buyer_phone,
        p_buyer_email: buyer_email,
        p_affiliate_code: affiliate_code,
        p_payment_reference: reference,
      });
      if (error) throw error;
      result = data as any;
      if (result?.error) return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: h });
      smsTo = (buyer_phone || "").replace(/[^0-9]/g, "");
    } else {
      const { data, error } = await supabase.rpc("place_afa_paystack", {
        p_customer_id: customer_id,
        p_full_name: full_name,
        p_registration_phone: registration_phone,
        p_location: location,
        p_payment_reference: reference,
      });
      if (error) throw error;
      result = data as any;
      if (result?.error) return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: h });
      smsCustomerId = customer_id;
      // Resolve buyer phone from customer
      const { data: cust } = await supabase.from("customers").select("phone").eq("id", customer_id).maybeSingle();
      smsTo = (cust?.phone || "").replace(/[^0-9]/g, "");
    }

    // Submission SMS (idempotent — only fired on first creation, not on duplicate webhook replays).
    if (smsTo && smsTo.length >= 9 && !result?.already_processed) {
      const smsRef = result.short_id || (result.id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
      const message = `Your registration request has been received. Reference: ${smsRef}. We will notify you once it is processed.`;
      supabase.functions.invoke("send-sms", {
        body: {
          to: smsTo,
          message,
          event_type: "afa_submitted",
          customer_id: smsCustomerId,
          idempotency_key: `afa_submitted_${result.id}`,
        },
      }).catch((e: any) => console.error("[paystack-direct-afa] submit SMS error:", e));
    }

    return new Response(JSON.stringify(result), { status: 200, headers: h });
  } catch (e) {
    console.error("[paystack-direct-afa] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
