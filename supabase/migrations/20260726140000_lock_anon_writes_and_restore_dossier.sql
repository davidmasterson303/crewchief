/*
  # Lock the anon role to reads, and restore the demo dossier

  ## The urgent part

  An anonymous caller holding the publishable key — which ships in every page
  load — can DELETE rows from `vehicles` and `wishlist_items`. Verified
  against the live database with a filter matching zero rows, so the status
  code proves the permission without exercising it:

    DELETE /rest/v1/wishlist_items?id=eq.<nonexistent>   -> 204
    DELETE /rest/v1/vehicles?id=eq.<nonexistent>         -> 204
    DELETE /rest/v1/service_items?id=eq.<nonexistent>    -> 401  (no grant)

  Two things had to line up for this: the table grants `anon` write
  privileges, AND a policy admits the row. The June 2026 hardening pass
  revoked SELECT from anon across the schema but left INSERT, UPDATE, DELETE
  and TRUNCATE in place, and several tables still carry `USING (true)`
  policies from the original schema.

  Deleting a vehicle cascades through every child table. The three seeded demo
  vehicles are reachable this way, so the public demo — linked from a
  portfolio and shown to recruiters — can be destroyed by anyone who views its
  source. This is the fix for that.

  ## The rule this establishes

  `anon` reads demo data. It never writes anything, anywhere. Read access
  stays policy-scoped per table; write access is removed at the grant layer,
  which is the blunter and more reliable of the two. A future permissive
  policy then cannot re-open a write path on its own.

  ## Also included

  Restores the two tables the demo dashboard needs but cannot read, so the
  structured dossier stops rendering empty. Their fixes differ, confirmed by
  reading live policies rather than migration history:

    vehicle_knowledge_base  policy is ALREADY demo-scoped correctly
                            (user_id = auth.uid() OR is_demo) — needs only
                            the SELECT grant.
    recall_actions          policy has NO demo clause (user_id = auth.uid()
                            only) — granting alone would still 401, so it
                            needs a policy too.

  An earlier draft of this migration assumed vehicle_knowledge_base still
  carried the original `USING (true)` policy and rewrote it. That was wrong:
  it had already been tightened. Inference from migration files is not
  evidence about live state.
*/

-- ============================================================
-- 1. anon is read-only. Everywhere.
-- ============================================================

/*
  Applied across the whole schema rather than table by table, so a table added
  later inherits the restriction instead of depending on someone remembering.
  ALTER DEFAULT PRIVILEGES covers future tables created by this role.
*/
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

-- Sequences too: no writes means no need to advance one.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO anon;

-- ============================================================
-- 2. wishlist_items — replace the permissive policies (task 0.1)
-- ============================================================

/*
  These came from a February 2026 migration whose own comment called it a
  "temporary fix for development" while the app had no auth. It has auth now.
  Four policies with `USING (true)` and no TO clause admit every role.
*/
DROP POLICY IF EXISTS "Allow all wishlist select" ON wishlist_items;
DROP POLICY IF EXISTS "Allow all wishlist insert" ON wishlist_items;
DROP POLICY IF EXISTS "Allow all wishlist update" ON wishlist_items;
DROP POLICY IF EXISTS "Allow all wishlist delete" ON wishlist_items;

-- Demo rows only. A subquery rather than user_owns_vehicle(), which is
-- SECURITY INVOKER with EXECUTE revoked from anon.
CREATE POLICY "Anon reads demo wishlist"
  ON wishlist_items
  FOR SELECT
  TO anon
  USING (vehicle_id IN (SELECT id FROM vehicles WHERE is_demo));

CREATE POLICY "Users read own wishlist"
  ON wishlist_items
  FOR SELECT
  TO authenticated
  USING (
    user_owns_vehicle(vehicle_id)
    OR vehicle_id IN (SELECT id FROM vehicles WHERE is_demo)
  );

-- Writes are owner-only, and never touch demo rows: those vehicles are shared
-- across every visitor, so one person's edit changes what the next one sees.
CREATE POLICY "Users write own wishlist"
  ON wishlist_items
  FOR ALL
  TO authenticated
  USING (user_owns_vehicle(vehicle_id))
  WITH CHECK (user_owns_vehicle(vehicle_id));

-- ============================================================
-- 3. vehicle_knowledge_base — grant only
-- ============================================================

-- Existing policy already reads `user_id = auth.uid() OR is_demo`, so anon
-- is correctly limited to demo rows once it can see the table at all.
GRANT SELECT ON public.vehicle_knowledge_base TO anon;

-- ============================================================
-- 4. recall_actions — grant AND a demo policy
-- ============================================================

-- Its SELECT policy is authenticated-owner only, with no demo clause, so the
-- grant alone would leave anon at zero rows.
DROP POLICY IF EXISTS "Anon reads demo recall actions" ON recall_actions;

CREATE POLICY "Anon reads demo recall actions"
  ON recall_actions
  FOR SELECT
  TO anon
  USING (vehicle_id IN (SELECT id FROM vehicles WHERE is_demo));

GRANT SELECT ON public.recall_actions TO anon;

/*
  ## Verifying

  From the repo:  node scripts/verify-demo.mjs

  Expected after this migration:
    - both known gaps close; the dossier renders
    - the four existing anon reads keep working
    - no demo page redirects to /login

  And the probe that motivated section 1 should now be blocked:

    DELETE /rest/v1/vehicles?id=eq.<nonexistent>  -> 401

  Then move vehicle_knowledge_base and recall_actions out of
  ANON_READ_TABLES.knownGaps and into `required` in lib/demo-contract.ts, so
  the demo-availability suite starts guarding them.
*/
