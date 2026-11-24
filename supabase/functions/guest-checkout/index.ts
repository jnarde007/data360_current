import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_PAYSTACK_EMAIL = "checkout@secure-payment-rail.net";

/**
 * Guest checkout edge function.
 *
 * Creates a payment_attempt for a guest buyer (no account needed)
 * and returns data to initialize the Paystack popup on the frontend.
 *
 * Input:
 *  {
 *    network, bundle_size, recipient_phone, buyer_phone, buyer_email?,
 *    quantity?, affiliate_code?, items: [{ phone, bundleLabel, price }]
 *  }
 *
 * Output:
 *  { reference, amount, paystack_total, email, metadata }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const h = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json();
    const {
      network,
      items,
      buyer_phone,
      refund_momo_number,
      buyer_email,
      affiliate_code,
    } = body;

    // ── Input validation ──────────────────────────────────
    if (!network || typeof network !== "string") {
      return new Response(JSON.stringify({ error: "Network is required" }), { status: 400, headers: h });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: "At least one item is required" }), { status: 400, headers: h });
    }

    if (items.length > 10) {
      return new Response(JSON.stringify({ error: "Maximum 10 items per checkout" }), { status: 400, headers: h });
    }

    if (!buyer_phone || typeof buyer_phone !== "string" || buyer_phone.replace(/[^0-9]/g, "").length < 9) {
      return new Response(JSON.stringify({ error: "Valid buyer phone number is required" }), { status: 400, headers: h });
    }

    // Validate each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.phone || typeof item.phone !== "string" || item.phone.replace(/[^0-9]/g, "").length < 9) {
        return new Response(JSON.stringify({ error: `Invalid recipient phone for item ${i + 1}` }), { status: 400, headers: h });
      }
      if (!item.bundleLabel || typeof item.bundleLabel !== "string") {
        return new Response(JSON.stringify({ error: `Invalid bundle for item ${i + 1}` }), { status: 400, headers: h });
      }
      if (!item.price || typeof item.price !== "number" || item.price <= 0) {
        return new Response(JSON.stringify({ error: `Invalid price for item ${i + 1}` }), { status: 400, headers: h });
      }
    }

    // Normalize inputs
    const normalizedBuyerPhone = buyer_phone.replace(/[^0-9]/g, "");
    // Fallback refund destination when a Paystack refund is not possible
    const normalizedRefundMomo =
      typeof refund_momo_number === "string" && refund_momo_number.replace(/[^0-9]/g, "").length >= 9
        ? refund_momo_number.replace(/[^0-9]/g, "")
        : normalizedBuyerPhone;
    const normalizedEmail = (buyer_email || "").trim().toLowerCase();
    const normalizedAffiliate = (affiliate_code || "").trim();

    // ── Server-side price validation ──────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Network availability gate — block disabled networks for guests
    const { data: netCfg } = await supabase
      .from("network_api_configs")
      .select("available_for_purchase")
      .eq("network", network)
      .maybeSingle();

    if (!netCfg || netCfg.available_for_purchase !== true) {
      return new Response(JSON.stringify({
        error: `${network} delivery is currently halted. Please try again later.`,
        code: "NETWORK_UNAVAILABLE",
      }), { status: 400, headers: h });
    }

    // Fetch prices from DB to prevent client-side price manipulation
    const { data: priceItems } = await supabase
      .from("public_price_items")
      .select("size, price, network")
      .eq("network", network);

    if (!priceItems || priceItems.length === 0) {
      return new Response(JSON.stringify({ error: "No pricing found for this network" }), { status: 400, headers: h });
    }

    const priceMap = new Map<string, number>();
    for (const pi of priceItems) {
      if (pi.size && pi.price != null) {
        priceMap.set(pi.size, pi.price);
      }
    }

    // Strict network validation: reject the entire batch if any phone is not on the selected network.
    const detectNet = (raw: string): string | null => {
      let d = (raw || "").replace(/[^0-9]/g, "");
      if (d.length >= 12 && d.startsWith("233")) d = "0" + d.slice(3);
      const p = d.slice(0, 3);
      const map: Record<string, string> = {
        "024": "MTN", "025": "MTN", "053": "MTN", "054": "MTN", "055": "MTN", "059": "MTN",
        "026": "AirtelTigo", "027": "AirtelTigo", "056": "AirtelTigo", "057": "AirtelTigo",
        "020": "Telecel", "050": "Telecel",
      };
      return map[p] || null;
    };
    const mismatches: { phone: string; detected: string | null }[] = [];
    for (const item of items) {
      const cleaned = (item.phone || "").replace(/[^0-9]/g, "");
      const det = detectNet(cleaned);
      if (det !== network) mismatches.push({ phone: cleaned, detected: det });
    }
    if (mismatches.length > 0) {
      return new Response(JSON.stringify({
        error: `Mixed-network batch rejected: ${mismatches.length} number(s) do not belong to ${network}.`,
        code: "NETWORK_MISMATCH",
        selected_network: network,
        invalid_count: mismatches.length,
        invalid_numbers: mismatches,
      }), { status: 400, headers: h });
    }

    // Validate and recalculate each item's price server-side
    let totalAmount = 0;
    const validatedItems: any[] = [];
    for (const item of items) {
      const serverPrice = priceMap.get(item.bundleLabel);
      if (serverPrice == null) {
        return new Response(JSON.stringify({ error: `Bundle "${item.bundleLabel}" not available for ${network}` }), { status: 400, headers: h });
      }
      const cleanedPhone = item.phone.replace(/[^0-9]/g, "");
      totalAmount += serverPrice;
      validatedItems.push({
        phone: cleanedPhone,
        bundleLabel: item.bundleLabel,
        price: serverPrice, // Use server price, not client price
        detected_network: detectNet(cleanedPhone),
      });
    }

    // ── Duplicate-recipient pre-flight ────────────────────
    // Block checkout entirely if any recipient already has an active order.
    // This guarantees guests are NOT charged when a duplicate exists.
    try {
      const { data: availData, error: availErr } = await supabase.rpc(
        "check_recipient_availability" as any,
        {
          p_items: validatedItems.map((it: any) => ({
            network,
            phone: it.phone,
          })),
        }
      );
      if (!availErr && availData && (availData as any).blocked) {
        const blocked = ((availData as any).items || []).filter(
          (x: any) => x?.blocked
        );
        return new Response(
          JSON.stringify({
            error:
              blocked.length === 1
                ? `${blocked[0].phone} already has an active order. Please wait for it to be delivered before ordering again.`
                : `${blocked.length} recipients already have active orders. Please wait for them to be delivered before ordering again.`,
            code: "DUPLICATE_RECIPIENT",
            blocked_items: blocked,
          }),
          { status: 409, headers: h }
        );
      }
    } catch (e) {
      console.error("[guest-checkout] availability check failed:", e);
      // Fail-open: server-side place_order_guest_paystack will still block at finalize.
    }

    // ── Calculate Paystack total (including fee) ──────────
    const PAYSTACK_FEE_RATE = 0.02;
    const paystackFee = Math.round(totalAmount * PAYSTACK_FEE_RATE * 100) / 100;
    const paystackTotal = Math.round((totalAmount + paystackFee) * 100) / 100;

    // ── Generate reference ────────────────────────────────
    const reference = `gdd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // ── Create payment_attempt ────────────────────────────
    // Use a placeholder customer_id for guest (the DB allows this via service_role)
    const guestCustomerId = "00000000-0000-0000-0000-000000000000";

    const { error: insertErr } = await supabase.from("payment_attempts").insert({
      paystack_reference: reference,
      customer_id: guestCustomerId,
      attempt_type: "data_direct",
      status: "pending",
      amount: totalAmount,
      currency: "GHS",
      buyer_type: "guest",
      buyer_phone: normalizedBuyerPhone,
      buyer_email: normalizedEmail,
      affiliate_code: normalizedAffiliate,
      metadata: {
        network,
        items: validatedItems,
        paystack_total: paystackTotal,
        buyer_phone: normalizedBuyerPhone,
        buyer_email: normalizedEmail,
        affiliate_code: normalizedAffiliate,
        refund_momo_number: normalizedRefundMomo,
        type: "data_direct",
      },
      event_log: [{
        type: "pre_checkout",
        source: "guest",
        item_count: validatedItems.length,
        timestamp: new Date().toISOString(),
      }],
    });

    if (insertErr) {
      console.error("[guest-checkout] Failed to create payment_attempt:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to initialize payment" }), { status: 500, headers: h });
    }

    // ── Fetch Paystack public key ─────────────────────────
    const { data: keyRow } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "paystack_public_key")
      .single();

    const paystackPublicKey = keyRow?.value || "";

    // ── Return data for frontend Paystack popup ───────────
    return new Response(JSON.stringify({
      reference,
      amount: totalAmount,
      paystack_total: paystackTotal,
      paystack_amount_kobo: Math.round(paystackTotal * 100),
      paystack_public_key: paystackPublicKey,
      email: normalizedEmail || DEFAULT_PAYSTACK_EMAIL,
      currency: "GHS",
      metadata: {
        type: "data_direct",
        buyer_type: "guest",
        buyer_phone: normalizedBuyerPhone,
        affiliate_code: normalizedAffiliate,
        item_count: validatedItems.length,
      },
    }), { status: 200, headers: h });
  } catch (error) {
    console.error("[guest-checkout] error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: h });
  }
});
