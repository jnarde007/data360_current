import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Guest Result Checker purchase via Paystack.
 * Body: { reference, product_id, quantity, buyer_phone, buyer_email, affiliate_code }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const {
      reference, product_id, quantity = 1,
      buyer_phone = "", buyer_email = "", affiliate_code = "",
    } = await req.json();

    if (!reference || !product_id || !buyer_phone) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: h });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: settingRow } = await supabase
      .from("platform_settings").select("value").eq("key", "paystack_secret_key").single();
    const paystackSecretKey = settingRow?.value;
    if (!paystackSecretKey) {
      return new Response(JSON.stringify({ error: "Paystack not configured" }), { status: 500, headers: h });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData.data?.status !== "success") {
      return new Response(JSON.stringify({ error: "Payment verification failed" }), { status: 400, headers: h });
    }

    const { data, error } = await supabase.rpc("purchase_checker_guest_paystack", {
      p_product_id: product_id,
      p_payment_reference: reference,
      p_quantity: quantity,
      p_buyer_phone: buyer_phone,
      p_buyer_email: buyer_email,
      p_affiliate_code: affiliate_code,
    });
    if (error) throw error;
    const result = data as any;
    if (result?.error) return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: h });

    return new Response(JSON.stringify(result), { status: 200, headers: h });
  } catch (e) {
    console.error("[paystack-direct-guest-checker] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
