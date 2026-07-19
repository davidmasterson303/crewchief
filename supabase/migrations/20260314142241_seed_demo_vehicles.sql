/*
  # Seed Demo Vehicles and Related Data

  Creates 3 demo vehicles with realistic mock data:
    1. 2018 Honda Accord (daily driver, maintenance-focused, ~95k miles)
    2. 2020 Subaru WRX (performance/mod-oriented, ~41k miles)
    3. 2019 BMW M3 (enthusiast, health alerts, ~67k miles)

  All demo vehicles use is_demo = true for easy identification.
  Uses WHERE NOT EXISTS guards since some child tables lack unique constraints.
*/

DO $$
DECLARE
  v1_id uuid := 'a1000000-0000-0000-0000-000000000001'::uuid;
  v2_id uuid := 'a2000000-0000-0000-0000-000000000002'::uuid;
  v3_id uuid := 'a3000000-0000-0000-0000-000000000003'::uuid;
  doc1_id uuid := 'd1000000-0000-0000-0000-000000000001'::uuid;
  doc2_id uuid := 'd2000000-0000-0000-0000-000000000002'::uuid;
  doc3_id uuid := 'd3000000-0000-0000-0000-000000000003'::uuid;
  doc4_id uuid := 'd4000000-0000-0000-0000-000000000004'::uuid;
  doc5_id uuid := 'd5000000-0000-0000-0000-000000000005'::uuid;
  session1_id uuid := 'e1000000-0000-0000-0000-000000000001'::uuid;
  session2_id uuid := 'e2000000-0000-0000-0000-000000000002'::uuid;
  session3_id uuid := 'e3000000-0000-0000-0000-000000000003'::uuid;
