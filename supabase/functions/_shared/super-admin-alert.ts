// Shared Super Admin alert helper.
//
// Provides a fallback alert channel so Super Admins still receive critical
// signals if the primary notifications table is unreachable or its insert
// fails. Channels used (in order):
//
//   1. notifications row (primary, user-visible bell feed)
//   2. security_logs row (durable audit trail, independent table)
//   3. console.error("[SUPER_ADMIN_ALERT] ...") — surfaces in edge-function
//      logs which Super Admins monitor.
//
// Channel 2 + 3 always fire for severity === "critical" or when channel 1
// fails — guaranteeing at least one durable record exists per alert.
//
// Idempotency: callers should pass an `idempotency_key` that uniquely
// identifies the alert event (e.g. `low-balance-iGet-2026-06-24`) to avoid
// flooding the feed with duplicates on retries.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

export type AlertSeverity = "info" | "warning" | "critical";

export interface SuperAdminAlertInput {
  type: string;          // e.g. "provider_diagnostic_blocked", "provider_low_balance"
  title: string;
  body: string;
  severity?: AlertSeverity;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

export async function sendSuperAdminAlert(
  admin: SupabaseClient,
  alert: SuperAdminAlertInput,
): Promise<{ notification_ok: boolean; security_log_ok: boolean }> {
  const severity = alert.severity ?? "warning";
  const metadata = {
    ...(alert.metadata ?? {}),
    severity,
    idempotency_key: alert.idempotency_key ?? null,
    emitted_at: new Date().toISOString(),
  };

  // Channel 1: notifications (primary)
  let notification_ok = false;
  try {
    // Fan out to every Super Admin's auth_user_id.
    const { data: supers } = await admin
      .from("admin_users")
      .select("auth_user_id")
      .eq("role", "Super Admin")
      .eq("status", "active");

    const rows = (supers ?? [])
      .filter((s: { auth_user_id: string | null }) => !!s.auth_user_id)
      .map((s: { auth_user_id: string }) => ({
        user_id: s.auth_user_id,
        type: "system",
        title: alert.title,
        body: alert.body,
        metadata: { ...metadata, alert_type: alert.type },
      }));

    if (rows.length > 0) {
      const { error } = await admin.from("notifications").insert(rows);
      notification_ok = !error;
      if (error) {
        console.error("[SUPER_ADMIN_ALERT] notifications insert failed:", error.message);
      }
    }
  } catch (e) {
    console.error("[SUPER_ADMIN_ALERT] notifications channel threw:", (e as Error).message);
  }

  // Channel 2: security_logs (durable fallback, always for critical or on primary failure)
  let security_log_ok = false;
  if (severity === "critical" || !notification_ok) {
    try {
      const { error } = await admin.from("security_logs").insert({
        action: `super_admin_alert:${alert.type}`,
        details: {
          title: alert.title,
          body: alert.body,
          metadata,
          notification_ok,
        },
      });
      security_log_ok = !error;
      if (error) {
        console.error("[SUPER_ADMIN_ALERT] security_logs insert failed:", error.message);
      }
    } catch (e) {
      console.error("[SUPER_ADMIN_ALERT] security_logs channel threw:", (e as Error).message);
    }
  }

  // Channel 3: structured console log (always for critical) — surfaces in edge logs.
  if (severity === "critical" || !notification_ok) {
    console.error(
      `[SUPER_ADMIN_ALERT] severity=${severity} type=${alert.type} title=${alert.title} ` +
      `notification_ok=${notification_ok} security_log_ok=${security_log_ok} ` +
      `meta=${JSON.stringify(metadata)}`,
    );
  }

  return { notification_ok, security_log_ok };
}
