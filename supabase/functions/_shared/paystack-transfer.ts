// Shared helpers for Paystack Transfers (Ghana mobile money)
// All functions operate against api.paystack.co with the secret key from platform_settings.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

export type SupabaseAdmin = ReturnType<typeof createClient>;

export async function getPaystackSecret(supabase: SupabaseAdmin): Promise<string> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "paystack_secret_key")
    .single();
  const key = data?.value;
  if (!key) throw new Error("Paystack secret key not configured");
  return key;
}

// MTN | VOD (Telecel) | ATL (AirtelTigo) — Paystack Ghana mobile money bank codes
export function networkToBankCode(network: string): string {
  switch ((network || "").toUpperCase()) {
    case "MTN": return "MTN";
    case "VOD":
    case "TELECEL": return "VOD";
    case "ATL":
    case "AIRTELTIGO": return "ATL";
    default: return "";
  }
}

export async function ensureRecipient(opts: {
  supabase: SupabaseAdmin;
  secret: string;
  customerId: string;
  network: string;
  momoNumber: string;
  momoName: string;
}): Promise<{ recipient_code: string; cached: boolean; raw?: any }> {
  const { supabase, secret, customerId, network, momoNumber, momoName } = opts;
  const bankCode = networkToBankCode(network);
  if (!bankCode) throw new Error(`Unsupported network: ${network}`);
  const cleaned = momoNumber.replace(/\D/g, "");

  // Check cache
  const { data: cached } = await supabase
    .from("paystack_recipients")
    .select("recipient_code")
    .eq("customer_id", customerId)
    .eq("account_number", cleaned)
    .eq("bank_code", bankCode)
    .eq("active", true)
    .maybeSingle();
  if (cached?.recipient_code) {
    await supabase
      .from("paystack_recipients")
      .update({ last_used_at: new Date().toISOString() })
      .eq("recipient_code", cached.recipient_code);
    return { recipient_code: cached.recipient_code, cached: true };
  }

  // Create new recipient at Paystack
  const res = await fetch("https://api.paystack.co/transferrecipient", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "mobile_money",
      name: momoName || "Customer",
      account_number: cleaned,
      bank_code: bankCode,
      currency: "GHS",
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.status || !json.data?.recipient_code) {
    throw new Error(`Paystack recipient creation failed: ${json.message || res.statusText}`);
  }
  const code = json.data.recipient_code;
  await supabase.from("paystack_recipients").insert({
    customer_id: customerId,
    recipient_type: "mobile_money",
    network: network.toUpperCase(),
    bank_code: bankCode,
    account_number: cleaned,
    account_name: momoName || "Customer",
    recipient_code: code,
    paystack_response: json.data,
    active: true,
    last_used_at: new Date().toISOString(),
  });
  return { recipient_code: code, cached: false, raw: json.data };
}

export async function initiateTransfer(opts: {
  secret: string;
  recipientCode: string;
  amountGHS: number;
  reference: string;
  reason?: string;
}): Promise<{ ok: boolean; data?: any; error?: string }> {
  const res = await fetch("https://api.paystack.co/transfer", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "balance",
      amount: Math.round(opts.amountGHS * 100),
      recipient: opts.recipientCode,
      reference: opts.reference,
      reason: opts.reason || "Payout",
      currency: "GHS",
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.status) {
    return { ok: false, error: json.message || res.statusText, data: json };
  }
  return { ok: true, data: json.data };
}

export async function fetchTransfer(secret: string, transferCode: string): Promise<any> {
  const res = await fetch(`https://api.paystack.co/transfer/${transferCode}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  return await res.json();
}