BEGIN

  -- VEHICLE 1: 2018 Honda Accord
  INSERT INTO vehicles (id, vin, year, make, model, trim, color, current_mileage, ownership_objective, usage_profile, avg_miles_per_month, performance_mindedness, driving_style, performance_goal, image_url, is_demo, stock_hp, stock_torque, stock_zero_to_sixty)
  VALUES (v1_id,'DEMO1HGCV1F30JA000001',2018,'Honda','Accord','Sport 2.0T','Sonic Gray Pearl',94800,'Keep this car running reliably for another 100k miles with minimal surprises.','Daily commuter. Highway-heavy. About 1,600 miles/month mostly on the interstate.',1600,'mild','Relaxed highway cruiser, occasional spirited weekend drive','mild','https://images.pexels.com/photos/19316798/pexels-photo-19316798.jpeg?auto=compress&cs=tinysrgb&w=800',true,192,192,6.2)
  ON CONFLICT (id) DO NOTHING;

  -- VEHICLE 2: 2020 Subaru WRX
  INSERT INTO vehicles (id, vin, year, make, model, trim, color, current_mileage, ownership_objective, usage_profile, avg_miles_per_month, performance_mindedness, driving_style, performance_goal, image_url, is_demo, stock_hp, stock_torque, stock_zero_to_sixty, modified_hp, modified_torque)
  VALUES (v2_id,'DEMO2JF1VA1G60L9000002',2020,'Subaru','WRX','Base','World Rally Blue',41200,'Stage 1 tune + handling upgrades. Want a fun canyon carver that still works daily.','Daily driver but I take it out on canyon roads every weekend.',1200,'aggressive','Spirited canyon runs, occasional track day','aggressive','https://images.pexels.com/photos/16685589/pexels-photo-16685589.jpeg?auto=compress&cs=tinysrgb&w=800',true,268,258,5.4,305,290)
  ON CONFLICT (id) DO NOTHING;

  -- VEHICLE 3: 2019 BMW M3
  INSERT INTO vehicles (id, vin, year, make, model, trim, color, current_mileage, ownership_objective, usage_profile, avg_miles_per_month, performance_mindedness, driving_style, performance_goal, image_url, is_demo, stock_hp, stock_torque, stock_zero_to_sixty)
  VALUES (v3_id,'DEMO3WBS8M9C55J5000003',2019,'BMW','M3','Competition','Mineral Grey Metallic',67400,'Keep it maintained properly. Getting to higher mileage and need to stay ahead of things.','Weekend driver + occasional track days. Low daily miles but spirited use.',900,'aggressive','Track-oriented, high-performance driving','moderate','https://images.pexels.com/photos/12330349/pexels-photo-12330349.jpeg?auto=compress&cs=tinysrgb&w=800',true,444,406,3.9)
  ON CONFLICT (id) DO NOTHING;

  -- KNOWLEDGE BASE (guarded with WHERE NOT EXISTS)
  IF NOT EXISTS (SELECT 1 FROM vehicle_knowledge_base WHERE vehicle_id = v1_id) THEN
    INSERT INTO vehicle_knowledge_base (vehicle_id, known_issues, maintenance_schedule, fluid_specs, common_mods, interesting_facts, reliability_score, research_status, engine_type, transmission_type, drivetrain)
    VALUES (v1_id,
      '[{"part":"10th Gen CVT Transmission","mileage_range":"80,000-120,000 mi","severity":"Medium","description":"CVT fluid degradation leads to hesitation and hunting. Honda recommends flush every 30k, most owners skip it."},{"part":"Oil Dilution (2.0T)","mileage_range":"Any mileage","severity":"High","description":"Known fuel dilution issue in the 2.0T engine. Short trips and cold climates worsen it. Check dipstick for fuel smell."},{"part":"Infotainment System","mileage_range":"50,000+ mi","severity":"Low","description":"Android Auto/CarPlay connectivity issues. Software updates usually resolve."},{"part":"Brake Dust Shields","mileage_range":"60,000+ mi","severity":"Low","description":"Rear brake dust shields can rattle and contact the rotor. Easy fix with a bend or replacement."}]'::jsonb,
      '[{"item":"Engine Oil (0W-20 Full Synthetic)","interval":"5,000-7,500 mi","priority":"Critical"},{"item":"CVT Fluid Flush","interval":"30,000 mi","priority":"Critical"},{"item":"Air Filter","interval":"30,000 mi","priority":"Recommended"},{"item":"Cabin Air Filter","interval":"15,000 mi","priority":"Recommended"},{"item":"Spark Plugs","interval":"100,000 mi","priority":"Recommended"},{"item":"Brake Fluid Flush","interval":"3 years","priority":"Recommended"},{"item":"Tire Rotation","interval":"7,500 mi","priority":"Critical"}]'::jsonb,
      '{"engine_oil":"0W-20 Full Synthetic","transmission_fluid":"Honda HCF-2 CVT Fluid","coolant":"Honda Blue Type 2 (50/50 premix)","brake_fluid":"DOT 3 or DOT 4"}'::jsonb,
      '[{"name":"K&N Drop-in Air Filter","purpose":"Modest airflow improvement, reusable","difficulty":"Easy"},{"name":"Exhaust Tip Upgrade","purpose":"Cosmetic enhancement","difficulty":"Easy"},{"name":"Lowering Springs","purpose":"Handling improvement, lower stance","difficulty":"Moderate"}]'::jsonb,
      ARRAY['The 2018 Accord was completely redesigned and won multiple Car of the Year awards.','The 2.0T Sport shares its engine with the Civic Type R, detuned for comfort.','Honda Sensing suite was standard on all Sport trims.'],
      8,'completed','Turbocharged 2.0L 4-cylinder','CVT','FWD');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicle_knowledge_base WHERE vehicle_id = v2_id) THEN
    INSERT INTO vehicle_knowledge_base (vehicle_id, known_issues, maintenance_schedule, fluid_specs, common_mods, interesting_facts, reliability_score, research_status, engine_type, transmission_type, drivetrain)
    VALUES (v2_id,
      '[{"part":"FA20DIT Engine - Rod Bearing Wear","mileage_range":"50,000-80,000 mi","severity":"High","description":"Known rod bearing wear, especially with aggressive driving. ARP rod bolts and bearing inspection strongly recommended at 60k."},{"part":"Front Strut Mounts","mileage_range":"40,000-60,000 mi","severity":"Medium","description":"OEM strut mounts wear quickly under spirited driving. Clicking/clunking from front suspension is the telltale sign."},{"part":"Clutch Chatter (6MT)","mileage_range":"20,000-40,000 mi","severity":"Medium","description":"Clutch chatter and grabbiness during cold engagement is common. Usually improves with warmup."},{"part":"Differential Fluid","mileage_range":"15,000+ mi","severity":"Medium","description":"OEM diff fluid breaks down quickly under aggressive use. 15k change intervals recommended."}]'::jsonb,
      '[{"item":"Engine Oil (5W-30 Full Synthetic)","interval":"3,000-5,000 mi (aggressive driving)","priority":"Critical"},{"item":"Spark Plugs (NGK Iridium)","interval":"30,000 mi","priority":"Critical"},{"item":"Diff Fluid (Front + Rear)","interval":"15,000 mi","priority":"Critical"},{"item":"Coolant Flush","interval":"30,000 mi","priority":"Recommended"},{"item":"Brake Fluid Flush (DOT 4)","interval":"2 years / before track day","priority":"Critical"},{"item":"Air Filter","interval":"15,000 mi","priority":"Recommended"},{"item":"Transmission Fluid","interval":"30,000 mi","priority":"Recommended"}]'::jsonb,
      '{"engine_oil":"5W-30 Full Synthetic (Motul 8100 recommended)","transmission_fluid":"Subaru Gear Oil GL-5 75W-90","coolant":"Subaru Super Coolant (Blue)","brake_fluid":"DOT 4 (Motul RBF 600 for track use)"}'::jsonb,
      '[{"name":"COBB Accessport Stage 1 Tune","purpose":"+40 WHP on stock airbox, best bang/buck upgrade","difficulty":"Easy"},{"name":"Grimmspeed Downpipe","purpose":"Reduces exhaust backpressure, needed for Stage 2","difficulty":"Moderate"},{"name":"STI Brembo Big Brake Kit","purpose":"Significant brake upgrade for track use","difficulty":"Moderate"},{"name":"Whiteline Sway Bars (F+R)","purpose":"Reduces body roll, improves corner exit","difficulty":"Moderate"},{"name":"ARP Rod Bolts","purpose":"Insurance against rod bearing failure under boost","difficulty":"Hard"}]'::jsonb,
      ARRAY['The WRX FA20DIT makes 268hp but routinely sees 290+ WHP on a simple Stage 1 tune.','World Rally Blue is an iconic Subaru color dating back to the 2001 WRC championship cars.','The WRX uses a symmetrical AWD system that actively varies torque front-to-rear.'],
      6,'completed','Turbocharged FA20DIT 2.0L Boxer 4-cylinder','6-speed Manual','AWD (Symmetrical)');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicle_knowledge_base WHERE vehicle_id = v3_id) THEN
    INSERT INTO vehicle_knowledge_base (vehicle_id, known_issues, maintenance_schedule, fluid_specs, common_mods, interesting_facts, reliability_score, research_status, engine_type, transmission_type, drivetrain)
    VALUES (v3_id,
      '[{"part":"S55 Engine - Rod Bearing Wear","mileage_range":"60,000-80,000 mi","severity":"High","description":"The S55 has documented rod bearing wear at higher mileage. Inspection is strongly recommended. Catch it early and it is a straightforward fix."},{"part":"Water Pump & Thermostat","mileage_range":"60,000-80,000 mi","severity":"High","description":"The electric water pump is a known failure point. Proactive replacement at 60k is widely recommended in the M community."},{"part":"VANOS Solenoids","mileage_range":"60,000+ mi","severity":"Medium","description":"VANOS solenoids can get sluggish with age. Rough cold starts and slight power loss at low RPM are the symptoms."},{"part":"Exhaust Manifold Studs","mileage_range":"Any mileage","severity":"Medium","description":"Exhaust manifold studs can snap over time due to heat cycling. Listen for ticking from the engine bay."},{"part":"DCT Transmission Fluid","mileage_range":"40,000+ mi","severity":"Medium","description":"BMW says DCT fluid is lifetime. It is not. 40k change intervals are strongly advised."}]'::jsonb,
      '[{"item":"Engine Oil (0W-30 or 0W-40 Full Synthetic)","interval":"5,000-7,500 mi (or OLM)","priority":"Critical"},{"item":"Water Pump & Thermostat (proactive)","interval":"60,000 mi","priority":"Critical"},{"item":"DCT Transmission Fluid","interval":"40,000 mi","priority":"Critical"},{"item":"Spark Plugs","interval":"40,000 mi (NGK Iridium)","priority":"Critical"},{"item":"Brake Fluid (DOT 4)","interval":"2 years","priority":"Recommended"},{"item":"Differential Fluid","interval":"40,000 mi","priority":"Recommended"},{"item":"Cabin + Engine Air Filters","interval":"20,000 mi","priority":"Recommended"}]'::jsonb,
      '{"engine_oil":"0W-30 or 0W-40 Full Synthetic (BMW LL-01 spec)","transmission_fluid":"BMW MTF LT-5 or equivalent","coolant":"BMW Coolant (Blue, 50/50)","brake_fluid":"DOT 4 (Castrol SRF or Motul RBF600 for track)"}'::jsonb,
      '[{"name":"Burger Motorsports JB4 Tune","purpose":"Safe +60 WHP on stock hardware, piggyback ECU","difficulty":"Easy"},{"name":"Eventuri Carbon Intake","purpose":"Significant airflow improvement + aggressive sound","difficulty":"Easy"},{"name":"Eisenmann Race Exhaust","purpose":"Valved exhaust, full M sound at WOT","difficulty":"Moderate"},{"name":"AP Racing Big Brake Kit (BBK)","purpose":"Required for serious track use at this power level","difficulty":"Hard"}]'::jsonb,
      ARRAY['The F80 M3 Competition uses a twin-turbocharged S55 inline-6 making 444hp from the factory.','The Competition package adds 19hp, stiffer suspension, and Active M Differential.','The S55 is a direct evolution of the naturally-aspirated S65 V8 from the E92 M3.'],
      6,'completed','Twin-turbocharged S55 3.0L Inline-6','7-speed DCT (M-DCT)','RWD');
  END IF;

  -- HEALTH SUMMARIES
  INSERT INTO vehicle_health_summary (vehicle_id, health_score, summary, red_flags, maintenance_status, recall_status, issues_overview, recommendations)
  VALUES (v1_id,74,'Solid daily driver at 94k miles. No major issues but approaching several key service intervals simultaneously. The CVT fluid is overdue and the oil dilution issue should be monitored.',ARRAY['CVT fluid overdue by ~15,000 miles','Oil dilution check not documented in recent service history'],'Several intervals coming due. Prioritize CVT fluid and brake fluid.','No open recalls.','Four tracked known issues: CVT fluid degradation is the highest priority. Oil dilution is a watch-item. Infotainment glitch is minor.',ARRAY['Schedule CVT fluid flush immediately - overdue','Check engine oil for fuel dilution smell at next oil change','Bundle brake fluid + cabin air filter change to save labor','Tire rotation overdue - schedule ASAP'])
  ON CONFLICT (vehicle_id) DO NOTHING;

  INSERT INTO vehicle_health_summary (vehicle_id, health_score, summary, red_flags, maintenance_status, recall_status, issues_overview, recommendations)
  VALUES (v2_id,68,'Performance-oriented daily driver approaching the critical 50k mark. Rod bearing health is the single biggest concern given the aggressive use profile.',ARRAY['Rod bearing inspection overdue given mileage + aggressive use','Stage 1 tune without intercooler upgrade risks heat soak','Front strut mounts showing early wear signs'],'Diff fluids current. Engine oil on schedule. Coolant due soon.','Open recall: Engine bearing assembly - check for completion.','Five known issues tracked. Rod bearing and strut mounts are priority items.',ARRAY['ARP rod bolts + bearing inspection before 50k - non-negotiable','Replace front strut mounts at next suspension service','Upgrade to Stage 2 to maximize current exhaust investment','Schedule coolant flush - approaching 30k interval'])
  ON CONFLICT (vehicle_id) DO NOTHING;

  INSERT INTO vehicle_health_summary (vehicle_id, health_score, summary, red_flags, maintenance_status, recall_status, issues_overview, recommendations)
  VALUES (v3_id,61,'High-mileage M3 entering the zone where proactive maintenance separates a healthy car from a costly one. Water pump and rod bearings are the two items that absolutely cannot wait.',ARRAY['Water pump not yet replaced - failure risk increasing past 60k','Rod bearing inspection overdue at 67k with aggressive use history','DCT fluid at 67k - likely on original fluid if no records'],'Engine oil current. Brake fluid overdue. Spark plugs at scheduled interval.','2 open recalls - fuel pump and electrical system.','Five known issues tracked. Water pump and rod bearings are critical.',ARRAY['Water pump + thermostat replacement - do this immediately','Rod bearing inspection at the same time as water pump (same labor area)','DCT fluid change overdue - schedule soon','Brake fluid flush overdue - do before any track days'])
  ON CONFLICT (vehicle_id) DO NOTHING;

  -- NHTSA DATA
  INSERT INTO nhtsa_data (vehicle_id, recalls, safety_ratings, specifications) VALUES (v1_id,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb) ON CONFLICT (vehicle_id) DO NOTHING;
  INSERT INTO nhtsa_data (vehicle_id, recalls, safety_ratings, specifications) VALUES (v2_id,'[{"Component":"ENGINE AND ENGINE COOLING","Summary":"Subaru is recalling certain 2020 WRX vehicles. The engine may have been assembled with engine bearings that have insufficient oil clearance, which may cause premature engine wear.","NHTSACampaignNumber":"20V456000","ReportReceivedDate":"06/15/2020","Consequence":"Engine bearing failure could result in a loss of engine power, potentially increasing the risk of a crash."}]'::jsonb,'{}'::jsonb,'{}'::jsonb) ON CONFLICT (vehicle_id) DO NOTHING;
  INSERT INTO nhtsa_data (vehicle_id, recalls, safety_ratings, specifications) VALUES (v3_id,'[{"Component":"FUEL SYSTEM, GASOLINE","Summary":"BMW is recalling certain 2018-2020 M3 vehicles. The high-pressure fuel pump may fail, causing the engine to stall without warning.","NHTSACampaignNumber":"21V702000","ReportReceivedDate":"09/22/2021","Consequence":"An engine stall while driving increases the risk of a crash."},{"Component":"ELECTRICAL SYSTEM","Summary":"BMW is recalling certain 2019 M3 Competition vehicles. The battery monitoring control unit may malfunction, potentially cutting power to critical safety systems.","NHTSACampaignNumber":"22V118000","ReportReceivedDate":"02/14/2022","Consequence":"Loss of power to safety systems could increase crash risk."}]'::jsonb,'{}'::jsonb,'{}'::jsonb) ON CONFLICT (vehicle_id) DO NOTHING;

  -- VEHICLE DOCUMENTS
  INSERT INTO vehicle_documents (id, vehicle_id, document_type, file_url, upload_date, extraction_status) VALUES
    (doc1_id,v1_id,'invoice','https://demo-placeholder.local/invoice-accord-oil.pdf',now()-interval'45 days','completed'),
    (doc2_id,v1_id,'invoice','https://demo-placeholder.local/invoice-accord-tires.pdf',now()-interval'120 days','completed'),
    (doc3_id,v2_id,'invoice','https://demo-placeholder.local/invoice-wrx-stage1.pdf',now()-interval'30 days','completed'),
    (doc4_id,v3_id,'invoice','https://demo-placeholder.local/invoice-m3-oil-brakes.pdf',now()-interval'60 days','completed'),
    (doc5_id,v3_id,'invoice','https://demo-placeholder.local/invoice-m3-plugs.pdf',now()-interval'90 days','completed')
  ON CONFLICT (id) DO NOTHING;

  -- MAINTENANCE LINE ITEMS - Accord
  IF NOT EXISTS (SELECT 1 FROM maintenance_line_items WHERE vehicle_id = v1_id LIMIT 1) THEN
    INSERT INTO maintenance_line_items (vehicle_id, source_document_id, service_date, shop_name, item_description, quantity, unit_cost, total_cost, labor_cost, parts_cost, category) VALUES
      (v1_id,doc2_id,'2024-10-15','Costco Tire Center','Michelin CrossClimate2 215/55R17 (Set of 4)',4,162.00,648.00,80.00,648.00,'tires'),
      (v1_id,doc2_id,'2024-10-15','Costco Tire Center','Tire installation, balance, TPMS reset',4,20.00,80.00,80.00,0.00,'labor'),
      (v1_id,doc1_id,'2025-01-08','Honda Dealership','Mobil 1 0W-20 Full Synthetic 5qt',1,28.50,28.50,0.00,28.50,'oil'),
      (v1_id,doc1_id,'2025-01-08','Honda Dealership','OEM Honda Oil Filter',1,8.99,8.99,0.00,8.99,'oil'),
      (v1_id,doc1_id,'2025-01-08','Honda Dealership','Oil Change Labor',1,45.00,45.00,45.00,0.00,'labor'),
      (v1_id,doc1_id,'2025-01-08','Honda Dealership','Cabin Air Filter - OEM Honda',1,22.00,22.00,10.00,22.00,'filter'),
      (v1_id,NULL,'2024-07-22','Firestone Complete Auto Care','Front Brake Pads - Akebono Pro-ACT',1,89.00,89.00,0.00,89.00,'brakes'),
      (v1_id,NULL,'2024-07-22','Firestone Complete Auto Care','Front Brake Rotors (pair)',2,64.00,128.00,0.00,128.00,'brakes'),
      (v1_id,NULL,'2024-07-22','Firestone Complete Auto Care','Brake Service Labor',1,120.00,120.00,120.00,0.00,'labor');
  END IF;

  -- MAINTENANCE LINE ITEMS - WRX
  IF NOT EXISTS (SELECT 1 FROM maintenance_line_items WHERE vehicle_id = v2_id LIMIT 1) THEN
    INSERT INTO maintenance_line_items (vehicle_id, source_document_id, service_date, shop_name, item_description, quantity, unit_cost, total_cost, labor_cost, parts_cost, category) VALUES
      (v2_id,doc3_id,'2025-02-10','Delicious Tuning - Burlingame CA','COBB Accessport V3 (AP3-SUB-004)',1,695.00,695.00,0.00,695.00,'performance'),
      (v2_id,doc3_id,'2025-02-10','Delicious Tuning - Burlingame CA','COBB Stage 1 OTS Map Installation + Dyno',1,200.00,200.00,200.00,0.00,'labor'),
      (v2_id,doc3_id,'2025-02-10','Delicious Tuning - Burlingame CA','Motul 8100 5W-30 Pre-tune Oil Change',1,85.00,85.00,30.00,55.00,'oil'),
      (v2_id,NULL,'2024-11-05','Subaru of Oakland','NGK Iridium Spark Plugs ILZKAR8H8S (Set of 4)',4,18.50,74.00,0.00,74.00,'ignition'),
      (v2_id,NULL,'2024-11-05','Subaru of Oakland','Front Differential Fluid - GL-5 75W-90',1,32.00,32.00,0.00,32.00,'fluids'),
      (v2_id,NULL,'2024-11-05','Subaru of Oakland','Rear Differential Fluid - GL-5 75W-90',1,32.00,32.00,0.00,32.00,'fluids'),
      (v2_id,NULL,'2024-11-05','Subaru of Oakland','Spark Plug + Diff Service Labor',1,160.00,160.00,160.00,0.00,'labor'),
      (v2_id,NULL,'2024-08-18','Pennzoil Express','Motul 8100 X-cess 5W-30 Full Synthetic 5.4qt',1,62.00,62.00,0.00,62.00,'oil'),
      (v2_id,NULL,'2024-08-18','Pennzoil Express','Subaru OEM Oil Filter',1,9.99,9.99,0.00,9.99,'oil'),
      (v2_id,NULL,'2024-08-18','Pennzoil Express','Oil Change Labor',1,25.00,25.00,25.00,0.00,'labor');
  END IF;

  -- MAINTENANCE LINE ITEMS - M3
  IF NOT EXISTS (SELECT 1 FROM maintenance_line_items WHERE vehicle_id = v3_id LIMIT 1) THEN
    INSERT INTO maintenance_line_items (vehicle_id, source_document_id, service_date, shop_name, item_description, quantity, unit_cost, total_cost, labor_cost, parts_cost, category) VALUES
      (v3_id,doc4_id,'2025-01-20','Euro Auto Specialists - San Jose CA','Castrol Edge 0W-40 LL-01 Full Synthetic 7qt',1,89.00,89.00,0.00,89.00,'oil'),
      (v3_id,doc4_id,'2025-01-20','Euro Auto Specialists - San Jose CA','BMW OEM Oil Filter Kit',1,28.00,28.00,0.00,28.00,'oil'),
      (v3_id,doc4_id,'2025-01-20','Euro Auto Specialists - San Jose CA','Oil Change + Multi-point Inspection Labor',1,155.00,155.00,155.00,0.00,'labor'),
      (v3_id,doc4_id,'2025-01-20','Euro Auto Specialists - San Jose CA','Rear Brake Pads - Hawk HPS Performance',1,145.00,145.00,0.00,145.00,'brakes'),
      (v3_id,doc4_id,'2025-01-20','Euro Auto Specialists - San Jose CA','Rear Brake Rotors - Brembo OE (pair)',2,189.00,378.00,0.00,378.00,'brakes'),
      (v3_id,doc4_id,'2025-01-20','Euro Auto Specialists - San Jose CA','Rear Brake Service Labor',1,220.00,220.00,220.00,0.00,'labor'),
      (v3_id,doc5_id,'2024-10-08','Euro Auto Specialists - San Jose CA','NGK Iridium Spark Plugs (Set of 6)',6,22.50,135.00,0.00,135.00,'ignition'),
      (v3_id,doc5_id,'2024-10-08','Euro Auto Specialists - San Jose CA','Spark Plug Replacement Labor (S55 - complex access)',1,380.00,380.00,380.00,0.00,'labor'),
      (v3_id,NULL,'2024-06-15','Bavarian Auto Repair','BMW Engine Air Filter - OEM',1,42.00,42.00,0.00,42.00,'filter'),
      (v3_id,NULL,'2024-06-15','Bavarian Auto Repair','BMW Cabin Air Filter - OEM',1,48.00,48.00,0.00,48.00,'filter'),
      (v3_id,NULL,'2024-06-15','Bavarian Auto Repair','Filter Service Labor',1,80.00,80.00,80.00,0.00,'labor');
  END IF;

  -- SERVICE ITEMS
  IF NOT EXISTS (SELECT 1 FROM service_items WHERE vehicle_id = v1_id LIMIT 1) THEN
    INSERT INTO service_items (vehicle_id, description, category, status, cost_parts, cost_labor, estimated_labor_hours) VALUES
      (v1_id,'CVT Fluid Flush - Honda HCF-2','maintenance','wishlist',120.00,80.00,1.5),
      (v1_id,'Brake Fluid Flush','maintenance','wishlist',25.00,60.00,1.0),
      (v1_id,'Tire Rotation','maintenance','wishlist',0.00,30.00,0.5),
      (v1_id,'Tire Rotation + Balance','maintenance','completed',0.00,35.00,0.5),
      (v1_id,'Front Brake Pad + Rotor Replacement','repair','completed',217.00,120.00,2.0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM service_items WHERE vehicle_id = v2_id LIMIT 1) THEN
    INSERT INTO service_items (vehicle_id, description, category, status, cost_parts, cost_labor, estimated_labor_hours) VALUES
      (v2_id,'ARP Rod Bolts + Bearing Inspection','maintenance','wishlist',250.00,800.00,12.0),
      (v2_id,'Front Strut Mount Replacement','repair','wishlist',180.00,240.00,3.5),
      (v2_id,'Whiteline Front + Rear Sway Bars','modification','wishlist',420.00,200.00,4.0),
      (v2_id,'Coolant Flush','maintenance','wishlist',40.00,80.00,1.0),
      (v2_id,'COBB Stage 1 OTS Tune','modification','completed',695.00,200.00,2.5);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM service_items WHERE vehicle_id = v3_id LIMIT 1) THEN
    INSERT INTO service_items (vehicle_id, description, category, status, cost_parts, cost_labor, estimated_labor_hours) VALUES
      (v3_id,'Water Pump + Thermostat Proactive Replacement','maintenance','wishlist',320.00,480.00,6.0),
      (v3_id,'Rod Bearing Inspection (S55)','maintenance','wishlist',180.00,960.00,14.0),
      (v3_id,'DCT Transmission Fluid Change','maintenance','wishlist',120.00,160.00,2.0),
      (v3_id,'Brake Fluid Flush (DOT 4 - Motul RBF600)','maintenance','wishlist',35.00,80.00,1.0),
      (v3_id,'Rear Brake Pads + Rotors','repair','completed',523.00,220.00,3.0),
      (v3_id,'Spark Plug Replacement (NGK Iridium x6)','maintenance','completed',135.00,380.00,5.0);
  END IF;

  -- WISHLIST ITEMS
  IF NOT EXISTS (SELECT 1 FROM wishlist_items WHERE vehicle_id = v1_id LIMIT 1) THEN
    INSERT INTO wishlist_items (vehicle_id, item_type, item_name, item_identifier, description, category, source, estimated_cost_parts, estimated_cost_labor) VALUES
      (v1_id,'maintenance','CVT Fluid Flush','maintenance_cvt_fluid_flush','Overdue Honda HCF-2 flush. Critical to prevent premature CVT wear.','Fluids','dossier',120.00,80.00),
      (v1_id,'issue','Oil Dilution Check','issue_oil_dilution_check','Monitor 2.0T fuel dilution issue. Check dipstick for fuel smell at each oil change.','Engine','dossier',0.00,0.00);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM wishlist_items WHERE vehicle_id = v2_id LIMIT 1) THEN
    INSERT INTO wishlist_items (vehicle_id, item_type, item_name, item_identifier, description, category, source, estimated_cost_parts, estimated_cost_labor) VALUES
      (v2_id,'maintenance','ARP Rod Bolts + Bearing Inspection','maintenance_arp_rod_bolts','High priority before 50k given aggressive driving. Prevents catastrophic engine failure.','Engine','dossier',250.00,800.00),
      (v2_id,'modification','Whiteline Sway Bar Kit','modification_whiteline_sway_bars','Front + rear sway bar kit for reduced body roll and improved cornering.','Suspension','dossier',420.00,200.00),
      (v2_id,'issue','Front Strut Mount Wear','issue_front_strut_mount_wear','Clicking on turn-in. OEM strut mounts wearing as expected.','Suspension','dossier',180.00,240.00);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM wishlist_items WHERE vehicle_id = v3_id LIMIT 1) THEN
    INSERT INTO wishlist_items (vehicle_id, item_type, item_name, item_identifier, description, category, source, estimated_cost_parts, estimated_cost_labor) VALUES
      (v3_id,'maintenance','Water Pump + Thermostat Replacement','maintenance_water_pump','Critical proactive replacement. Factory water pump failure rate increases sharply after 60k.','Cooling System','dossier',320.00,480.00),
      (v3_id,'maintenance','Rod Bearing Inspection','maintenance_rod_bearing','S55 rod bearings at 67k with aggressive use. Inspect and replace if worn.','Engine','dossier',180.00,960.00),
      (v3_id,'modification','BMS JB4 Piggyback Tune','modification_jb4_tune','Safe +60-80whp on stock hardware. Best value tune for the S55 platform.','Engine','consultant',499.00,150.00);
  END IF;

  -- KNOWN ISSUE TRACKING
  IF NOT EXISTS (SELECT 1 FROM known_issue_tracking WHERE vehicle_id = v1_id LIMIT 1) THEN
    INSERT INTO known_issue_tracking (vehicle_id, issue_identifier, status, notes) VALUES
      (v1_id,'CVT fluid degradation','pending','Fluid overdue by approx 15k miles. Book flush ASAP.'),
      (v1_id,'Oil dilution (2.0T)','pending','No fuel smell at last check. Monitoring.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM known_issue_tracking WHERE vehicle_id = v2_id LIMIT 1) THEN
    INSERT INTO known_issue_tracking (vehicle_id, issue_identifier, status, notes) VALUES
      (v2_id,'FA20DIT rod bearing wear','pending','Approaching 50k with aggressive use. ARP bolts + inspection on deck.'),
      (v2_id,'Front strut mount wear','pending','Mild clicking on turn-in. Not urgent but on radar.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM known_issue_tracking WHERE vehicle_id = v3_id LIMIT 1) THEN
    INSERT INTO known_issue_tracking (vehicle_id, issue_identifier, status, notes) VALUES
      (v3_id,'S55 rod bearing wear','pending','At 67k. Scheduling inspection with water pump job.'),
      (v3_id,'Water pump failure risk','pending','Booking proactive replacement. Failure rate spikes past 60k.'),
      (v3_id,'VANOS solenoid sluggishness','pending','Rough cold starts. Will diagnose after water pump job.');
  END IF;

  -- PRE-SEEDED CONSULTANT CONVERSATIONS
  INSERT INTO consultant_conversations (id, vehicle_id, title, message_history, message_count)
  VALUES (session1_id,v1_id,'CVT Fluid & Oil Dilution Questions',
    '[{"role":"user","content":"My Accord has 94k miles. What should I be worried about?","timestamp":"2025-03-10T10:00:00Z"},{"role":"assistant","content":"Alright, 94k on the 2018 Accord 2.0T. Here is the real talk:\n\nYour biggest concern right now is the CVT fluid. Honda says flush it every 30k - most owners ignore this and pay for it later. At 94k you should have done it at least twice. If you have not, book it immediately. Degraded CVT fluid causes hesitation, hunting between gears, and eventually a $4,000+ transmission. A flush costs $150.\n\nOil dilution is your second watch item. The 2.0T has a documented fuel dilution issue - gasoline gets past the rings and into the oil, especially on short trips and in cold weather. Pull your dipstick and smell it. If it smells like gas, shorten your oil change interval to 5,000 miles and track it.\n\nOther than that? You are actually in decent shape. The 10th gen Accord is genuinely reliable if you stay on top of those two items.","timestamp":"2025-03-10T10:00:05Z"},{"role":"user","content":"How much is a CVT flush going to run me?","timestamp":"2025-03-10T10:05:00Z"},{"role":"assistant","content":"At a Honda dealer, expect $150-$200 for the CVT flush using Honda HCF-2 fluid. That is the only fluid you should use - do not let anyone put generic ATF in there.\n\nIndependent shop? More like $100-$140 if they stock HCF-2. Call ahead and ask specifically.\n\nIf you want to bundle it: a brake fluid flush is also on your list, and adding it to the same appointment usually saves you $30-50 in shop fees since the car is already on the lift. I would book both together.","timestamp":"2025-03-10T10:05:05Z"}]'::jsonb,
    3)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO consultant_conversations (id, vehicle_id, title, message_history, message_count)
  VALUES (session2_id,v2_id,'Stage 2 Build Planning',
    '[{"role":"user","content":"I just got my Stage 1 tune done. What is the logical next step?","timestamp":"2025-03-12T14:00:00Z"},{"role":"assistant","content":"Good move on Stage 1. Now let us talk about what actually matters before you go further.\n\nBefore Stage 2, do this first: You are at 41k miles with aggressive use. ARP rod bolts and a bearing inspection are not optional at this point - they are insurance on a $15k engine. The FA20DIT is known for this. Do it before you add more boost.\n\nFor Stage 2 itself, you need:\n1. Grimmspeed or Invidia downpipe (catted for street, catless for track)\n2. COBB Accessport reflash to Stage 2 map\n3. Consider an upgraded intercooler - heat soak is real on a hot day\n\nExpect +30-40 WHP over your current Stage 1 numbers, putting you around 290-310 WHP at the wheels.","timestamp":"2025-03-12T14:00:05Z"},{"role":"user","content":"Budget is around $3k for mods. Should I do downpipe first or sway bars?","timestamp":"2025-03-12T14:10:00Z"},{"role":"assistant","content":"With $3k and a Stage 1 tune already done, here is how I would sequence it:\n\n1. ARP rod bolts + bearing inspection (~$1,050 all-in) - Do this first. Not negotiable. Protect the engine before you add power.\n\n2. Grimmspeed catted downpipe + Stage 2 reflash (~$800-900) - Now you can actually use what you have built.\n\n3. Whiteline front + rear sway bars (~$600-650 installed) - This transforms the car more than most engine mods. Night and day difference in the canyons.\n\nThat lands you right around your $3k budget.","timestamp":"2025-03-12T14:10:05Z"}]'::jsonb,
    3)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO consultant_conversations (id, vehicle_id, title, message_history, message_count)
  VALUES (session3_id,v3_id,'Water Pump & High Mileage Planning',
    '[{"role":"user","content":"I am at 67k on my M3 Competition. What should I be preparing for?","timestamp":"2025-03-13T09:00:00Z"},{"role":"assistant","content":"67k on an F80 M3 Competition. You are entering what the M community calls the consequence zone - where deferred maintenance stops being inconvenient and starts being expensive.\n\nCritical - Do immediately:\n- Water pump + thermostat - BMW electric water pump is a known failure. The factory one typically lasts 60-80k. About $800 all-in at an independent Euro shop.\n- Rod bearing inspection - The S55 has documented bearing wear. At 67k with track use, this is non-negotiable. ~$1,100-1,400 in labor.\n\nImportant - Schedule soon:\n- DCT fluid - BMW calls it lifetime. It is not.\n- Brake fluid - If you have done any track days, this is overdue.\n\nThe smart play is to bundle the water pump + rod bearing jobs since they are in the same area of the engine. You save 4-5 hours of labor combining them.","timestamp":"2025-03-13T09:00:05Z"},{"role":"user","content":"What is the total damage if I do all of this at once?","timestamp":"2025-03-13T09:08:00Z"},{"role":"assistant","content":"Bundled at a good independent Euro shop, here is the real number:\n\nWater pump + thermostat: $800 all-in\nRod bearing inspection: $180 parts + $600 labor (bundled with water pump) = ~$780\nDCT fluid change: $280\nBrake fluid flush: $115\n\nBundled total: ~$1,900-2,100\nAdd DCT + brake fluid: ~$2,300-2,500 all-in\n\nFor a 444hp German performance car at 67k miles, that is genuinely reasonable preventive maintenance.","timestamp":"2025-03-13T09:08:05Z"}]'::jsonb,
    3)
  ON CONFLICT (id) DO NOTHING;

END $$;
