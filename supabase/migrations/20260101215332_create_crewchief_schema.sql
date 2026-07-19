/*
  # CrewChief Database Schema - Initial Setup

  1. New Tables
    - `vehicles`
      - Core vehicle information from VIN decode
      - User ownership objectives and driving habits
      - Mileage tracking
    
    - `vehicle_knowledge_base`
      - AI-generated vehicle research data (The Dossier)
      - Known issues, maintenance schedules, fluid specs
      - Research status tracking
    
    - `service_items`
      - Maintenance, repairs, modifications tracking
      - Labor estimation and cost tracking
      - Smart bundling metadata (location zones)
    
    - `consultant_conversations`
      - AI consultant chat history
      - Context snapshots for continuity
    
    - `labor_bundles`
      - Smart bundling suggestions
      - Labor savings calculations
    
    - `vehicle_documents`
      - Invoice images and PDFs
      - AI-extracted data storage
    
    - `nhtsa_data`
      - Recall information
      - Safety ratings and specifications
      - Quarterly recheck scheduling
    
    - `location_zones`
      - Reference data for physical vehicle zones
      - Access requirements for bundling logic

  2. Security
    - Enable RLS on all tables (permissive for MVP, ready for auth)
    - All policies allow operations without auth checks (MVP only)
*/

-- Create ENUM types
CREATE TYPE performance_mindedness AS ENUM ('stock', 'mild', 'aggressive');
CREATE TYPE service_category AS ENUM ('maintenance', 'modification', 'repair', 'upgrade');
CREATE TYPE service_status AS ENUM ('wishlist', 'purchased', 'scheduled', 'completed');
CREATE TYPE research_status AS ENUM ('pending', 'completed', 'failed', 'unsupported');
CREATE TYPE bundle_status AS ENUM ('suggested', 'accepted', 'rejected', 'completed');
CREATE TYPE document_type AS ENUM ('invoice', 'manual', 'photo', 'report');

-- Vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  vin text UNIQUE NOT NULL,
  year int NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  trim text,
  current_mileage int DEFAULT 0,
  ownership_objective text,
  usage_profile text,
  avg_miles_per_month int,
  performance_mindedness performance_mindedness DEFAULT 'stock',
  driving_style text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Vehicle Knowledge Base table
CREATE TABLE IF NOT EXISTS vehicle_knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  known_issues jsonb DEFAULT '[]'::jsonb,
  maintenance_schedule jsonb DEFAULT '[]'::jsonb,
  fluid_specs jsonb DEFAULT '{}'::jsonb,
  common_mods jsonb DEFAULT '[]'::jsonb,
  reliability_score int CHECK (reliability_score >= 1 AND reliability_score <= 10),
  last_research_date timestamptz DEFAULT now(),
  research_status research_status DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Service Items table
CREATE TABLE IF NOT EXISTS service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  description text NOT NULL,
  category service_category DEFAULT 'maintenance',
  status service_status DEFAULT 'wishlist',
  location_zone text,
  estimated_labor_hours float DEFAULT 0,
  actual_labor_hours float,
  cost_parts decimal(10, 2) DEFAULT 0,
  cost_labor decimal(10, 2) DEFAULT 0,
  date_completed date,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Consultant Conversations table
CREATE TABLE IF NOT EXISTS consultant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  message_history jsonb DEFAULT '[]'::jsonb,
  context_snapshot jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Labor Bundles table
CREATE TABLE IF NOT EXISTS labor_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  service_item_ids uuid[] NOT NULL,
  bundle_reason text,
  labor_saved_hours float DEFAULT 0,
  estimated_savings decimal(10, 2) DEFAULT 0,
  status bundle_status DEFAULT 'suggested',
  suggested_at timestamptz DEFAULT now()
);

-- Vehicle Documents table
CREATE TABLE IF NOT EXISTS vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  document_type document_type DEFAULT 'invoice',
  file_url text NOT NULL,
  extracted_data jsonb,
  upload_date timestamptz DEFAULT now(),
  associated_service_item_id uuid REFERENCES service_items(id) ON DELETE SET NULL
);

-- NHTSA Data table
CREATE TABLE IF NOT EXISTS nhtsa_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  recalls jsonb DEFAULT '[]'::jsonb,
  safety_ratings jsonb DEFAULT '{}'::jsonb,
  specifications jsonb DEFAULT '{}'::jsonb,
  last_checked timestamptz DEFAULT now(),
  next_check_due timestamptz DEFAULT (now() + interval '90 days')
);

-- Location Zones reference table
CREATE TABLE IF NOT EXISTS location_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name text UNIQUE NOT NULL,
  zone_category text,
  typical_access_requirements text[] DEFAULT '{}'::text[]
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
CREATE INDEX IF NOT EXISTS idx_service_items_vehicle_id ON service_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_service_items_status ON service_items(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_knowledge_base_vehicle_id ON vehicle_knowledge_base(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_consultant_conversations_vehicle_id ON consultant_conversations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle_id ON vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_nhtsa_data_vehicle_id ON nhtsa_data(vehicle_id);

-- Enable Row Level Security
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE nhtsa_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_zones ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for MVP (TODO: Restrict to auth.uid() when auth is added)
CREATE POLICY "Allow all operations on vehicles" ON vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on vehicle_knowledge_base" ON vehicle_knowledge_base FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on service_items" ON service_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on consultant_conversations" ON consultant_conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on labor_bundles" ON labor_bundles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on vehicle_documents" ON vehicle_documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on nhtsa_data" ON nhtsa_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on location_zones" ON location_zones FOR ALL USING (true) WITH CHECK (true);

-- Insert seed data for location zones
INSERT INTO location_zones (zone_name, zone_category, typical_access_requirements) VALUES
  ('front_suspension', 'suspension', ARRAY['lift_vehicle', 'remove_wheels']),
  ('rear_suspension', 'suspension', ARRAY['lift_vehicle', 'remove_wheels']),
  ('engine_bay_top', 'engine', ARRAY['open_hood']),
  ('engine_bay_bottom', 'engine', ARRAY['lift_vehicle', 'remove_skid_plate']),
  ('underbody_front', 'underbody', ARRAY['lift_vehicle']),
  ('underbody_rear', 'underbody', ARRAY['lift_vehicle']),
  ('interior_dash', 'interior', ARRAY['remove_dashboard_panels']),
  ('exterior_body', 'body', ARRAY['none']),
  ('exhaust_system', 'exhaust', ARRAY['lift_vehicle']),
  ('cooling_system', 'cooling', ARRAY['drain_coolant', 'open_hood']),
  ('fuel_system', 'fuel', ARRAY['depressurize_fuel_system', 'lift_vehicle']),
  ('electrical', 'electrical', ARRAY['disconnect_battery']),
  ('transmission', 'drivetrain', ARRAY['lift_vehicle', 'drain_transmission']),
  ('brakes_front', 'brakes', ARRAY['lift_vehicle', 'remove_wheels']),
  ('brakes_rear', 'brakes', ARRAY['lift_vehicle', 'remove_wheels']),
  ('general', 'general', ARRAY['none'])
ON CONFLICT (zone_name) DO NOTHING;