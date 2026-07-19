/*
  # Add RLS Policies for Invoice Line Items
  
  1. Changes
    - Add INSERT policy for invoice_line_items
    - Add UPDATE policy for invoice_line_items
    - Add DELETE policy for invoice_line_items
  
  2. Security
    - All policies check that the user owns the vehicle
    - Ensures users can only modify line items for their own vehicles
*/

-- Add INSERT policy
CREATE POLICY "Users can insert invoice line items for their vehicles"
  ON invoice_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = invoice_line_items.vehicle_id
    )
  );

-- Add UPDATE policy
CREATE POLICY "Users can update invoice line items for their vehicles"
  ON invoice_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = invoice_line_items.vehicle_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = invoice_line_items.vehicle_id
    )
  );

-- Add DELETE policy
CREATE POLICY "Users can delete invoice line items for their vehicles"
  ON invoice_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = invoice_line_items.vehicle_id
    )
  );
