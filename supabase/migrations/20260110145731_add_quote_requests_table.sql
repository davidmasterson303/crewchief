/*
  # Add Quote Requests System

  1. New Tables
    - `quote_requests`
      - `id` (uuid, primary key) - Unique identifier for quote request
      - `vehicle_id` (uuid, foreign key) - Links to vehicles table
      - `selected_items` (jsonb) - Array of service items included in quote
      - `zip_code` (text) - 5-digit zip code for regional pricing
      - `additional_notes` (text, nullable) - Optional user notes
      - `email_draft` (text) - Generated email body text
      - `estimated_total_low` (decimal) - Lower bound of total estimate
      - `estimated_total_high` (decimal) - Upper bound of total estimate
      - `cost_breakdown` (jsonb) - Itemized cost estimates
      - `created_at` (timestamptz) - Timestamp of creation
      
  2. Changes to Existing Tables
    - Add `preferred_zip_code` field to `vehicles` table
      - Stores user's saved zip code for convenience
      
  3. Security
    - Enable RLS on `quote_requests` table
    - Add permissive policy for MVP (allow all operations)
    
  4. Indexes
    - Index on `quote_requests.vehicle_id` for fast lookups
    - Index on `quote_requests.created_at` for chronological sorting
*/

-- Add preferred_zip_code to vehicles table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'preferred_zip_code'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN preferred_zip_code text;
  END IF;
END $$;

-- Create quote_requests table
CREATE TABLE IF NOT EXISTS quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  selected_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  zip_code text NOT NULL,
  additional_notes text,
  email_draft text NOT NULL,
  estimated_total_low decimal(10, 2) NOT NULL DEFAULT 0,
  estimated_total_high decimal(10, 2) NOT NULL DEFAULT 0,
  cost_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_quote_requests_vehicle_id ON quote_requests(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_created_at ON quote_requests(created_at DESC);

-- Enable Row Level Security
ALTER TABLE quote_requests ENABLE ROW LEVEL SECURITY;

-- Create permissive policy for MVP
CREATE POLICY "Allow all operations on quote_requests" 
  ON quote_requests 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);