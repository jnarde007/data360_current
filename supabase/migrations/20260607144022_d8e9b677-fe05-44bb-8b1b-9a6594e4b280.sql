UPDATE public.platform_settings
SET value = to_jsonb('Your store "{store_name}" has been successfully submitted and is now under review. We''ll notify you once it is approved. You can manage your store anytime in "My Store"."'::text)
WHERE key = 'store_sms_template_store_created';

UPDATE public.platform_settings
SET value = to_jsonb('Great news! Your store "{store_name}" has been approved and is now live. You can now manage and update your store anytime in "My Store"."'::text)
WHERE key = 'store_sms_template_store_approved';

UPDATE public.platform_settings
SET value = to_jsonb('Your store "{store_name}" was not approved after review. You can update your details and resubmit your store anytime in "My Store"."'::text)
WHERE key = 'store_sms_template_store_rejected';