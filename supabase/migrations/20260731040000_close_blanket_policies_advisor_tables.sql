/*
  # Close the blanket policies on the three remaining advisor tables, then let the demo read them

  Applied and verified against the live database on 1 Aug 2026 — catalog read as
  `postgres`: no unconditional policy survives on the three tables, each carries
  one SELECT policy with both the ownership and demo arms, and `anon` holds
  SELECT on all three.

  Ran AFTER 20260731030000_close_blanket_policy_then_grant_anon_read.sql, which
  is its prerequisite and is also applied.

  This header said "DRAFT — not yet placed in supabase/migrations/" for a day
  after the file was committed, placed, and run. Left as a note rather than
  silently deleted: a stale status line on an applied migration is how a reader
  mis-scopes their next move, and this file's own subject is drift between what
  the repository says and what the database does.

  ## Scope, and what is deliberately excluded

  `app/consultant/[vehicleId]/page.tsx` is a client component that fires eleven
  reads in one Promise.all. Six of them return 42501 for `anon` against the live
  database. 20260731030000 clears `maintenance_line_items`. This clears three
  more:

      service_items          known_issue_tracking        modification_tracking

  `vehicle_documents` and `consultant_conversations` are the remaining two and
  are NOT in this file. They hold real invoices and real chat history, and
  `vehicle_documents` still carries an untouched `FOR ALL USING (true)` from
  20260101215332. Those need policies written deliberately, not this pattern
  applied a fourth and fifth time.

  ## Why each of these needs a policy created rather than restored

  Unlike `maintenance_line_items`, none of these three has ever had a scoped
  SELECT policy to recreate:

    service_items
      20260101215332  "Allow all operations on service_items"  FOR ALL USING (true)
      20260104005245  dropped that, and replaced it with four policies that are
                      each still unconditional:
                        "Users can view their service items"    SELECT USING (true)
                        "Users can insert their service items"  INSERT WITH CHECK (true)
                        "Users can update their service items"  UPDATE USING (true)
                        "Users can delete their service items"  DELETE USING (true)

    known_issue_tracking
      20260101231015  "Allow all operations on known_issue_tracking"  FOR ALL USING (true)
      never dropped

    modification_tracking
      20260101231015  "Allow all operations on modification_tracking"  FOR ALL USING (true)
      never dropped

  **The three blocks above describe this repository, and live does not match
  them.** Read as `postgres` on 1 Aug: `known_issue_tracking` carries scoped
  `user_owns_vehicle(vehicle_id)` policies on DELETE and UPDATE that no
  migration in this corpus authors, and it carried a second SELECT policy —
  "Users can view own issue tracking" — byte-identical to the one created below
  and named nowhere in the drop list (removed by 20260801130000).

  That is a second data point for the standing constraint: the migration corpus
  does not reproduce the live database, and any claim about "what the database
  does" needs a live check rather than a file read. It is also the reason the
  sweep below introspects the catalog instead of dropping by name — a
  name-driven version of this migration would have missed policies it has never
  heard of, and reported success.

  So the sweep below removes everything and the scoped policy is newly authored.
  If a copy of 20260731030000 were used instead, its step-2 "recreate" would find
  nothing to recreate, the grant would land on a table with zero SELECT policies,
  anon would get `200 []`, and it would read as though the grant had failed.

  ## The ownership arm is load-bearing, not decoration

  The consultant page reads these three tables with the *signed-in user's*
  session as well as anonymously. Those authenticated reads work today only
  because the live policy is `USING (true)`. A demo-only policy
  (`vehicles.is_demo = true` alone) would fix anon and simultaneously blank the
  consultant page for every real account. Every SELECT policy below therefore
  carries both arms:

      vehicles.user_id = auth.uid()   OR   vehicles.is_demo = true

  For anon, `auth.uid()` is NULL, so the ownership arm can never match and the
  demo arm is the only reachable set. All three tables have
  `vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL`, so the
  join is total — there is no NULL vehicle_id row that could slip the predicate.
  `anon` already holds SELECT on public.vehicles (20260629203613), which the
  EXISTS subquery needs in order to evaluate.

  ## On dropping the write policies

  The sweep matches on `qual = 'true' OR with_check = 'true'` regardless of
  `cmd`, so on `service_items` it removes the INSERT, UPDATE and DELETE policies
  as well as the SELECT one. That is intended and it breaks nothing: all fifteen
  write sites across these three tables go through `getServiceRoleClient()`,
  which bypasses RLS entirely — service_items 5/5, known_issue_tracking 3/3,
  modification_tracking 7/7. No browser client writes these tables. Leaving the
  tables with no write policy is the correct end state, not a side effect: it
  means a leaked publishable key cannot write them.

  ## Why it drops by catalog introspection rather than by name

  Same reason as 20260731030000: this database's live policy names have already
  been proved to disagree with this repo's history. The sweep is what actually
  guarantees the end state; the named drops keep the migration history readable
  by a human or a static scan, neither of which can see a catalog loop.

  **Correction to 20260731030000's version of this note.** That file justifies
  its named drop by citing `lib/__tests__/rls-blanket-policies.test.ts` as "the
  reader in question". **No such test exists.** The repo has
  `lib/__tests__/vehicles-rls-posture.test.ts`, which checks this exact pattern
  and is pointed only at `vehicles`; generalising it across all tables is
  roadmap item E, not started.

  The practical consequence is worth stating plainly rather than leaving in a
  citation: **nothing currently stops these policies coming back.** Both
  migrations close the hole in the database; neither is enforced by anything
  that would fail a build if a future migration reopened it. Item E is what
  would, and after this file lands it is worth more, not less — there will be
  four tables' worth of end state resting on nobody re-adding a USING(true).

  Idempotent: re-running finds nothing to drop and re-asserts the same end state.
*/

-- ─── 1. Named drops, for the static reader ────────────────────────────────────
--
-- Redundant with the sweep in step 2. Present so that the migration history
-- still reads as though these policies were closed.

DROP POLICY IF EXISTS "Allow all operations on service_items"          ON public.service_items;
DROP POLICY IF EXISTS "Users can view their service items"             ON public.service_items;
DROP POLICY IF EXISTS "Users can insert their service items"           ON public.service_items;
DROP POLICY IF EXISTS "Users can update their service items"           ON public.service_items;
DROP POLICY IF EXISTS "Users can delete their service items"           ON public.service_items;
DROP POLICY IF EXISTS "Allow all operations on known_issue_tracking"   ON public.known_issue_tracking;
DROP POLICY IF EXISTS "Allow all operations on modification_tracking"  ON public.modification_tracking;

-- ─── 2. Sweep every unconditional policy off all three tables ─────────────────
--
-- "Unconditional" means a PERMISSIVE policy reachable by public/anon/authenticated
-- whose USING or WITH CHECK expression is literally `true`.

DO $$
DECLARE
  tbl      text;
  blanket  record;
  dropped  int := 0;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['service_items', 'known_issue_tracking', 'modification_tracking']
  LOOP
    FOR blanket IN
      SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = tbl
        AND permissive = 'PERMISSIVE'
        AND (roles && ARRAY['public', 'anon', 'authenticated']::name[])
        AND (
          btrim(coalesce(qual::text,       '')) = 'true'
          OR btrim(coalesce(with_check::text, '')) = 'true'
        )
    LOOP
      RAISE NOTICE 'dropping blanket policy %.% (cmd=%, roles=%, qual=%, with_check=%)',
        tbl, blanket.policyname, blanket.cmd, blanket.roles, blanket.qual, blanket.with_check;
      EXECUTE format('DROP POLICY %I ON public.%I', blanket.policyname, tbl);
      dropped := dropped + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'blanket policies dropped across all three tables: %', dropped;
END $$;

-- ─── 3. Author the scoped SELECT policy on each ───────────────────────────────
--
-- Ownership arm first, demo arm second. Dropped-then-created rather than
-- CREATE IF NOT EXISTS so that re-running converges on this exact definition
-- even if an earlier run left a different one behind.

DROP POLICY IF EXISTS "Users can view own service items" ON public.service_items;
CREATE POLICY "Users can view own service items"
  ON public.service_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles
      WHERE vehicles.id = service_items.vehicle_id
        AND (vehicles.user_id = auth.uid() OR vehicles.is_demo = true)
    )
  );

DROP POLICY IF EXISTS "Users can view own known issue tracking" ON public.known_issue_tracking;
CREATE POLICY "Users can view own known issue tracking"
  ON public.known_issue_tracking
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles
      WHERE vehicles.id = known_issue_tracking.vehicle_id
        AND (vehicles.user_id = auth.uid() OR vehicles.is_demo = true)
    )
  );

