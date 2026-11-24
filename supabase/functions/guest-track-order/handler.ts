// Pure handler logic, extracted from index.ts so it can be unit-tested with a mock client.
// The shape mirrors the request/response contract used by the Deno.serve entrypoint.

export interface TrackRequest {
  tracking_token?: string;
  reference?: string;
  short_id?: string;
  buyer_phone?: string;
  phone_only?: boolean;
  store_slug?: string;
}

export interface TrackResponse {
  status: number;
  body: any;
}

export async function handleTrackRequest(supabase: any, req: TrackRequest): Promise<TrackResponse> {
  const { tracking_token, reference, short_id, buyer_phone, phone_only, store_slug } = req;

  const ref = (reference || short_id || "").toString().trim();
  const sid = ref.toUpperCase();
  const normalizedPhone = (buyer_phone || "").toString().replace(/[^0-9]/g, "");
  const token = (tracking_token || "").toString().trim();

  let storeId: string | null = null;
  let resolvedStoreSlug = "";
  if (store_slug) {
    const { data: s } = await supabase.from("stores").select("id").eq("slug", store_slug).maybeSingle();
    if (!s) return { status: 404, body: { error: "Store not found." } };
    storeId = s.id;
    resolvedStoreSlug = store_slug;
  }

  const notFound = (): TrackResponse => ({
    status: 404,
    body: {
      error: storeId
        ? "No matching order found for this store."
        : "Not found. Please check your details and try again.",
    },
  });

  // 1) Token-based lookup
  if (token && token.length >= 20) {
    const single = await lookupByToken(supabase, token);
    if (single && (await belongsToStore(supabase, storeId, single))) return { status: 200, body: await attachStoreContext(supabase, single, resolvedStoreSlug) };
    if (single && storeId) return notFound();
    if (single) return { status: 200, body: await attachStoreContext(supabase, single) };
  }

  // 2) Reference-only lookup (no phone). Accept short_id OR tracking token.
  if (ref && !phone_only && (!normalizedPhone || normalizedPhone.length < 9)) {
    let single = null;
    if (ref.length >= 20) single = await lookupByToken(supabase, ref);
    if (!single) single = await lookupByShortId(supabase, sid);
    if (single && (await belongsToStore(supabase, storeId, single))) return { status: 200, body: await attachStoreContext(supabase, single, resolvedStoreSlug) };
    if (single && storeId) return notFound();
    if (single) return { status: 200, body: await attachStoreContext(supabase, single) };
  }

  // 3) Phone-only lookup → list of recent matches (masked)
  if (phone_only && normalizedPhone && normalizedPhone.length >= 9) {
    const list = storeId
      ? await lookupByPhoneScopedToStore(supabase, normalizedPhone, storeId)
      : await lookupByPhone(supabase, normalizedPhone);
    return { status: 200, body: { kind: "list", results: list } };
  }

  // 4) Legacy: short_id + buyer_phone
  if (sid && normalizedPhone && normalizedPhone.length >= 9) {
    const single = await lookupByShortIdAndPhone(supabase, sid, normalizedPhone);
    if (single && (await belongsToStore(supabase, storeId, single))) return { status: 200, body: await attachStoreContext(supabase, single, resolvedStoreSlug) };
    if (single && storeId) return notFound();
    if (single) return { status: 200, body: await attachStoreContext(supabase, single) };
  }

  return notFound();
}

export async function belongsToStore(supabase: any, storeId: string | null, result: any): Promise<boolean> {
  if (!storeId) return true;
  if (!result) return false;
  if (result.kind === "afa") return false;
  if (result.kind === "order") {
    const { data: o } = await supabase.from("orders").select("id").eq("short_id", result.short_id).maybeSingle();
    if (!o) return false;
    const { data: link } = await supabase
      .from("store_orders")
      .select("id")
      .eq("store_id", storeId)
      .eq("order_id", o.id)
      .maybeSingle();
    return !!link;
  }
  if (result.kind === "checker") {
    const { data: c } = await supabase
      .from("checker_purchases")
      .select("id")
      .eq("short_id", result.short_id)
      .maybeSingle();
    if (!c) return false;
    const { data: link } = await supabase
      .from("store_orders")
      .select("id")
      .eq("store_id", storeId)
      .eq("checker_purchase_id", c.id)
      .maybeSingle();
    return !!link;
  }
  return false;
}

