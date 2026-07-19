/*
  # Add Vehicle Color and Status Tracking

  1. Changes to Existing Tables
    - `vehicles`
      - Add `color` field for vehicle color (required for images)
      - Add `image_url` field for vehicle photo

  2. New Tables
    - `known_issue_tracking`
      - Tracks status of known issues for each vehicle
      - Links to vehicle_knowledge_base issues
      - Status: pending, completed, not_interested
      - Completion date and notes
    
    - `modification_tracking`
      - Tracks interest and completion of modifications
      - Status: interested, completed, not_interested
      - Installation date and notes

  3. Security
    - Enable RLS on new tables
    - Permissive policies for MVP
*/

-- Add color and image fields to vehicles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'color'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN color text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN image_url text;
  END IF;
END $$;

-- Create tracking status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tracking_status') THEN
    CREATE TYPE tracking_status AS ENUM ('pending', 'completed', 'not_interested');
  END IF;
END $$;

-- Known Issue Tracking table
CREATE TABLE IF NOT EXISTS known_issue_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  issue_identifier text NOT NULL,
  status tracking_status DEFAULT 'pending',
  completed_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, issue_identifier)
);

-- Modification Tracking table
CREATE TABLE IF NOT EXISTS modification_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  mod_name text NOT NULL,
  status tracking_status DEFAULT 'pending',
  installed_date date,
  cost_parts decimal(10, 2) DEFAULT 0,
  cost_labor decimal(10, 2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, mod_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_known_issue_tracking_vehicle_id ON known_issue_tracking(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_modification_tracking_vehicle_id ON modification_tracking(vehicle_id);

-- Enable RLS
ALTER TABLE known_issue_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE modification_tracking ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for MVP
CREATE POLICY "Allow all operations on known_issue_tracking" ON known_issue_tracking FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on modification_tracking" ON modification_tracking FOR ALL USING (true) WITH CHECK (true);
