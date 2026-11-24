
-- Update AirtelTigo network_api_configs to use the same iGet provider as Telecel
UPDATE network_api_configs
SET 
  api_base_url = 'https://iget.onrender.com',
  api_key = (SELECT api_key FROM network_api_configs WHERE network = 'Telecel'),
  enabled = true,
  available_for_purchase = true,
  extra_params = '{"provider": "iGet", "bundle_type": "AT-5959"}'::jsonb,
  updated_at = now()
WHERE network = 'AirtelTigo';

-- Add AirtelTigo pricing (same structure as Telecel, admin can adjust prices later)
INSERT INTO price_items (network, product, size, price, cost_price) VALUES
  ('AirtelTigo', 'Data', '1GB', 5.00, 3.50),
  ('AirtelTigo', 'Data', '2GB', 10.00, 7.00),
  ('AirtelTigo', 'Data', '5GB', 20.00, 16.70),
  ('AirtelTigo', 'Data', '10GB', 40.00, 33.40),
  ('AirtelTigo', 'Data', '15GB', 60.00, 50.50),
  ('AirtelTigo', 'Data', '20GB', 80.00, 66.80),
  ('AirtelTigo', 'Data', '25GB', 100.00, 83.50),
  ('AirtelTigo', 'Data', '30GB', 120.00, 100.20),
  ('AirtelTigo', 'Data', '40GB', 150.00, 133.60),
  ('AirtelTigo', 'Data', '50GB', 180.00, 167.00),
  ('AirtelTigo', 'Data', '100GB', 350.00, 334.00)
ON CONFLICT DO NOTHING;
