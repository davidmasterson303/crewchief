/*
  # Create maintenance_line_items table

  1. New Tables
    - `maintenance_line_items`
      - `id` (uuid, primary key)
      - `vehicle_id` (uuid, foreign key to vehicles)
      - `service_date` (date)
      - `shop_name` (text)
      - `item_description` (text, required)
      - `part_number` (text, optional)
      - `quantity` (numeric, default 1)
      - `unit_cost` (numeric, default 0)
      - `total_cost` (numeric, default 0)
      - `category` (text)
      - `invoice_url` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `maintenance_line_items` table
    - Add policies for authenticated users to read and manage their vehicle's line items

  3. Notes
    - This table stores individual line items from invoices
    - Each line item includes shop and date information for easy querying
    - Invoice URL is stored on each item for quick reference
*/

CREATE TABLE IF NOT EXISTS maintenance_line_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  service_date date,
  shop_name text,
  item_description text NOT NULL,
  part_number text,
  quantity numeric DEFAULT 1,
  unit_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  category text,
  invoice_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE maintenance_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read maintenance line items for their vehicles"
  ON maintenance_line_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_line_items.vehicle_id
    )
  );

CREATE POLICY "Users can insert maintenance line items for their vehicles"
  ON maintenance_line_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_line_items.vehicle_id
    )
  );

CREATE POLICY "Users can update maintenance line items for their vehicles"
  ON maintenance_line_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_line_items.vehicle_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_line_items.vehicle_id
    )
  );

CREATE POLICY "Users can delete maintenance line items for their vehicles"
  ON maintenance_line_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_line_items.vehicle_id
    )
  );

CREATE INDEX IF NOT EXISTS idx_maintenance_line_items_vehicle ON maintenance_line_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_line_items_service_date ON maintenance_line_items(service_date DESC);