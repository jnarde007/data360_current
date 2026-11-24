-- Fix This Week, Migration 3/3: SECURITY DEFINER function grants audit.
-- Pattern: REVOKE EXECUTE ... FROM PUBLIC, anon for functions that are not
-- intended to be callable by signed-out clients. Authenticated grant is left
-- intact for user-callable functions; service_role bypasses grants.

-- Helpers / triggers
REVOKE EXECUTE ON FUNCTION public._has_active_order_for_recipient(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_customer_sensitive_updates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_customer_financial_fields() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_wallet_transaction_balances() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_email_verified() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_store_order_wallet() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_emit_store_order_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_emit_store_withdrawal_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_emit_wallet_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_store_owner_notify() FROM PUBLIC, anon, authenticated;

-- Notification trigger functions (all trigger-invoked)
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_topup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_admin_order_failure() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_new_support_ticket() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_order_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_support_reply() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_topup_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_wallet_transaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_super_admins(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Affiliate commission credit (called by triggers / edge functions only)
REVOKE EXECUTE ON FUNCTION public.credit_affiliate_commission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_guest_affiliate_commission() FROM PUBLIC, anon, authenticated;

-- Service-only wallet credit (paystack webhook, service_role)
REVOKE EXECUTE ON FUNCTION public.credit_wallet_paystack(uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;

-- Event emission (edge functions only)
REVOKE EXECUTE ON FUNCTION public.emit_event(text, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- pgmq wrappers — service_role only
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- Payouts (admin / service)
REVOKE EXECUTE ON FUNCTION public.apply_payout_failure(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_payout_success(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_payout_processing(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payout_audit(uuid, text, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Admin-only RPCs (signed-in admins only)
REVOKE EXECUTE ON FUNCTION public.admin_approve_payout(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_payout(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_complete_store_withdrawal(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_store_payout(uuid, numeric, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_store(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_customer_referrals(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_referral_leaderboard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_global_store_metrics(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reject_store_withdrawal(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_retry_payout(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_store_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_store_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_store_management_list() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_top_stores(timestamptz, timestamptz, integer) FROM PUBLIC, anon;

-- Diagnostics control surface (admin / super-admin only)
REVOKE EXECUTE ON FUNCTION public.assert_provider_call_allowed(text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_provider_call_attempts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rotate_diagnostics_token() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_diagnostics_window(boolean, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_disable_provider_diagnostics(boolean) FROM PUBLIC, anon;

-- Authenticated-user RPCs (revoke anon only)
REVOKE EXECUTE ON FUNCTION public.cancel_my_order(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.proceed_order_now(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_store(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_customer_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_referral_count() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_referrals() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_store_analytics(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_affiliate_payout(numeric, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_affiliate_withdrawal(numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_store_withdrawal(numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_transaction_pin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_transaction_pin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_store_product(uuid, text, uuid, numeric, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_store_product(uuid, uuid, numeric, boolean) FROM PUBLIC, anon;
