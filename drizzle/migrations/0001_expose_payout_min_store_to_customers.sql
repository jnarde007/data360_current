-- Expose the store payout minimum as a read-only public setting so the
-- customer-facing Request Payout form mirrors the backend minimum (single
-- source of truth in platform_settings). No payout rules change: the
-- request_store_payout function still validates the authoritative minimum.
DROP POLICY IF EXISTS "Public read safe settings" ON public.platform_settings;

CREATE POLICY "Public read safe settings"
ON public.platform_settings
FOR SELECT
TO anon, authenticated
USING (key = ANY (ARRAY[
  'brand_name'::text,
  'support_whatsapp_url'::text,
  'whatsapp_channel_url'::text,
  'require_admin_approval'::text,
  'require_email_verification'::text,
  'send_email_on_approval'::text,
  'send_email_on_verification'::text,
  'paystack_public_key'::text,
  'affiliate_rate'::text,
  'auto_delivery'::text,
  'notification_sender_name'::text,
  'payout_min_store'::text
]));