async function attachStoreContext(supabase: any, result: any, knownSlug = "") {
  if (!result || result.kind === "afa") return result;
  if (knownSlug) return { ...result, store_slug: knownSlug };

  let linkQuery = supabase.from("store_orders").select("stores(slug)");
  if (result.kind === "order") {
    const { data: o } = await supabase.from("orders").select("id").eq("short_id", result.short_id).maybeSingle();
    if (!o) return result;
    linkQuery = linkQuery.eq("order_id", o.id);
  } else if (result.kind === "checker") {
    const { data: c } = await supabase.from("checker_purchases").select("id").eq("short_id", result.short_id).maybeSingle();
    if (!c) return result;
    linkQuery = linkQuery.eq("checker_purchase_id", c.id);
  }

  const { data: link } = await linkQuery.maybeSingle();
  const slug = Array.isArray(link?.stores) ? link.stores[0]?.slug : link?.stores?.slug;
  return slug ? { ...result, store_slug: slug } : result;
}

export async function lookupByPhoneScopedToStore(supabase: any, phone: string, storeId: string) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: links } = await supabase
    .from("store_orders")
    .select("order_id, checker_purchase_id, kind, created_at")
    .eq("store_id", storeId)
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(25);

  const orderIds = (links || []).filter((l: any) => l.order_id).map((l: any) => l.order_id);
  const checkerIds = (links || []).filter((l: any) => l.checker_purchase_id).map((l: any) => l.checker_purchase_id);

  const [{ data: orders }, { data: chk }] = await Promise.all([
    orderIds.length
      ? supabase
          .from("orders")
          .select("short_id, total_amount, status, created_at, network, bundle_size, recipient_phone, tracking_token")
          .in("id", orderIds)
          .or(`buyer_phone.eq.${phone},recipient_phone.eq.${phone}`)
      : Promise.resolve({ data: [] }),
    checkerIds.length
      ? supabase
          .from("checker_purchases")
          .select("short_id, amount, status, created_at, sms_phone, tracking_token, checker_products(name, exam_type)")
          .in("id", checkerIds)
          .or(`buyer_phone.eq.${phone},sms_phone.eq.${phone}`)
      : Promise.resolve({ data: [] }),
  ]);

  const results: any[] = [];
  for (const o of orders || []) {
    results.push({
      kind: "order",
      short_id: o.short_id,
      service: `${o.network || "Data"} ${o.bundle_size || ""}`.trim(),
      status: o.status,
      status_label: getOrderLabel(o.status),
      created_at: o.created_at,
      amount: o.total_amount,
      tracking_token: o.tracking_token,
      masked_phone: maskPhone(o.recipient_phone),
    });
  }
  for (const c of chk || []) {
    const p = c.checker_products || {};
    results.push({
      kind: "checker",
      short_id: c.short_id,
      service: p.name || "Result Checker",
      status: c.status,
      status_label: c.status === "completed" ? "Delivered" : c.status,
      created_at: c.created_at,
      amount: c.amount,
      tracking_token: c.tracking_token,
      masked_phone: maskPhone(c.sms_phone),
    });
  }
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return results.slice(0, 25);
}

export async function lookupByToken(supabase: any, token: string) {
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, short_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, grace_period_ends_at, buyer_type, delivery_mode, tracking_token",
    )
    .eq("tracking_token", token)
    .maybeSingle();
  if (order) return shapeOrder(order);

  const { data: afa } = await supabase
    .from("afa_registrations")
    .select(
      "id, short_id, full_name, registration_phone, location, status, total_amount, created_at, tracking_token, payment_method, payment_reference, payment_verified_at, admin_note",
    )
    .eq("tracking_token", token)
    .maybeSingle();
  if (afa) return shapeAfa(afa);

  const { data: chk } = await supabase
    .from("checker_purchases")
    .select(
      "id, short_id, amount, quantity, status, sms_phone, created_at, tracking_token, product_id, checker_products(name, exam_type), checker_inventory(serial_number, pin)",
    )
    .eq("tracking_token", token)
    .maybeSingle();
  if (chk) return shapeChecker(chk);

  return null;
}

export async function lookupByShortId(supabase: any, sid: string) {
  if (sid.startsWith("ORD-") || /^[A-Z0-9]+$/.test(sid)) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, short_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, grace_period_ends_at, buyer_type, delivery_mode, tracking_token",
      )
      .eq("short_id", sid)
      .maybeSingle();
    if (data) return shapeOrder(data);
  }
  if (sid.startsWith("AFA-")) {
    const { data } = await supabase
      .from("afa_registrations")
      .select(
        "id, short_id, full_name, registration_phone, location, status, total_amount, created_at, tracking_token, payment_method, payment_reference, payment_verified_at, admin_note",
      )
      .eq("short_id", sid)
      .maybeSingle();
    if (data) return shapeAfa(data);
  }
  if (sid.startsWith("CHK-")) {
    const { data } = await supabase
      .from("checker_purchases")
      .select(
        "id, short_id, amount, quantity, status, sms_phone, created_at, tracking_token, product_id, checker_products(name, exam_type), checker_inventory(serial_number, pin)",
      )
      .eq("short_id", sid)
      .maybeSingle();
    if (data) return shapeChecker(data);
  }
  return null;
}

export async function lookupByShortIdAndPhone(supabase: any, sid: string, phone: string) {
  if (sid.startsWith("ORD-")) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, short_id, network, bundle_size, recipient_phone, quantity, total_amount, status, created_at, grace_period_ends_at, buyer_type, delivery_mode, tracking_token, buyer_phone",
      )
      .eq("short_id", sid)
      .or(`buyer_phone.eq.${phone},recipient_phone.eq.${phone}`)
      .maybeSingle();
    if (data) return shapeOrder(data);
  }
  if (sid.startsWith("AFA-")) {
    const { data } = await supabase
      .from("afa_registrations")
      .select(
        "id, short_id, full_name, registration_phone, location, status, total_amount, created_at, tracking_token, buyer_phone, payment_method, payment_reference, payment_verified_at, admin_note",
      )
      .eq("short_id", sid)
      .or(`buyer_phone.eq.${phone},registration_phone.eq.${phone}`)
      .maybeSingle();
    if (data) return shapeAfa(data);
  }
  if (sid.startsWith("CHK-")) {
    const { data } = await supabase
      .from("checker_purchases")
      .select(
        "id, short_id, amount, quantity, status, sms_phone, created_at, tracking_token, buyer_phone, product_id, checker_products(name, exam_type), checker_inventory(serial_number, pin)",
      )
      .eq("short_id", sid)
      .or(`buyer_phone.eq.${phone},sms_phone.eq.${phone}`)
      .maybeSingle();
    if (data) return shapeChecker(data);
  }
  return null;
}

export async function lookupByPhone(supabase: any, phone: string) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: orders }, { data: afa }, { data: chk }] = await Promise.all([
    supabase
      .from("orders")
      .select("short_id, total_amount, status, created_at, network, bundle_size, recipient_phone, tracking_token, buyer_phone")
      .or(`buyer_phone.eq.${phone},recipient_phone.eq.${phone}`)
      .gte("created_at", ninetyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("afa_registrations")
      .select("short_id, total_amount, status, created_at, registration_phone, tracking_token, buyer_phone")
      .or(`buyer_phone.eq.${phone},registration_phone.eq.${phone}`)
      .gte("created_at", ninetyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("checker_purchases")
      .select("short_id, amount, status, created_at, sms_phone, tracking_token, buyer_phone, checker_products(name, exam_type)")
      .or(`buyer_phone.eq.${phone},sms_phone.eq.${phone}`)
      .gte("created_at", ninetyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const results: any[] = [];
  for (const o of orders || []) {
    results.push({
      kind: "order",
      short_id: o.short_id,
      service: `${o.network || "Data"} ${o.bundle_size || ""}`.trim(),
      status: o.status,
      status_label: getOrderLabel(o.status),
      created_at: o.created_at,
      amount: o.total_amount,
      tracking_token: o.tracking_token,
      masked_phone: maskPhone(o.recipient_phone),
    });
  }
  for (const a of afa || []) {
    results.push({
      kind: "afa",
      short_id: a.short_id,
      service: "MTN AFA Registration",
      status: a.status,
      status_label: getAfaLabel(a.status),
      created_at: a.created_at,
      amount: a.total_amount,
      tracking_token: a.tracking_token,
      masked_phone: maskPhone(a.registration_phone),
    });
  }
  for (const c of chk || []) {
    const p = c.checker_products || {};
    results.push({
      kind: "checker",
      short_id: c.short_id,
      service: p.name || "Result Checker",
      status: c.status,
      status_label: c.status === "completed" ? "Delivered" : c.status,
      created_at: c.created_at,
      amount: c.amount,
      tracking_token: c.tracking_token,
      masked_phone: maskPhone(c.sms_phone),
    });
  }
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return results.slice(0, 25);
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return phone || "";
  return phone.slice(0, 3) + "****" + phone.slice(-3);
}

function getOrderLabel(s: string) {
  const m: Record<string, string> = {
    pending_confirmation: "Awaiting Processing",
    pending: "Queued for Delivery",
    processing: "Processing",
    delivered: "Delivered",
    failed: "Failed",
    rejected: "Rejected",
    customer_cancelled: "Cancelled",
    cancelled_before_processing: "Cancelled",
  };
  return m[s] || s;
}
function getAfaLabel(s: string) {
  const m: Record<string, string> = {
    submitted: "Submitted",
    processing: "Processing",
    registered: "Registered",
    rejected: "Rejected",
  };
  return m[s] || s;
}

function shapeOrder(o: any) {
  return {
    kind: "order",
    short_id: o.short_id,
    network: o.network,
    bundle_size: o.bundle_size,
    recipient_phone: maskPhone(o.recipient_phone),
    quantity: o.quantity,
    total_amount: o.total_amount,
    status: o.status,
    status_label: getOrderLabel(o.status),
    created_at: o.created_at,
    grace_period_ends_at: o.grace_period_ends_at,
    delivery_mode: o.delivery_mode,
    tracking_token: o.tracking_token,
  };
}

function shapeAfa(a: any) {
  const paymentStatus = a.payment_method === "wallet"
    ? "Paid (Wallet)"
    : a.payment_verified_at || a.payment_reference
      ? "Paid (Paystack)"
      : "Unpaid";
  const paymentLabel = a.payment_method === "wallet"
    ? "Wallet"
    : a.payment_method === "paystack_direct"
      ? "Paystack"
      : (a.payment_method || "—");
  return {
    kind: "afa",
    short_id: a.short_id,
    full_name: a.full_name,
    registration_phone: maskPhone(a.registration_phone),
    location: a.location,
    total_amount: a.total_amount,
    status: a.status,
    status_label: getAfaLabel(a.status),
    created_at: a.created_at,
    tracking_token: a.tracking_token,
    payment_method: paymentLabel,
    payment_status: paymentStatus,
    admin_note: a.admin_note || "",
  };
}

function shapeChecker(c: any) {
  const product = c.checker_products || {};
  const inv = Array.isArray(c.checker_inventory) ? c.checker_inventory : [];
  return {
    kind: "checker",
    short_id: c.short_id,
    product_name: product.name || "Result Checker",
    exam_type: product.exam_type || "",
    quantity: c.quantity,
    total_amount: c.amount,
    status: c.status,
    status_label: c.status === "completed" ? "Delivered" : c.status,
    created_at: c.created_at,
    tracking_token: c.tracking_token,
    codes: inv.map((i: any) => ({ serial_number: i.serial_number, pin: i.pin })),
  };
}
