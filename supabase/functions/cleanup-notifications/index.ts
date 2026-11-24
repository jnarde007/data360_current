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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Delete read notifications older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: deletedRead, error: errRead } = await supabase
      .from("notifications")
      .delete()
      .eq("read", true)
      .lt("created_at", thirtyDaysAgo.toISOString())
      .select("id");

    // Delete unread notifications older than 90 days (safety net)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: deletedUnread, error: errUnread } = await supabase
      .from("notifications")
      .delete()
      .eq("read", false)
      .lt("created_at", ninetyDaysAgo.toISOString())
      .select("id");

    if (errRead || errUnread) {
      throw errRead || errUnread;
    }

    return new Response(
      JSON.stringify({
        deleted_read: deletedRead?.length ?? 0,
        deleted_unread: deletedUnread?.length ?? 0,
        cutoff_read: thirtyDaysAgo.toISOString(),
        cutoff_unread: ninetyDaysAgo.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
