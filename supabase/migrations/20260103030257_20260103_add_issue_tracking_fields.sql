/*
  # Add Shop Name and Cost Fields to Known Issue Tracking
  
  Allows users to record where and how much they spent fixing known issues.
  
  Changes:
  - Add shop_name column to track where issue was fixed
  - Add cost column to track total cost of fixing the issue
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'known_issue_tracking' AND column_name = 'shop_name'
  ) THEN
    ALTER TABLE known_issue_tracking ADD COLUMN shop_name text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'known_issue_tracking' AND column_name = 'cost'
  ) THEN
    ALTER TABLE known_issue_tracking ADD COLUMN cost decimal(10, 2);
  END IF;
END $$;
