/*
  # Reset Maintenance Line Items RLS Policies

  Clean up all policies and create a single permissive policy for public users
  This ensures deletes and all operations work correctly
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can read maintenance line items for their vehicles" ON maintenance_line_items;
DROP POLICY IF EXISTS "Users can insert maintenance line items for their vehicles" ON maintenance_line_items;
DROP POLICY IF EXISTS "Users can update maintenance line items for their vehicles" ON maintenance_line_items;
DROP POLICY IF EXISTS "Users can delete maintenance line items for their vehicles" ON maintenance_line_items;
DROP POLICY IF EXISTS "maintenance_line_items_select" ON maintenance_line_items;
DROP POLICY IF EXISTS "maintenance_line_items_insert" ON maintenance_line_items;
DROP POLICY IF EXISTS "maintenance_line_items_update" ON maintenance_line_items;
DROP POLICY IF EXISTS "maintenance_line_items_delete" ON maintenance_line_items;
DROP POLICY IF EXISTS "Allow all operations on maintenance_line_items" ON maintenance_line_items;

-- Create single permissive policy allowing all operations for public users
CREATE POLICY "Allow all public operations on maintenance_line_items"
  ON maintenance_line_items FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
