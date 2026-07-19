/*
  # Add Invoice Line Items Table

  1. New Tables
    - `invoice_line_items`
      - `id` (uuid, primary key)
      - `document_id` (uuid, foreign key to vehicle_documents)
      - `vehicle_id` (uuid, foreign key to vehicles)
      - `line_number` (integer, order of item in invoice)
      - `description` (text, service or part description)
      - `quantity` (numeric, quantity ordered/performed)
      - `unit_price` (numeric, price per unit)
      - `total_price` (numeric, quantity * unit_price)
      - `category` (text, labor, parts, supplies, etc)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `invoice_line_items` table
    - Add policy for authenticated users to read their vehicle's line items
*/

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES vehicle_documents(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  category text DEFAULT 'other',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read invoice line items for their vehicles"
  ON invoice_line_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = invoice_line_items.vehicle_id
    )
  );

CREATE INDEX idx_invoice_line_items_document ON invoice_line_items(document_id);
CREATE INDEX idx_invoice_line_items_vehicle ON invoice_line_items(vehicle_id);
