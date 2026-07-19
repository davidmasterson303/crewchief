/*
  # Add Powertrain Fields to Vehicle Knowledge Base
  
  1. Changes
    - Add `engine_type` column to `vehicle_knowledge_base` table
    - Add `transmission_type` column to `vehicle_knowledge_base` table
    - Add `drivetrain` column to `vehicle_knowledge_base` table
  
  2. Purpose
    - Store specific powertrain information extracted from vehicle research
    - These fields may contain "or" statements during initial research
    - User onboarding process will clarify uncertain specifications
  
  3. Column Details
    - All columns are text type (nullable)
    - Defaults to NULL initially
    - Updated during vehicle research (generateVehicleDossier)
    - Can be clarified during onboarding if multiple options detected
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_knowledge_base' AND column_name = 'engine_type'
  ) THEN
    ALTER TABLE vehicle_knowledge_base ADD COLUMN engine_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_knowledge_base' AND column_name = 'transmission_type'
  ) THEN
    ALTER TABLE vehicle_knowledge_base ADD COLUMN transmission_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_knowledge_base' AND column_name = 'drivetrain'
  ) THEN
    ALTER TABLE vehicle_knowledge_base ADD COLUMN drivetrain text;
  END IF;
END $$;