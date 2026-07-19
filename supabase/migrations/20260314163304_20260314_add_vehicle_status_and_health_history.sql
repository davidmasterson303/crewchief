/*
  # Vehicle Status, Health History, and Recall Actions

  ## Summary
  Adds three new features to support the UI/UX enhancements:

  ### 1. Vehicle Status Field
  - Adds `vehicle_status` column to `vehicles` table
  - Supported values: 'daily_driver', 'weekend', 'stored', 'for_sale'
  - Defaults to 'daily_driver'

  ### 2. Vehicle Health Score History
  - New table `vehicle_health_history` to track health score over time
  - Automatically populated each time a health summary is generated
  - Enables health timeline chart on dashboard

  ### 3. Recall Action Tracking
  - New table `recall_actions` to track recall remediation
  - Users can mark recalls as addressed with date and optional notes
  - Links to vehicle_id and NHTSA campaign number

  ### Security
  - RLS enabled on all new tables
  - Policies restrict access to authenticated users owning the vehicle
  - health_history and recall_actions both use vehicle ownership checks
*/

-- ============================================================
-- 1. Add vehicle_status to vehicles table
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'vehicle_status'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN vehicle_status TEXT DEFAULT 'daily_driver'
      CHECK (vehicle_status IN ('daily_driver', 'weekend', 'stored', 'for_sale'));
  END IF;
END $$;

-- ============================================================
-- 2. Vehicle health history table
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_health_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  health_score integer NOT NULL CHECK (health_score >= 0 AND health_score <= 100),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_health_history_vehicle_id ON vehicle_health_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_health_history_recorded_at ON vehicle_health_history(recorded_at DESC);

ALTER TABLE vehicle_health_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vehicle health history"
  ON vehicle_health_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_health_history.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own vehicle health history"
  ON vehicle_health_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_health_history.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage health history"
  ON vehicle_health_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 3. Recall actions table
-- ============================================================
CREATE TABLE IF NOT EXISTS recall_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  campaign_number TEXT NOT NULL,
  addressed_at date NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, campaign_number)
);

CREATE INDEX IF NOT EXISTS idx_recall_actions_vehicle_id ON recall_actions(vehicle_id);

ALTER TABLE recall_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recall actions"
  ON recall_actions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = recall_actions.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own recall actions"
  ON recall_actions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = recall_actions.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own recall actions"
  ON recall_actions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = recall_actions.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = recall_actions.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own recall actions"
  ON recall_actions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = recall_actions.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage recall actions"
  ON recall_actions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
