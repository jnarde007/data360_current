import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ARCHIVED_STATUSES = new Set(["deleted", "archived"]);

type CustomerRecord = {
  id: string;
  auth_user_id: string | null;
  email: string;
  phone: string;
  full_name: string;
  status: string;
  deleted_at: string | null;
  anonymized_at?: string | null;
};

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizePhone = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";

const isArchived = (customer: { status?: string | null; deleted_at?: string | null }) => {
  const status = (customer.status || "").toLowerCase();
  return ARCHIVED_STATUSES.has(status) || !!customer.deleted_at;
};

// deno-lint-ignore no-explicit-any
async function findAuthUsersByEmail(adminClient: any, email: string) {
  const matches: Array<{ id: string; email: string | null }> = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data.users || [];
    for (const user of users) {
      if ((user.email || "").toLowerCase() === email) {
        matches.push({ id: user.id, email: user.email || null });
      }
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return matches;
}

// deno-lint-ignore no-explicit-any
async function anonymizeDeletedCustomer(adminClient: any, customer: CustomerRecord) {
  const now = new Date().toISOString();
  const suffix = customer.id.slice(0, 8);

  const payload = {
    status: "deleted",
    full_name: `Deleted User ${suffix}`,
    email: customer.email.startsWith("deleted_") ? customer.email : `deleted_${suffix}@removed.local`,
    phone: "",
    transaction_pin_hash: null,
    deleted_at: customer.deleted_at ?? now,
    anonymized_at: customer.anonymized_at ?? now,
    auth_user_id: null,
  };

  const { error } = await adminClient.from("customers").update(payload).eq("id", customer.id);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);

    if (!email && !phone) {
      return new Response(JSON.stringify({ blocked: true, message: "Email or phone is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (email) {
      const { data: activeEmail } = await adminClient
        .from("customers")
        .select("id")
        .eq("email", email)
        .not("status", "in", '("deleted","archived")')
        .is("deleted_at", null)
        .maybeSingle();

      if (activeEmail) {
        return new Response(
          JSON.stringify({ blocked: true, message: "An active account with this email already exists." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (phone) {
      const { data: activePhone } = await adminClient
        .from("customers")
        .select("id")
        .eq("phone", phone)
        .not("status", "in", '("deleted","archived")')
        .is("deleted_at", null)
        .maybeSingle();

      if (activePhone) {
        return new Response(
          JSON.stringify({ blocked: true, message: "An active account with this phone number already exists." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const matchedCustomers: CustomerRecord[] = [];

    if (email) {
      const { data } = await adminClient
        .from("customers")
        .select("id, auth_user_id, email, phone, full_name, status, deleted_at, anonymized_at")
        .eq("email", email);
      matchedCustomers.push(...(data || []));
    }

    if (phone) {
      const { data } = await adminClient
        .from("customers")
        .select("id, auth_user_id, email, phone, full_name, status, deleted_at, anonymized_at")
        .eq("phone", phone);
      matchedCustomers.push(...(data || []));
    }

    const byId = new Map<string, CustomerRecord>();
    for (const customer of matchedCustomers) byId.set(customer.id, customer);

    const archivedCustomers = [...byId.values()].filter((c) => isArchived(c));
    const authIdsToDelete = new Set<string>();

    for (const customer of archivedCustomers) {
      if (customer.auth_user_id) authIdsToDelete.add(customer.auth_user_id);
      await anonymizeDeletedCustomer(adminClient, customer);
    }

    if (email) {
      const authMatches = await findAuthUsersByEmail(adminClient, email);
      for (const authUser of authMatches) {
        const { data: adminRecord } = await adminClient
          .from("admin_users")
          .select("id")
          .eq("auth_user_id", authUser.id)
          .maybeSingle();

        if (adminRecord) {
          return new Response(
            JSON.stringify({ blocked: true, message: "This email is reserved by an admin account." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { data: linkedCustomer } = await adminClient
          .from("customers")
          .select("id, auth_user_id, email, phone, full_name, status, deleted_at, anonymized_at")
          .eq("auth_user_id", authUser.id)
          .maybeSingle();

        if (linkedCustomer && !isArchived(linkedCustomer)) {
          return new Response(
            JSON.stringify({ blocked: true, message: "An active account with this email already exists." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (linkedCustomer && isArchived(linkedCustomer)) {
          await anonymizeDeletedCustomer(adminClient, linkedCustomer);
        }

        authIdsToDelete.add(authUser.id);
      }
    }

    const deletedAuthIds: string[] = [];

    for (const authUserId of authIdsToDelete) {
      await adminClient.from("profiles").delete().eq("id", authUserId);
      await adminClient.from("user_roles").delete().eq("user_id", authUserId);

      const { error } = await adminClient.auth.admin.deleteUser(authUserId);
      if (!error) deletedAuthIds.push(authUserId);
    }

    return new Response(
      JSON.stringify({
        blocked: false,
        repaired: true,
        deleted_auth_users: deletedAuthIds.length,
        anonymized_customers: archivedCustomers.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("repair-signup-blockers error", err);
    return new Response(JSON.stringify({ blocked: false, error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
