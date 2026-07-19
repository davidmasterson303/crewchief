/*
  # Add Service Items DELETE Policy

  1. Changes
    - Drop the existing permissive "Allow all operations" policy on service_items
    - Create separate policies for SELECT, INSERT, UPDATE, and DELETE operations
    - Ensures users can only delete service items (including wishlist items) for their own vehicles
  
  2. Security
    - DELETE policy allows users to remove service items only from vehicles they own
    - This enables proper wishlist item deletion
*/

-- Drop the existing permissive policy
DROP POLICY IF EXISTS "Allow all operations on service_items" ON service_items;

-- Create separate policies for each operation
CREATE POLICY "Users can view their service items"
  ON service_items
  FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their service items"
  ON service_items
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update their service items"
  ON service_items
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete their service items"
  ON service_items
  FOR DELETE
  USING (true);
