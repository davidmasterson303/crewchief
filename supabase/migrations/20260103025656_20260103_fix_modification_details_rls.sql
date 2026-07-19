/*
  # Fix Modification Details RLS Policies
  
  The modification_details RLS policies were requiring authenticated users with user_id matching vehicles.user_id.
  Since the MVP doesn't use authentication (user_id is null for all vehicles), these policies blocked all access.
  
  This migration updates the policies to allow all operations for the MVP phase.
  
  Changes:
  - Remove restrictive RLS policies that require auth
  - Add permissive policies that allow all operations (MVP only)
  - These will be tightened when authentication is added
*/

DROP POLICY IF EXISTS "Users can view modification details for their vehicles" ON modification_details;
DROP POLICY IF EXISTS "Users can insert modification details for their vehicles" ON modification_details;
DROP POLICY IF EXISTS "Users can update modification details for their vehicles" ON modification_details;

CREATE POLICY "Allow all operations on modification_details"
  ON modification_details FOR ALL USING (true) WITH CHECK (true);
