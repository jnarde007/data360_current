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

  try {
    const { reference, customer_id, type } = await req.json();

    // Safety: reject if this is a direct checkout reference (not a wallet top-up)
    if (type === "data_direct" || type === "checker_direct") {
      return new Response(JSON.stringify({ error: "This is a direct checkout payment, not a wallet top-up" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!reference || !customer_id) {
      return new Response(JSON.stringify({ error: "Missing reference or customer_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const pskRef = `PSK-${reference}`;

    // Fast idempotency check before calling Paystack API
    const { data: existingTx } = await supabase
      .from("wallet_transactions")
      .select("id")
      .eq("reference", pskRef)
      .eq("type", "credit")
      .limit(1);

    if (existingTx && existingTx.length > 0) {
      console.log(`[verify-paystack] Already processed ref=${reference}, returning success`);
      // Fetch current balance for UI
      const { data: cust } = await supabase.from("customers").select("wallet_balance").eq("id", customer_id).single();
      return new Response(
        JSON.stringify({ success: true, already_processed: true, new_balance: cust?.wallet_balance }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Paystack secret key
    const { data: settingRow } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "paystack_secret_key")
      .single();

    const paystackSecretKey = settingRow?.value;
    if (!paystackSecretKey) {
      return new Response(
        JSON.stringify({ error: "Paystack secret key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify transaction with Paystack
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${paystackSecretKey}` } }
    );
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || verifyData.data?.status !== "success") {
      return new Response(
        JSON.stringify({ error: "Payment verification failed", details: verifyData }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const metadata = verifyData.data.metadata || {};
    let creditAmount: number | null = null;
    if (metadata.credit_amount != null && !isNaN(Number(metadata.credit_amount))) {
      creditAmount = Number(metadata.credit_amount);
    }
    if (creditAmount == null && Array.isArray(metadata.custom_fields)) {
      const cf = metadata.custom_fields.find((f: any) => f.variable_name === 'credit_amount');
      if (cf?.value != null && !isNaN(Number(cf.value))) {
        creditAmount = Number(cf.value);
      }
    }
    if (creditAmount == null) {
      creditAmount = verifyData.data.amount / 100;
    }

    // Look up topup short_id for description
    const { data: topupRow } = await supabase
      .from("topups")
      .select("short_id")
      .eq("customer_id", customer_id)
      .eq("method", "paystack")
      .eq("status", "approved")
      .eq("amount", creditAmount)
      .order("created_at", { ascending: false })
      .limit(1);
    const topupRef = topupRow?.[0]?.short_id || "";
    const description = topupRef
      ? `Wallet top-up via Paystack (${topupRef})`
      : `Wallet top-up via Paystack`;

    // Use atomic DB function — prevents double-credit even under race conditions
    const { data: creditResult, error: creditErr } = await supabase.rpc("credit_wallet_paystack", {
      p_customer_id: customer_id,
      p_reference: pskRef,
      p_amount: creditAmount,
      p_description: description,
    });

    if (creditErr) {
      console.error("[verify-paystack] credit_wallet_paystack error:", creditErr);
      return new Response(
        JSON.stringify({ error: "Failed to credit wallet" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = creditResult as any;
    if (result?.error) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (result?.already_processed) {
      console.log(`[verify-paystack] Duplicate prevented by DB function, ref=${reference}`);
      const { data: cust } = await supabase.from("customers").select("wallet_balance").eq("id", customer_id).single();
      return new Response(
        JSON.stringify({ success: true, already_processed: true, new_balance: cust?.wallet_balance }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Topup row is now created atomically inside credit_wallet_paystack

    console.log(`[verify-paystack] Credited GHS ${creditAmount} to customer ${customer_id}, ref=${reference}`);

    // Send wallet top-up confirmation email (fire & forget)
    const topupShortId = topupRef || pskRef;
    supabase.functions.invoke("send-transactional-email", {
      body: {
        template: "wallet-topup",
        customer_id: customer_id,
        data: { amount: creditAmount, new_balance: result.new_balance, method: "Paystack", short_id: topupShortId },
      },
    }).catch((e: any) => console.error("Topup email error:", e));

    return new Response(
      JSON.stringify({ success: true, amount: creditAmount, new_balance: result.new_balance }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[verify-paystack] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
