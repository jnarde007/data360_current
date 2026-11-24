
-- Clean up test users for re-testing
DELETE FROM wallet_transactions WHERE customer_id IN (SELECT id FROM customers WHERE email IN ('testoffmode@data360test.com', 'testonmode@data360test.com'));
DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE email IN ('testoffmode@data360test.com', 'testonmode@data360test.com'));
DELETE FROM topups WHERE customer_id IN (SELECT id FROM customers WHERE email IN ('testoffmode@data360test.com', 'testonmode@data360test.com'));
DELETE FROM affiliate_withdrawals WHERE customer_id IN (SELECT id FROM customers WHERE email IN ('testoffmode@data360test.com', 'testonmode@data360test.com'));
DELETE FROM user_roles WHERE user_id IN (SELECT auth_user_id FROM customers WHERE email IN ('testoffmode@data360test.com', 'testonmode@data360test.com'));
DELETE FROM profiles WHERE id IN (SELECT auth_user_id FROM customers WHERE email IN ('testoffmode@data360test.com', 'testonmode@data360test.com'));
DELETE FROM customers WHERE email IN ('testoffmode@data360test.com', 'testonmode@data360test.com');
