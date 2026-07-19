/*
  # Fix Maintenance Line Items RLS DELETE Policy

  1. Problem
    - Previous policy used FOR ALL which is problematic for DELETE operations
    - WITH CHECK only applies to INSERT/UPDATE, not DELETE
    - This caused "TypeError: fetch failed" when attempting deletes

  2. Solution
    - Drop the problematic FOR ALL policy
    - Create separate, properly structured policies:
      - SELECT: Allow reading all items
      - INSERT: Allow inserting for any vehicle
      - UPDATE: Allow updating any item
      - DELETE: Allow deleting any item
    - Each policy properly uses USING for SELECT/UPDATE/DELETE
    - WITH CHECK only used for INSERT/UPDATE

  3. Why This Works
    - DELETE operations require USING clause
    - Separate policies are more maintainable
    - Explicitly allows operations needed for MVP
    - Ready for auth.uid() restrictions later
*/

-- Drop the problematic FOR ALL policy
DROP POLICY IF EXISTS "Allow all operations on maintenance_line_items" ON maintenance_line_items;

-- Create properly structured policies
CREATE POLICY "maintenance_line_items_select"
  ON maintenance_line_items FOR SELECT
  USING (true);

CREATE POLICY "maintenance_line_items_insert"
  ON maintenance_line_items FOR INSERT
  WITH CHECK (true);

CREATE POLICY "maintenance_line_items_update"
  ON maintenance_line_items FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "maintenance_line_items_delete"
  ON maintenance_line_items FOR DELETE
  USING (true);
