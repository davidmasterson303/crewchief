/*
  # Add Performance Stats to Vehicles

  1. Changes
    - Add performance stat columns to `vehicles` table:
      - `stock_hp` (integer) - Factory horsepower rating
      - `stock_torque` (integer) - Factory torque rating (lb-ft)
      - `stock_zero_to_sixty` (numeric) - Factory 0-60 time in seconds
      - `modified_hp` (integer) - Estimated HP with modifications
      - `modified_torque` (integer) - Estimated torque with modifications  
      - `modified_zero_to_sixty` (numeric) - Estimated 0-60 with modifications
    
    - Add `interesting_facts` array to `vehicle_knowledge_base` table
      - Type: text array
      - Contains 5 interesting facts about the vehicle model
  
  2. Purpose
    - Track vehicle performance capabilities
    - Show impact of modifications on performance
    - Provide engaging vehicle information to users
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'stock_hp'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN stock_hp integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'stock_torque'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN stock_torque integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'stock_zero_to_sixty'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN stock_zero_to_sixty numeric(4,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'modified_hp'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN modified_hp integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'modified_torque'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN modified_torque integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'modified_zero_to_sixty'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN modified_zero_to_sixty numeric(4,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_knowledge_base' AND column_name = 'interesting_facts'
  ) THEN
    ALTER TABLE vehicle_knowledge_base ADD COLUMN interesting_facts text[];
  END IF;
END $$;