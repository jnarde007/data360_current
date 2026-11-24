import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ allowed: false, message: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: adminRecord } = await adminClient
      .from("admin_users")
      .select("status")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (!adminRecord) {
      return new Response(
        JSON.stringify({ allowed: false, message: "You are not an admin user" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (adminRecord.status === "suspended") {
      return new Response(
        JSON.stringify({ allowed: false, message: "Your admin account has been suspended" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ allowed: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-admin-login error:", err);
    return new Response(
      JSON.stringify({ allowed: false, message: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
