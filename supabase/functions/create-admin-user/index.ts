import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify calling user is a super admin
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is Super Admin in admin_users
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerAdmin } = await adminClient
      .from("admin_users")
      .select("role")
      .eq("auth_user_id", caller.id)
      .single();

    if (!callerAdmin || callerAdmin.role !== "Super Admin") {
      return new Response(JSON.stringify({ error: "Only Super Admin can create admins" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name, email, role } = await req.json();
    if (!name || !email) {
      return new Response(JSON.stringify({ error: "Name and email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const defaultPassword = "Admin@1234";

    // Create auth user with is_admin flag so handle_new_user trigger skips customer creation
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: { full_name: name, is_admin: true },
    });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert into admin_users
    const { data: adminData, error: insertError } = await adminClient
      .from("admin_users")
      .insert({
        name,
        email,
        role: role || "Manager",
        auth_user_id: authData.user.id,
      })
      .select()
      .single();

    if (insertError) {
      // Cleanup: delete the auth user if admin_users insert fails
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Add admin role to user_roles
    await adminClient.from("user_roles").insert({
      user_id: authData.user.id,
      role: "admin",
    });

    return new Response(
      JSON.stringify({ admin: adminData, default_password: defaultPassword }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
