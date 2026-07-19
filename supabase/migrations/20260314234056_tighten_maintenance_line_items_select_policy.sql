/*
  # Tighten maintenance_line_items SELECT Policy

  ## Summary
  The SELECT policy on maintenance_line_items had a residual (vehicle_id IS NULL)
  escape hatch from earlier development. Zero rows in production have a null
  vehicle_id, so this clause is safe to remove.

  The new policy allows reading line items for:
  - Authenticated user's own vehicles (user_id = auth.uid())
  - Demo vehicles (is_demo = true) — required for the public /demo route

  No data access changes for any real user; this only closes a dead code path.
*/

DROP POLICY IF EXISTS "Users can view own maintenance line items"
  ON maintenance_line_items;

CREATE POLICY "Users can view own maintenance line items"
  ON maintenance_line_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = maintenance_line_items.vehicle_id
        AND (vehicles.user_id = auth.uid() OR vehicles.is_demo = true)
    )
  );
