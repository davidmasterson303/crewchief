/*
  # Create mod_detail_queue table

  1. New Tables
    - `mod_detail_queue`
      - `id` (uuid, primary key)
      - `vehicle_id` (uuid, foreign key to vehicles)
      - `mod_name` (text)
      - `performance_goal` (text, enum: mild|moderate|aggressive)
      - `status` (text, enum: pending|in_progress|completed|failed)
      - `attempts` (integer, default 0)
      - `last_error` (text, nullable)
      - `last_attempted_at` (timestamptz, nullable)
      - `completed_at` (timestamptz, nullable)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Indexes
    - (vehicle_id, performance_goal, status) for queue queries
    - (status) for finding pending/in_progress items

  3. Security
    - Enable RLS on `mod_detail_queue` table
    - Add policies for authenticated users to manage their own data
*/

CREATE TABLE IF NOT EXISTS mod_detail_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  mod_name text NOT NULL,
  performance_goal text NOT NULL CHECK (performance_goal IN ('mild', 'moderate', 'aggressive')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  last_attempted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vehicle_id, mod_name, performance_goal)
);

CREATE INDEX IF NOT EXISTS idx_mod_detail_queue_vehicle_goal_status 
  ON mod_detail_queue(vehicle_id, performance_goal, status);

CREATE INDEX IF NOT EXISTS idx_mod_detail_queue_status 
  ON mod_detail_queue(status);

ALTER TABLE mod_detail_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own mod detail queue"
  ON mod_detail_queue
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = mod_detail_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own mod detail queue"
  ON mod_detail_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own mod detail queue"
  ON mod_detail_queue
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = mod_detail_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own mod detail queue"
  ON mod_detail_queue
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = mod_detail_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );
