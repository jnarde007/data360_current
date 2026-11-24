UPDATE public.platform_settings
SET value = to_jsonb('Store "{store_name}" submitted. We''ll review and notify you once approved. Manage it from My Store.'::text)
WHERE key = 'store_sms_template_store_created';

INSERT INTO public.platform_settings (key, value)
VALUES
  ('store_sms_template_store_approved', to_jsonb('Good news! Your store "{store_name}" has been approved and is live. Share your link: buy-data360.com/store/{slug}'::text)),
  ('store_sms_template_store_rejected', to_jsonb('Your store "{store_name}" was not approved.{reason_suffix} You can create a new store from My Store.'::text))
ON CONFLICT (key) DO NOTHING;