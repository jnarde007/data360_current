import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  normalizeGhanaPhone, isMtnNumber, mapRemoteStatus, isCacheFresh, type MtnVerifyStatus,
} from "../_shared/mtn-verify.ts";

const CHECK_URL = "https://verify.ghanabundles.shop/check/";
const UA = "Mozilla/5.0 (compatible; DATA360-Verify/1.0)";

const MESSAGES: Record<MtnVerifyStatus, string> = {
  verified: "This MTN number is verified and can receive data.",
  queued: "This number is queued for verification. Check again in 2 minutes. Full MTN verification can take up to 14 days.",
  unverified: "This MTN number is not verified yet, so data may fail. Any failed order is refunded automatically.",
  unavailable: "We couldn't check this number right now. You can still continue.",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

async function remoteCheck(phone: string): Promise<MtnVerifyStatus> {
  try {
    const page = await fetchWithTimeout(CHECK_URL, { headers: { "User-Agent": UA } }, 4000);
    const html = await page.text();
    const csrf = html.match(/name=["']csrf_token["']\s+value=["']([a-f0-9]+)["']/)?.[1];
    const cookie = (page.headers.get("set-cookie") || "").split(";")[0];
    if (!csrf || !cookie) return "unavailable";
    const fd = new URLSearchParams({ csrf_token: csrf, action: "verify", phone });
    const res = await fetchWithTimeout(CHECK_URL, {
      method: "POST",
      body: fd,
      headers: {
        "User-Agent": UA, Cookie: cookie, Referer: CHECK_URL,
        "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded",
      },
    }, 5000);
    const data = await res.json().catch(() => null);
    const item = data?.results?.[0];
    if (!data?.ok || !item || item.status === "error") return "unavailable";
    return mapRemoteStatus(item.status);
  } catch (e) {
    console.warn("[verify-mtn-number] remote check failed:", String(e));
    return "unavailable";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const phone = normalizeGhanaPhone(body?.phone);
  if (!phone) return json({ error: "Enter a valid 10-digit Ghana number" }, 400);
  if (!isMtnNumber(phone)) return json({ error: "This is not an MTN number" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();

  // 1. Cached result (verified numbers never need re-checking).
  const { data: cached } = await supabase
    .from("mtn_number_verifications").select("status, checked_at").eq("phone", phone).maybeSingle();
  if (cached && isCacheFresh(cached.status as MtnVerifyStatus, new Date(cached.checked_at), now)) {
    const s = cached.status as MtnVerifyStatus;
    return json({ phone, status: s, message: MESSAGES[s], cached: true });
  }

  // 2. Number already received a delivered MTN order -> verified for good.
  const { count } = await supabase
    .from("orders").select("id", { count: "exact", head: true })
    .eq("network", "MTN").eq("recipient_phone", phone).eq("status", "delivered");
  let status: MtnVerifyStatus = (count ?? 0) > 0 ? "verified" : await remoteCheck(phone);

  // Never downgrade a number we already know is verified.
  if (cached?.status === "verified") status = "verified";

  if (status !== "unavailable") {
    await supabase.from("mtn_number_verifications").upsert({
      phone, status, message: MESSAGES[status], checked_at: now.toISOString(),
      verified_at: status === "verified" ? now.toISOString() : null,
    });
  }
  return json({ phone, status, message: MESSAGES[status], cached: false });
});
