/*
  # Enforce Vehicle Ownership & Finalize RLS

  ## Summary
  This migration completes Pillar 2 of the security architecture. It backfills
  user_id on all existing vehicles, creates a dedicated demo auth user for demo
  vehicles, adds the foreign key constraint from vehicles.user_id to auth.users,
  and tightens a remaining permissive policy escape hatch.

  ## Changes

  ### 1. Demo Auth User
  - Creates a synthetic auth user (id: 00000000-0000-0000-0000-000000000001)
    with email demo@crewchief.app. This user is the permanent owner of the three
    demo vehicles and is never used for real sign-in.

  ### 2. User ID Backfill
  - Demo vehicles (is_demo = true): assigned to the demo user above.
  - Real non-demo vehicles with null user_id: assigned to the existing real user
    (d9495bfa-6cae-47c3-820d-31778677ed76).

  ### 3. Schema Change: vehicles.user_id
  - Adds NOT NULL constraint — every vehicle must have an owner.
  - Adds FOREIGN KEY to auth.users(id) ON DELETE CASCADE — deleting an auth user
    cascades and removes all their vehicles (and via existing FK chains, all child
    data).

  ### 4. RLS Policy: maintenance_line_items INSERT
  - Removes the (vehicle_id IS NULL) escape hatch from the INSERT WITH CHECK clause.
    Zero rows in production have a null vehicle_id, so this escape is safe to close.

  ## Security Notes
  - All RLS policies on child tables already use user_owns_vehicle(vehicle_id) which
    checks vehicles.user_id = auth.uid(). SELECT policies additionally allow
    is_demo = true so the public /demo route can read demo data without auth.
  - The demo auth user's vehicles are permanently readable by everyone via is_demo = true,
    but they cannot be modified (user_owns_vehicle returns false for anon users).
*/

-- ============================================================
-- 1. Create the demo auth user (idempotent)
-- ============================================================
INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'demo@crewchief.app',
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{}',
  false,
  false,
  false,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Backfill user_id on all vehicles that still have NULL
-- ============================================================

-- Demo vehicles → demo auth user
UPDATE vehicles
SET user_id = '00000000-0000-0000-0000-000000000001'
WHERE is_demo = true
  AND user_id IS NULL;

-- Real vehicles → the existing real user
UPDATE vehicles
SET user_id = 'd9495bfa-6cae-47c3-820d-31778677ed76'
WHERE is_demo = false
  AND user_id IS NULL;

-- ============================================================
-- 3. Enforce NOT NULL + FK on vehicles.user_id
-- ============================================================

ALTER TABLE vehicles
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- ============================================================
-- 4. Close the maintenance_line_items INSERT escape hatch
-- ============================================================

DROP POLICY IF EXISTS "Users can insert own maintenance line items"
  ON maintenance_line_items;

CREATE POLICY "Users can insert own maintenance line items"
  ON maintenance_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (user_owns_vehicle(vehicle_id));

-- Also tighten the UPDATE and DELETE policies to remove IS NULL checks
DROP POLICY IF EXISTS "Users can update own maintenance line items"
  ON maintenance_line_items;

CREATE POLICY "Users can update own maintenance line items"
  ON maintenance_line_items
  FOR UPDATE
  TO authenticated
  USING (user_owns_vehicle(vehicle_id))
  WITH CHECK (user_owns_vehicle(vehicle_id));

DROP POLICY IF EXISTS "Users can delete own maintenance line items"
  ON maintenance_line_items;

CREATE POLICY "Users can delete own maintenance line items"
  ON maintenance_line_items
  FOR DELETE
  TO authenticated
  USING (user_owns_vehicle(vehicle_id));
