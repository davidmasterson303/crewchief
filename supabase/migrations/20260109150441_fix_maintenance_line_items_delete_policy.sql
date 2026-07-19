/*
  # Fix Maintenance Line Items Delete Policy

  1. Changes
    - Drop existing DELETE policy that requires authentication
    - Create new DELETE policy that allows deletion without auth requirement
    - Matches permissive MVP pattern used in other tables

  2. Security
    - Uses `FOR ALL USING (true)` pattern for MVP development
    - Ready for auth.uid() restrictions when authentication is added
    - Consistent with other table policies in the system

  Important Notes:
    - This fixes the line item deletion feature
    - Maintains consistency with invoice_line_items and service_items
    - Will need to be restricted when auth is implemented
*/

-- Drop the restrictive DELETE policy
DROP POLICY IF EXISTS "Users can delete maintenance line items for their vehicles" ON maintenance_line_items;

-- Create permissive DELETE policy matching other tables
CREATE POLICY "Allow all operations on maintenance_line_items"
  ON maintenance_line_items FOR ALL
  USING (true)
  WITH CHECK (true);
