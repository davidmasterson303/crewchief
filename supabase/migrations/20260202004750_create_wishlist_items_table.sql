/*
  # Create Wishlist Items Table

  ## Purpose
  Unified wishlist system for tracking issues, maintenance items, and modifications
  that users want to complete on their vehicles.

  ## Tables Created
  - `wishlist_items`
    - `id` (uuid, primary key)
    - `vehicle_id` (uuid, references vehicles)
    - `item_type` (text, check: 'issue', 'maintenance', 'modification')
    - `item_name` (text, display name)
    - `item_identifier` (text, unique key for deduplication)
    - `description` (text, optional details)
    - `category` (text, categorization)
    - `estimated_cost_parts` (numeric, estimated parts cost)
    - `estimated_cost_labor` (numeric, estimated labor cost)
    - `estimated_labor_hours` (numeric, estimated hours)
    - `notes` (text, user notes)
    - `source` (text, how item was added: 'dossier', 'consultant', 'manual')
    - `source_data` (jsonb, original data from source)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  ## Security
  - Enable RLS on `wishlist_items`
  - Users can only access wishlist items for their own vehicles
  - Policies for SELECT, INSERT, UPDATE, DELETE

  ## Notes
  - Unique constraint on (vehicle_id, item_identifier) prevents duplicates
  - item_identifier format: "type:name" (e.g., "issue:vanos_rattle", "mod:cold_air_intake")
  - When marking complete, item is removed from wishlist and added to maintenance history
*/

-- Create wishlist_items table
CREATE TABLE IF NOT EXISTS wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('issue', 'maintenance', 'modification')),
  item_name TEXT NOT NULL,
  item_identifier TEXT NOT NULL,
  description TEXT,
  category TEXT,
  estimated_cost_parts NUMERIC DEFAULT 0,
  estimated_cost_labor NUMERIC DEFAULT 0,
  estimated_labor_hours NUMERIC DEFAULT 0,
  notes TEXT,
  source TEXT CHECK (source IN ('dossier', 'consultant', 'manual')),
  source_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_vehicle_item UNIQUE(vehicle_id, item_identifier)
);

-- Enable RLS
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own wishlist items
CREATE POLICY "Users can view own wishlist items"
  ON wishlist_items
  FOR SELECT
  TO authenticated
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can insert wishlist items for their vehicles
CREATE POLICY "Users can insert own wishlist items"
  ON wishlist_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can update their own wishlist items
CREATE POLICY "Users can update own wishlist items"
  ON wishlist_items
  FOR UPDATE
  TO authenticated
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can delete their own wishlist items
CREATE POLICY "Users can delete own wishlist items"
  ON wishlist_items
  FOR DELETE
  TO authenticated
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE user_id = auth.uid()
    )
  );

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_wishlist_items_vehicle_id ON wishlist_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_type ON wishlist_items(item_type);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_identifier ON wishlist_items(vehicle_id, item_identifier);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_wishlist_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_wishlist_items_updated_at
  BEFORE UPDATE ON wishlist_items
  FOR EACH ROW
  EXECUTE FUNCTION update_wishlist_items_updated_at();
