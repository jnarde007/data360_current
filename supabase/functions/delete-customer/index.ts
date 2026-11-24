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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse body first to extract auth token fallback
    const body = await req.json();

    // Try Authorization header first, fallback to access_token in body
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const accessToken = authHeader || (body.access_token ? `Bearer ${body.access_token}` : null);

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: accessToken } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();

    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is admin
    const { data: adminRecord } = await supabase
      .from("admin_users")
      .select("id")
      .eq("auth_user_id", caller.id)
      .eq("status", "active")
      .maybeSingle();

    if (!adminRecord) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { customer_id } = body;
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "customer_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the customer record
    const { data: customer } = await supabase
      .from("customers")
      .select("id, auth_user_id, full_name, email, phone")
      .eq("id", customer_id)
      .maybeSingle();

    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const anonymizedSuffix = customer_id.substring(0, 8);

    // Soft-delete: anonymize PII, set status to deleted, preserve transaction history
    const { error: updateError } = await supabase
      .from("customers")
      .update({
        status: "deleted",
        full_name: `Deleted User ${anonymizedSuffix}`,
        email: `deleted_${anonymizedSuffix}@removed.local`,
        phone: "",
        transaction_pin_hash: null,
        auth_user_id: null,
        deleted_at: now,
        anonymized_at: now,
      })
      .eq("id", customer_id);

    if (updateError) {
      console.error("Failed to soft-delete customer:", updateError);
      return new Response(JSON.stringify({ error: "Failed to archive customer" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("affiliate_withdrawals")
      .update({ customer_id: customer_id })
      .eq("customer_id", customer_id);

    if (customer.auth_user_id) {
      await supabase
        .from("profiles")
        .update({ full_name: `Deleted User ${anonymizedSuffix}`, email: "", phone: "" })
        .eq("id", customer.auth_user_id);

      await supabase.from("user_roles").delete().eq("user_id", customer.auth_user_id);

      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(customer.auth_user_id);
      if (authDeleteError) {
        console.error("Failed to delete auth user:", authDeleteError);
      }
    }

    await supabase.from("admin_activity_logs").insert({
      admin_id: adminRecord.id,
      action: "customer_deleted",
      target_type: "customer",
      target_id: customer_id,
      details: { original_name: customer.full_name, original_email: customer.email, method: "soft_delete" },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
