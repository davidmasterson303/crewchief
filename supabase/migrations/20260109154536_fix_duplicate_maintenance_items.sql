/*
  # Fix Duplicate Maintenance Items

  1. Schema Changes
    - Add `extraction_status` to `vehicle_documents` table to track processing
    - Add unique constraint to `maintenance_line_items` to prevent duplicates
    - Add cleanup function to remove existing duplicates

  2. Data Cleanup
    - Remove duplicate maintenance line items (keeping most recent)
    - Ensures data integrity before adding constraint

  3. Security
    - No changes to RLS policies
*/

-- First, add extraction_status to vehicle_documents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_documents' AND column_name = 'extraction_status'
  ) THEN
    ALTER TABLE vehicle_documents
    ADD COLUMN extraction_status text DEFAULT 'pending';
  END IF;
END $$;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_extraction_status
ON vehicle_documents(extraction_status);

-- Function to clean up duplicate maintenance line items
-- Keeps the most recent record for each unique combination
CREATE OR REPLACE FUNCTION cleanup_duplicate_maintenance_items()
RETURNS TABLE(deleted_count bigint) AS $$
DECLARE
  total_deleted bigint := 0;
BEGIN
  -- Delete duplicates, keeping only the most recent record for each unique set
  WITH ranked_items AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          vehicle_id,
          COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
          service_date,
          shop_name,
          item_description,
          COALESCE(part_number, ''),
          total_cost
        ORDER BY created_at DESC
      ) as rn
    FROM maintenance_line_items
  ),
  deleted_items AS (
    DELETE FROM maintenance_line_items
    WHERE id IN (
      SELECT id FROM ranked_items WHERE rn > 1
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO total_deleted FROM deleted_items;

  deleted_count := total_deleted;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Run the cleanup function
SELECT cleanup_duplicate_maintenance_items();

-- Add unique constraint to prevent future duplicates
-- This allows multiple items from same document but prevents exact duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_maintenance_line_item'
  ) THEN
    -- Create a unique constraint on document + line characteristics
    -- This prevents the same line item from being inserted twice
    ALTER TABLE maintenance_line_items
    ADD CONSTRAINT unique_maintenance_line_item
    UNIQUE NULLS NOT DISTINCT (
      source_document_id,
      vehicle_id,
      service_date,
      shop_name,
      item_description,
      part_number,
      total_cost
    );
  END IF;
END $$;

-- Add index on source_document_id for faster duplicate checks
CREATE INDEX IF NOT EXISTS idx_maintenance_line_items_source_doc
ON maintenance_line_items(source_document_id)
WHERE source_document_id IS NOT NULL;

-- Function to delete all line items for a document (for reprocessing)
CREATE OR REPLACE FUNCTION delete_maintenance_items_for_document(doc_id uuid)
RETURNS bigint AS $$
DECLARE
  deleted_count bigint;
BEGIN
  DELETE FROM maintenance_line_items
  WHERE source_document_id = doc_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;