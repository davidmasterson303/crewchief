-- Remove all existing demo wishlist items (wrong names that don't match knowledge base)
DELETE FROM wishlist_items
WHERE vehicle_id IN (
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003'
);

-- 2018 Honda Accord: names match knowledge base exactly
INSERT INTO wishlist_items (vehicle_id, item_type, item_name, item_identifier, category, source, estimated_cost_parts, estimated_cost_labor, estimated_labor_hours)
VALUES
  -- issue.part = "Oil Dilution (2.0T)"
  ('a1000000-0000-0000-0000-000000000001', 'issue', 'Oil Dilution (2.0T)',
   'dossier:issue:oil_dilution_2_0t_', 'repair', 'dossier', 0, 0, 0),
  -- item.item = "CVT Fluid Flush"
  ('a1000000-0000-0000-0000-000000000001', 'maintenance', 'CVT Fluid Flush',
   'dossier:maintenance:cvt_fluid_flush', 'maintenance', 'dossier', 120, 80, 1),
  -- item.item = "Brake Fluid Flush"
  ('a1000000-0000-0000-0000-000000000001', 'maintenance', 'Brake Fluid Flush',
   'dossier:maintenance:brake_fluid_flush', 'maintenance', 'dossier', 30, 60, 0.5);

-- 2020 Subaru WRX: names match knowledge base exactly
INSERT INTO wishlist_items (vehicle_id, item_type, item_name, item_identifier, category, source, estimated_cost_parts, estimated_cost_labor, estimated_labor_hours)
VALUES
  -- issue.part = "FA20DIT Engine - Rod Bearing Wear"
  ('a2000000-0000-0000-0000-000000000002', 'issue', 'FA20DIT Engine - Rod Bearing Wear',
   'dossier:issue:fa20dit_engine___rod_bearing_wear', 'repair', 'dossier', 250, 800, 8),
  -- issue.part = "Front Strut Mounts"
  ('a2000000-0000-0000-0000-000000000002', 'issue', 'Front Strut Mounts',
   'dossier:issue:front_strut_mounts', 'repair', 'dossier', 180, 240, 2.5),
  -- item.item = "Spark Plugs (NGK Iridium)"
  ('a2000000-0000-0000-0000-000000000002', 'maintenance', 'Spark Plugs (NGK Iridium)',
   'dossier:maintenance:spark_plugs__ngk_iridium_', 'maintenance', 'dossier', 80, 120, 1.5),
  -- item.item = "Brake Fluid Flush (DOT 4)"
  ('a2000000-0000-0000-0000-000000000002', 'maintenance', 'Brake Fluid Flush (DOT 4)',
   'dossier:maintenance:brake_fluid_flush__dot_4_', 'maintenance', 'dossier', 25, 80, 1);

-- 2019 BMW M3: names match knowledge base exactly
INSERT INTO wishlist_items (vehicle_id, item_type, item_name, item_identifier, category, source, estimated_cost_parts, estimated_cost_labor, estimated_labor_hours)
VALUES
  -- issue.part = "S55 Engine - Rod Bearing Wear"
  ('a3000000-0000-0000-0000-000000000003', 'issue', 'S55 Engine - Rod Bearing Wear',
   'dossier:issue:s55_engine___rod_bearing_wear', 'repair', 'dossier', 180, 960, 10),
  -- issue.part = "Water Pump & Thermostat"
  ('a3000000-0000-0000-0000-000000000003', 'issue', 'Water Pump & Thermostat',
   'dossier:issue:water_pump___thermostat', 'repair', 'dossier', 0, 0, 0),
  -- item.item = "Water Pump & Thermostat (proactive)"
  ('a3000000-0000-0000-0000-000000000003', 'maintenance', 'Water Pump & Thermostat (proactive)',
   'dossier:maintenance:water_pump___thermostat__proactive_', 'maintenance', 'dossier', 320, 480, 5),
  -- item.item = "DCT Transmission Fluid"
  ('a3000000-0000-0000-0000-000000000003', 'maintenance', 'DCT Transmission Fluid',
   'dossier:maintenance:dct_transmission_fluid', 'maintenance', 'dossier', 120, 160, 1.5);