DROP POLICY IF EXISTS "Users can view own modification tracking" ON public.modification_tracking;
CREATE POLICY "Users can view own modification tracking"
  ON public.modification_tracking
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles
      WHERE vehicles.id = modification_tracking.vehicle_id
        AND (vehicles.user_id = auth.uid() OR vehicles.is_demo = true)
    )
  );

-- ─── 4. Refuse to grant if anything unconditional survived, on any of them ────
--
-- The grants' entire safety argument is that RLS narrows anon to demo rows. If
-- that is not true for even one of the three, this migration must fail rather
-- than hand out any grant. A failed migration is recoverable; a silent leak of
-- a real account's service history, fault log or modification list is not.

DO $$
DECLARE
  survivors int;
  detail    text;
BEGIN
  -- tablename and policyname are of type `name`; cast explicitly rather than
  -- relying on implicit resolution of `name || unknown`.
  SELECT count(*), string_agg(tablename::text || '.' || policyname::text, ', ')
    INTO survivors, detail
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('service_items', 'known_issue_tracking', 'modification_tracking')
    AND permissive = 'PERMISSIVE'
    AND (roles && ARRAY['public', 'anon', 'authenticated']::name[])
    AND (
      btrim(coalesce(qual::text,       '')) = 'true'
      OR btrim(coalesce(with_check::text, '')) = 'true'
    );

  IF survivors > 0 THEN
    RAISE EXCEPTION
      'Refusing to GRANT: % unconditional policy/policies remain (%). Granting anon '
      'SELECT while a USING(true) policy is live would expose every user''s rows, '
      'not just the demo vehicles''.', survivors, detail;
  END IF;
END $$;

-- ─── 5. Also refuse if the scoped policies are not actually in place ──────────
--
-- Step 3 could in principle be undone by a concurrent change, and a grant on a
-- table with no SELECT policy produces `200 []` — which looks like a broken
-- grant rather than a missing policy, and costs an hour to diagnose.

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY['service_items', 'known_issue_tracking', 'modification_tracking']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT'
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to GRANT: no SELECT policy on %. The grant would return an empty '
      'result set rather than demo rows.', missing;
  END IF;
END $$;

-- ─── 6. The grants ────────────────────────────────────────────────────────────
--
-- SELECT only. Committed as a migration rather than applied in the dashboard,
-- because a dashboard-only grant is invisible to a rebuild — the same drift that
-- made these tables' live state unknowable in the first place.
-- 20260629203613_20260629_restore_demo_anon_grants.sql sets the precedent.

GRANT SELECT ON public.service_items          TO anon;
GRANT SELECT ON public.known_issue_tracking   TO anon;
GRANT SELECT ON public.modification_tracking  TO anon;

/*
  ## Verifying

  Run after. Every row must say OK.

    -- 1. No unconditional policy survives on any of the three.
    SELECT CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL: ' || count(*)::text END AS blanket_policies
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('service_items','known_issue_tracking','modification_tracking')
      AND permissive = 'PERMISSIVE'
      AND (roles && ARRAY['public','anon','authenticated']::name[])
      AND (btrim(coalesce(qual::text,'')) = 'true' OR btrim(coalesce(with_check::text,'')) = 'true');

    -- 2. Each table has exactly one SELECT policy, and it carries both arms.
    SELECT tablename,
           CASE WHEN qual::text LIKE '%auth.uid()%' AND qual::text LIKE '%is_demo%'
                THEN 'OK' ELSE 'FAIL: missing an arm' END AS scoped_select
    FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT'
      AND tablename IN ('service_items','known_issue_tracking','modification_tracking')
    ORDER BY tablename;

    -- 3. anon holds SELECT and nothing else on all three.
    SELECT table_name,
           CASE WHEN string_agg(privilege_type, ',' ORDER BY privilege_type) = 'SELECT'
                THEN 'OK' ELSE 'FAIL: ' || string_agg(privilege_type, ',' ORDER BY privilege_type) END AS anon_privs
    FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'
      AND table_name IN ('service_items','known_issue_tracking','modification_tracking')
    GROUP BY table_name ORDER BY table_name;

  The check that actually matters is not in SQL: it is that an anonymous REST
  read of each table returns only rows belonging to the three demo vehicles.
  Cowork can confirm that from outside with the publishable key, and should,
  because it is the only one of these checks that tests the thing we care about
  rather than the thing we wrote.
*/
