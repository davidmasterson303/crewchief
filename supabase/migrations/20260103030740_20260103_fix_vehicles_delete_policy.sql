/*
  # Fix Vehicles DELETE Policy
  
  The "Allow all operations on vehicles" policy uses FOR ALL which doesn't properly
  handle DELETE operations. This migration creates explicit policies for each operation.
  
  Changes:
  - Drop the permissive FOR ALL policy
  - Create separate SELECT, INSERT, UPDATE, DELETE policies that all allow true
*/

DROP POLICY IF EXISTS "Allow all operations on vehicles" ON vehicles;

CREATE POLICY "Allow select on vehicles" ON vehicles FOR SELECT USING (true);
CREATE POLICY "Allow insert on vehicles" ON vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update on vehicles" ON vehicles FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete on vehicles" ON vehicles FOR DELETE USING (true);
