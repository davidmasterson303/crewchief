/*
  # Create Maintenance Dismissals Table

  ## Summary
  Creates a table to store "Verified by Owner" dismissal records for the Maintenance Forecast.
  When a user clicks "Dismiss / Mark as Current" on a forecast card, a zero-cost service record
  is written here. This allows the forecast engine to calculate a proper "due in X miles" 
  countdown from the confirmed mileage, permanently clearing the "Establish Baseline" state.

  ## New Tables
  - `maintenance_dismissals`
    - `id` (uuid, primary key)
    - `vehicle_id` (uuid, FK to vehicles)
    - `category_key` (text) — the forecast category name, e.g. "Oil Change", "Spark Plugs"
    - `confirmed_mileage` (integer) — mileage at which the user confirmed the service was done
    - `created_at` (timestamptz)
    - `notes` (text, nullable) — optional note from the user

  ## Security
  - RLS enabled; authenticated users may only read/write their own vehicle's dismissals.
    The vehicle ownership check is performed by joining back to the vehicles table.

  ## Notes
  1. The `category_key` must match the `name` field from the COMMON_INTERVALS array in the frontend.
  2. Dismissals are soft records — deleting a dismissal re-enables the "Establish Baseline" state.
  3. No cost field; these are always zero-dollar confirmation records.
*/

CREATE TABLE IF NOT EXISTS maintenance_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  confirmed_mileage integer NOT NULL,
  notes text DEFAULT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_dismissals_vehicle_id_idx
  ON maintenance_dismissals (vehicle_id);

CREATE INDEX IF NOT EXISTS maintenance_dismissals_category_idx
  ON maintenance_dismissals (vehicle_id, category_key);

ALTER TABLE maintenance_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vehicle dismissals"
  ON maintenance_dismissals FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_dismissals.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own vehicle dismissals"
  ON maintenance_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_dismissals.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own vehicle dismissals"
  ON maintenance_dismissals FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_dismissals.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );
