/*
  # Add Modification Details Table

  1. New Tables
    - `modification_details`
      - `id` (uuid, primary key)
      - `vehicle_id` (uuid, foreign key)
      - `mod_name` (text, modification name)
      - `performance_impact` (text, AI-generated explanation of performance gains)
      - `reliability_impact` (text, AI-generated explanation of reliability effects)
      - `cost_benefit_analysis` (text, AI-generated cost-benefit breakdown)
      - `alignment_with_goals` (text, how this mod aligns with owner's goals)
      - `installation_notes` (text, specific notes for this vehicle)
      - `compatibility_notes` (text, any compatibility considerations)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `modification_details` table
    - Add policy for authenticated users to view details of their vehicles' modifications
*/

CREATE TABLE IF NOT EXISTS modification_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  mod_name text NOT NULL,
  performance_impact text,
  reliability_impact text,
  cost_benefit_analysis text,
  alignment_with_goals text,
  installation_notes text,
  compatibility_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, mod_name)
);

ALTER TABLE modification_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view modification details for their vehicles"
  ON modification_details FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = modification_details.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert modification details for their vehicles"
  ON modification_details FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = modification_details.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update modification details for their vehicles"
  ON modification_details FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = modification_details.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = modification_details.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );
