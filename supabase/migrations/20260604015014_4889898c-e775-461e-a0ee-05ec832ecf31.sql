
INSERT INTO public.platform_settings(key, value) VALUES
('store_sms_template_store_created', 'Your store "{store_name}" is live on Data360. Share your link: buy-data360.com/store/{slug}. Manage it from My Store.'),
('store_sms_template_store_new_order', 'New sale on "{store_name}"! Order {short_id} - GHS {amount}. Profit GHS {profit} will move to available once delivered.'),
('store_sms_template_store_profit_available', 'GHS {profit} profit is now available in your store wallet from order {short_id}. Withdraw anytime from My Store.'),
('store_sms_template_store_withdrawal_requested', 'Withdrawal request received: GHS {amount} to {momo_number}. We''ll notify you when it''s paid.'),
('store_sms_template_store_withdrawal_paid', 'You have received GHS {amount} from your store wallet, paid to {momo_number}. {paystack_reference_suffix}')
ON CONFLICT (key) DO NOTHING;
