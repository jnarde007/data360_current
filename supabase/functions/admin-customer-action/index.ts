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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Parse body first so we can extract auth token from it as fallback
  const body = await req.json();

  // Verify the caller is an admin via their JWT
  // Try Authorization header first, fallback to access_token in body
  // (Supabase relay may strip Authorization header when verify_jwt = false)
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const rawToken = authHeader
    ? authHeader.replace(/^Bearer\s+/i, "").trim()
    : (body.access_token ? String(body.access_token).trim() : null);

  if (!rawToken) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY") || supabaseServiceKey,
    {
      global: { headers: { Authorization: `Bearer ${rawToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(rawToken);
  let callerId = claimsData?.claims?.sub;

  if (claimsErr || !callerId) {
    console.error("admin-customer-action claims verify failed:", claimsErr?.message);
    const { data: userData, error: userErr } = await supabase.auth.getUser(rawToken);
    callerId = userData?.user?.id;

    if (userErr || !callerId) {
      console.error("admin-customer-action token verify failed:", userErr?.message);
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Verify admin status
  const { data: adminRecord } = await supabase
    .from("admin_users")
    .select("id, name, role, status")
    .eq("auth_user_id", callerId)
    .eq("status", "active")
    .maybeSingle();

  if (!adminRecord) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isSuperAdmin = adminRecord.role === "Super Admin";

  try {
    const { action, customer_id } = body;

    if (!action || !customer_id) {
      return new Response(JSON.stringify({ error: "Missing action or customer_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch customer
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .select("id, full_name, wallet_balance, status, total_commission, available_commission")
      .eq("id", customer_id)
      .single();

    if (custErr || !customer) {
      return new Response(JSON.stringify({ error: "Customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: Record<string, unknown> = {};

    // Fetch customer with phone for SMS
    const { data: fullCustomer } = await supabase
      .from("customers")
      .select("phone")
      .eq("id", customer_id)
      .maybeSingle();
    const customerPhone = fullCustomer?.phone || "";

    switch (action) {
      case "credit_wallet":
      case "debit_wallet": {
        // Only Super Admin can credit wallets
        if (action === "credit_wallet" && !isSuperAdmin) {
          return new Response(JSON.stringify({ error: "Only Super Admin can credit wallets" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { amount, reason } = body;
        const numAmount = parseFloat(amount);
        if (!numAmount || numAmount <= 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const isDebit = action === "debit_wallet";
        const currentBalance = Number(customer.wallet_balance);

        if (isDebit && numAmount > currentBalance) {
          return new Response(JSON.stringify({ error: "Insufficient balance" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newBalance = isDebit
          ? currentBalance - numAmount
          : currentBalance + numAmount;

        const { error: updateErr } = await supabase
          .from("customers")
          .update({ wallet_balance: newBalance })
          .eq("id", customer_id);

        if (updateErr) throw updateErr;

        const description = (reason && reason.trim())
          ? reason.trim()
          : `Manual ${isDebit ? "debit" : "credit"} by admin`;

        const txRef = `ADMIN-${Date.now()}`;

        // Record wallet transaction
        const { error: txnErr } = await supabase
          .from("wallet_transactions")
          .insert({
            customer_id,
            type: isDebit ? "debit" : "credit",
            amount: numAmount,
            description,
            reference: txRef,
            admin_id: adminRecord.id,
          });

        if (txnErr) throw txnErr;

        // Record admin activity log
        await supabase.from("admin_activity_logs").insert({
          admin_id: adminRecord.id,
          action: isDebit ? "wallet_debit" : "wallet_credit",
          target_type: "customer",
          target_id: customer_id,
          details: {
            customer_name: customer.full_name,
            amount: numAmount,
            reason: description,
            previous_balance: currentBalance,
            new_balance: newBalance,
          },
        });

        // Send SMS to buyer phone (credit or debit)
        if (customerPhone) {
          const smsMsg = isDebit
            ? `GHS ${numAmount.toFixed(2)} has been deducted from your wallet.\nYour new balance: GHS ${newBalance.toFixed(2)}.`
            : `Your wallet has been credited with GHS ${numAmount.toFixed(2)}.\nYour new balance: GHS ${newBalance.toFixed(2)}.`;
          supabase.functions.invoke("send-sms", {
            body: {
              to: customerPhone,
              message: smsMsg,
              event_type: isDebit ? "manual_debit" : "manual_topup",
              customer_id: customer_id,
              idempotency_key: `${isDebit ? "manual_debit" : "manual_topup"}_${txRef}`,
            },
          }).catch((e: any) => console.error(`Manual ${isDebit ? "debit" : "topup"} SMS error:`, e));
        }

        result = { success: true, new_balance: newBalance };
        break;
      }

      case "set_status": {
        const { status } = body;
        if (!status || !["active", "suspended"].includes(status)) {
          return new Response(JSON.stringify({ error: "Invalid status" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { error: updateErr } = await supabase
          .from("customers")
          .update({ status })
          .eq("id", customer_id);

        if (updateErr) throw updateErr;

        result = { success: true, new_status: status };
        break;
      }

      case "approve": {
        const { error: updateErr } = await supabase
          .from("customers")
          .update({ status: "active" })
          .eq("id", customer_id);

        if (updateErr) throw updateErr;

        result = { success: true, new_status: "active" };
        break;
      }

      case "credit_commission": {
        if (!isSuperAdmin) {
          return new Response(JSON.stringify({ error: "Only Super Admin can credit commissions" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { amount } = body;
        const numAmount = parseFloat(amount);
        if (!numAmount || numAmount <= 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newTotal = Number(customer.total_commission) + numAmount;
        const newAvailable = Number(customer.available_commission) + numAmount;

        const { error: updateErr } = await supabase
          .from("customers")
          .update({ total_commission: newTotal, available_commission: newAvailable })
          .eq("id", customer_id);

        if (updateErr) throw updateErr;

        await supabase.from("admin_activity_logs").insert({
          admin_id: adminRecord.id,
          action: "commission_credit",
          target_type: "customer",
          target_id: customer_id,
          details: {
            customer_name: customer.full_name,
            amount: numAmount,
            previous_total: Number(customer.total_commission),
            new_total: newTotal,
            previous_available: Number(customer.available_commission),
            new_available: newAvailable,
          },
        });

        result = { success: true, new_total: newTotal, new_available: newAvailable };
        break;
      }

      case "deduct_commission": {
        if (!isSuperAdmin) {
          return new Response(JSON.stringify({ error: "Only Super Admin can debit commissions" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { amount } = body;
        const numAmount = parseFloat(amount);
        if (!numAmount || numAmount <= 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const previousAvailable = Number(customer.available_commission);
        const newAvailable = Math.max(0, previousAvailable - numAmount);

        const { error: updateErr } = await supabase
          .from("customers")
          .update({ available_commission: newAvailable })
          .eq("id", customer_id);

        if (updateErr) throw updateErr;

        await supabase.from("admin_activity_logs").insert({
          admin_id: adminRecord.id,
          action: "commission_debit",
          target_type: "customer",
          target_id: customer_id,
          details: {
            customer_name: customer.full_name,
            amount: numAmount,
            previous_available: previousAvailable,
            new_available: newAvailable,
          },
        });

        result = { success: true, new_available: newAvailable };
        break;
      }

      case "refund_commission": {
        const { amount } = body;
        const numAmount = parseFloat(amount);
        if (!numAmount || numAmount <= 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newAvailableRefund = Number(customer.available_commission) + numAmount;

        const { error: updateErr } = await supabase
          .from("customers")
          .update({ available_commission: newAvailableRefund })
          .eq("id", customer_id);

        if (updateErr) throw updateErr;

        result = { success: true, new_available: newAvailableRefund };
        break;
      }

      case "pay_withdrawal_to_wallet": {
        const { withdrawal_id } = body;
        if (!withdrawal_id) {
          return new Response(JSON.stringify({ error: "Missing withdrawal_id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Load withdrawal
        const { data: withdrawal, error: wErr } = await supabase
          .from("affiliate_withdrawals")
          .select("id, customer_id, amount, status")
          .eq("id", withdrawal_id)
          .maybeSingle();

        if (wErr || !withdrawal) {
          return new Response(JSON.stringify({ error: "Withdrawal not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (withdrawal.customer_id !== customer_id) {
          return new Response(JSON.stringify({ error: "Withdrawal does not belong to this customer" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (withdrawal.status === "paid" || withdrawal.status === "settled") {
          return new Response(
            JSON.stringify({ success: true, already_paid: true, message: "This commission has already been credited to the wallet." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (withdrawal.status === "rejected") {
          return new Response(JSON.stringify({ error: "Cannot pay a rejected withdrawal" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const payAmount = Number(withdrawal.amount);
        if (!payAmount || payAmount <= 0) {
          return new Response(JSON.stringify({ error: "Invalid withdrawal amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const walletRef = `AFF-COM-${withdrawal_id}`;

        // Idempotency: check if a wallet_transaction with this reference already exists
        const { data: existingTxn } = await supabase
          .from("wallet_transactions")
          .select("id")
          .eq("reference", walletRef)
          .eq("type", "credit")
          .maybeSingle();

        if (existingTxn) {
          // Ensure withdrawal status is consistent
          await supabase
            .from("affiliate_withdrawals")
            .update({
              status: "paid",
              processed_at: new Date().toISOString(),
              processed_by: adminRecord.id,
            })
            .eq("id", withdrawal_id)
            .neq("status", "paid");

          return new Response(
            JSON.stringify({ success: true, already_paid: true, message: "This commission has already been credited to the wallet." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Credit the wallet balance
        const prevBalance = Number(customer.wallet_balance);
        const newBalance = prevBalance + payAmount;

        const { error: balErr } = await supabase
          .from("customers")
          .update({ wallet_balance: newBalance })
          .eq("id", customer_id);
        if (balErr) throw balErr;

        // Insert wallet transaction (unique reference prevents double-credit under race)
        const { error: txnErr } = await supabase
          .from("wallet_transactions")
          .insert({
            customer_id,
            type: "credit",
            amount: payAmount,
            description: "Affiliate commission credited to wallet",
            reference: walletRef,
            admin_id: adminRecord.id,
          });

        if (txnErr) {
          // Rollback balance if insert fails (e.g. unique violation race)
          await supabase
            .from("customers")
            .update({ wallet_balance: prevBalance })
            .eq("id", customer_id);
          throw txnErr;
        }

        // Mark withdrawal as paid
        await supabase
          .from("affiliate_withdrawals")
          .update({
            status: "paid",
            processed_at: new Date().toISOString(),
            processed_by: adminRecord.id,
            admin_note: (body.admin_note && String(body.admin_note).trim())
              ? String(body.admin_note).trim()
              : "Paid to customer wallet",
          })
          .eq("id", withdrawal_id);

        // Audit log
        await supabase.from("admin_activity_logs").insert({
          admin_id: adminRecord.id,
          action: "affiliate_commission_paid_to_wallet",
          target_type: "customer",
          target_id: customer_id,
          details: {
            customer_name: customer.full_name,
            withdrawal_id,
            amount: payAmount,
            previous_balance: prevBalance,
            new_balance: newBalance,
            reference: walletRef,
          },
        });

        // SMS notification (idempotent via key)
        if (customerPhone) {
          const smsMsg = `You have received GHS ${payAmount.toFixed(2)} commission in your wallet.\nNew balance: GHS ${newBalance.toFixed(2)}.`;
          supabase.functions.invoke("send-sms", {
            body: {
              to: customerPhone,
              message: smsMsg,
              event_type: "affiliate_commission_payout",
              customer_id,
              idempotency_key: `affiliate_commission_${withdrawal_id}`,
            },
          }).catch((e: any) => console.error("Affiliate commission payout SMS error:", e));
        }

        result = { success: true, new_balance: newBalance, amount: payAmount, reference: walletRef };
        break;
      }

      case "reverse_commission": {
        if (!isSuperAdmin) {
          return new Response(JSON.stringify({ error: "Only Super Admin can reverse commission earnings" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { amount, reason } = body;
        const numAmount = parseFloat(amount);
        if (!numAmount || numAmount <= 0) {
          return new Response(JSON.stringify({ error: "Invalid amount" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const prevTotal = Number(customer.total_commission);
        const prevAvailable = Number(customer.available_commission);
        const newTotal = Math.max(0, prevTotal - numAmount);
        const newAvailable = Math.min(prevAvailable, newTotal);

        const { error: updateErr } = await supabase
          .from("customers")
          .update({ total_commission: newTotal, available_commission: newAvailable })
          .eq("id", customer_id);

        if (updateErr) throw updateErr;

        await supabase.from("admin_activity_logs").insert({
          admin_id: adminRecord.id,
          action: "commission_reversal",
          target_type: "customer",
          target_id: customer_id,
          details: {
            customer_name: customer.full_name,
            amount: numAmount,
            reason: (reason && reason.trim()) ? reason.trim() : "Commission reversal by admin",
            previous_total: prevTotal,
            new_total: newTotal,
            previous_available: prevAvailable,
            new_available: newAvailable,
          },
        });

        result = { success: true, new_total: newTotal, new_available: newAvailable };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("admin-customer-action error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
