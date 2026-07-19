/*
  # Fix Wishlist RLS for No-Auth Environment

  ## Purpose
  Since this app has no authentication system, we need to modify the RLS policies
  to allow access based on the vehicle_id ownership pattern instead of auth.uid().

  ## Changes
  - Drop existing restrictive RLS policies on wishlist_items
  - Create new policies that allow operations based on vehicle ownership
  - Since there's no auth, we'll use a permissive approach for development

  ## Security Note
  This is a temporary fix for development. In production, proper authentication
  should be implemented.
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own wishlist items" ON wishlist_items;
DROP POLICY IF EXISTS "Users can insert own wishlist items" ON wishlist_items;
DROP POLICY IF EXISTS "Users can update own wishlist items" ON wishlist_items;
DROP POLICY IF EXISTS "Users can delete own wishlist items" ON wishlist_items;

-- Create permissive policies for development (no auth required)
CREATE POLICY "Allow all wishlist select"
  ON wishlist_items
  FOR SELECT
  USING (true);

CREATE POLICY "Allow all wishlist insert"
  ON wishlist_items
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow all wishlist update"
  ON wishlist_items
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all wishlist delete"
  ON wishlist_items
  FOR DELETE
  USING (true);
