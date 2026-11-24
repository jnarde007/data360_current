
-- Clean up test customer created during onboarding verification
DELETE FROM wallet_transactions WHERE customer_id = 'f6a11360-8063-4e59-a293-d2d652777e44';
DELETE FROM orders WHERE customer_id = 'f6a11360-8063-4e59-a293-d2d652777e44';
DELETE FROM topups WHERE customer_id = 'f6a11360-8063-4e59-a293-d2d652777e44';
DELETE FROM affiliate_withdrawals WHERE customer_id = 'f6a11360-8063-4e59-a293-d2d652777e44';
DELETE FROM customers WHERE id = 'f6a11360-8063-4e59-a293-d2d652777e44';
DELETE FROM profiles WHERE id = 'a4f23ec7-57fb-42ee-9f0b-b65e6d7000f4';
DELETE FROM user_roles WHERE user_id = 'a4f23ec7-57fb-42ee-9f0b-b65e6d7000f4';
