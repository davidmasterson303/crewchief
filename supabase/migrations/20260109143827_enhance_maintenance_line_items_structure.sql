/*
  # Enhance maintenance_line_items table for invoice tracking
  
  1. Changes to maintenance_line_items table
    - Add `source_document_id` (uuid) - tracks which invoice created this item
    - Add `combined_with_id` (uuid) - links related labor/parts items together
    - Add `labor_cost` (numeric) - tracks labor portion of combined items
    - Add `parts_cost` (numeric) - tracks parts portion of combined items
    - Add `is_combined` (boolean) - indicates if this is a combined labor+parts item
    - Add `original_category` (text) - stores original category before combination
    
  2. Indexes
    - Add index on source_document_id for faster invoice lookups
    - Add index on item_description for faster searching
    - Add index on combined_with_id for relationship queries
    
  3. Notes
    - labor_cost and parts_cost allow showing cost breakdown in details
    - source_document_id enables "delete all from invoice" functionality
    - combined_with_id helps identify related items that were merged
*/

-- Add new columns to maintenance_line_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_line_items' AND column_name = 'source_document_id'
  ) THEN
    ALTER TABLE maintenance_line_items ADD COLUMN source_document_id uuid REFERENCES vehicle_documents(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_line_items' AND column_name = 'combined_with_id'
  ) THEN
    ALTER TABLE maintenance_line_items ADD COLUMN combined_with_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_line_items' AND column_name = 'labor_cost'
  ) THEN
    ALTER TABLE maintenance_line_items ADD COLUMN labor_cost numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_line_items' AND column_name = 'parts_cost'
  ) THEN
    ALTER TABLE maintenance_line_items ADD COLUMN parts_cost numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_line_items' AND column_name = 'is_combined'
  ) THEN
    ALTER TABLE maintenance_line_items ADD COLUMN is_combined boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_line_items' AND column_name = 'original_category'
  ) THEN
    ALTER TABLE maintenance_line_items ADD COLUMN original_category text;
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_maintenance_line_items_source_document ON maintenance_line_items(source_document_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_line_items_description ON maintenance_line_items(item_description);
CREATE INDEX IF NOT EXISTS idx_maintenance_line_items_combined ON maintenance_line_items(combined_with_id);
