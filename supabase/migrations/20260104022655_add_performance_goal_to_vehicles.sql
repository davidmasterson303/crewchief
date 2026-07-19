/*
  # Add Performance Goal to Vehicles

  1. Changes
    - Add `performance_goal` column to `vehicles` table
      - Type: text with check constraint
      - Values: 'mild', 'moderate', 'aggressive'
      - Default: 'moderate'
      - Not null
  
  2. Purpose
    - Allow users to specify their performance modification preference level
    - AI suggestions for modifications will align with this preference
    - Provides personalized recommendations based on user goals
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'performance_goal'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN performance_goal text DEFAULT 'moderate' NOT NULL;
    
    ALTER TABLE vehicles ADD CONSTRAINT performance_goal_check 
      CHECK (performance_goal IN ('mild', 'moderate', 'aggressive'));
  END IF;
END $$;