/*
  # Close the blanket policy on maintenance_line_items, then let the demo read it

  ## Why this is not just a GRANT

  The public demo's maintenance page is empty. `maintenance_line_items` holds
  real seeded service history for all three demo cars, and an anonymous read
  returns:

      401  {"code":"42501","message":"permission denied for table
            maintenance_line_items"}

  42501 is a GRANT failure, not an RLS failure — RLS denial returns `[]` with a
  200. The `anon` role was never added to the curated grant list in
  `20260629202102_20260629_security_hardening.sql`. The obvious fix is one line:

      GRANT SELECT ON public.maintenance_line_items TO anon;

  **That line alone would be a data leak.** Its safety argument is "RLS still
  decides which rows", and that argument holds only if the scoped policy is the
  only SELECT policy on the table. In this repo's history it is not:

    20260109174611_reset_maintenance_line_items_rls.sql
      CREATE POLICY "Allow all public operations on maintenance_line_items"
        ON maintenance_line_items FOR ALL TO public
        USING (true) WITH CHECK (true);

  No migration in this repository ever drops it. The March pair
  (`…234029_enforce_vehicle_ownership_and_rls`,
  `…234056_tighten_maintenance_line_items_select_policy`) create scoped policies
  *beside* it. Permissive policies OR together and `TO public` includes `anon`,
  so while that policy lives the `is_demo` arm of the scoped policy is
  decorative — and granting anon SELECT would expose every user's invoice line
  items, not the three demo cars'.

  This is the failure mode recorded on 28 Jul: a new policy added alongside a
  broader existing one, nullifying the guard, in a file that reads as though the
  hole was closed.

  ## Why this drops by introspection rather than by name

  The honest answer is that nobody can currently read this database's live
  policy list — dashboard access is the standing blocker — so a
  "run this check first, then decide" plan is unexecutable. Worse, name-based
  drops cannot be trusted on this table. The March migrations
  `DROP POLICY IF EXISTS "Users can view own maintenance line items"` and
  `"Users can insert own maintenance line items"`, and **no earlier migration in
  this repo ever created either name**. They were written against a live
  database whose policy names did not match the history. Whatever blanket policy
  is live may therefore carry a name that appears nowhere here.

  So this migration does not ask what the policy is called. It asks the catalog
  which policies are unconditional, drops those, and refuses to grant if any
  survive. It is safe to run against a database whose true state is unknown,
  which is the only kind of database we have.

  Idempotent: re-running finds nothing to drop and re-asserts the same end state.
*/

-- ─── 1. Drop every unconditional policy on the table, whatever it is called ───
--
-- "Unconditional" means a PERMISSIVE policy reachable by public/anon/authenticated
-- whose USING or WITH CHECK expression is literally `true`. Such a policy grants
-- blanket access regardless of any scoped policy sitting beside it.

-- The one the repo knows about, dropped by name. This line is redundant with
-- the sweep below and is here anyway: static analysis of the migration history
-- can see a named DROP and cannot see a catalog loop, so without it the history
-- still reads as though the blanket policy survives.
-- `lib/__tests__/rls-blanket-policies.test.ts` is the reader in question.
DROP POLICY IF EXISTS "Allow all public operations on maintenance_line_items"
  ON public.maintenance_line_items;

-- And the sweep, for whatever the live database calls it.
DO $$
DECLARE
  blanket record;
  dropped int := 0;
BEGIN
  FOR blanket IN
    SELECT policyname, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'maintenance_line_items'
      AND permissive = 'PERMISSIVE'
      AND (roles && ARRAY['public', 'anon', 'authenticated']::name[])
      AND (
        btrim(coalesce(qual::text,       '')) = 'true'
        OR btrim(coalesce(with_check::text, '')) = 'true'
      )
  LOOP
    RAISE NOTICE 'dropping blanket policy % (cmd=%, roles=%, qual=%, with_check=%)',
      blanket.policyname, blanket.cmd, blanket.roles, blanket.qual, blanket.with_check;
    EXECUTE format(
      'DROP POLICY %I ON public.maintenance_line_items',
      blanket.policyname
    );
    dropped := dropped + 1;
  END LOOP;

  RAISE NOTICE 'blanket policies dropped: %', dropped;
END $$;

-- ─── 2. Assert the scoped SELECT policy exists ────────────────────────────────
--
-- Recreated rather than assumed, because the history has already proved it can
-- disagree with the database. This is the policy from
-- 20260314234056_tighten_maintenance_line_items_select_policy.sql: a row is
-- readable if its vehicle belongs to the caller, or is a demo vehicle.
--
-- For anon, auth.uid() is NULL, so the ownership arm can never match and
-- `is_demo = true` is the only reachable set. `anon` already holds SELECT on
-- public.vehicles, which this EXISTS subquery needs in order to evaluate.

DROP POLICY IF EXISTS "Users can view own maintenance line items"
  ON public.maintenance_line_items;

CREATE POLICY "Users can view own maintenance line items"
  ON public.maintenance_line_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles
      WHERE vehicles.id = maintenance_line_items.vehicle_id
        AND (vehicles.user_id = auth.uid() OR vehicles.is_demo = true)
    )
  );

-- ─── 3. Refuse to grant if anything unconditional survived ────────────────────
--
-- The grant's entire safety argument is that RLS narrows anon to demo rows. If
-- that is not true, this migration must fail rather than hand out the grant —
-- a failed migration is recoverable, a silent leak is not.

DO $$
DECLARE
  survivors int;
BEGIN
  SELECT count(*) INTO survivors
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'maintenance_line_items'
    AND permissive = 'PERMISSIVE'
    AND (roles && ARRAY['public', 'anon', 'authenticated']::name[])
    AND (
      btrim(coalesce(qual::text,       '')) = 'true'
      OR btrim(coalesce(with_check::text, '')) = 'true'
    );

  IF survivors > 0 THEN
    RAISE EXCEPTION
      'Refusing to GRANT: % unconditional policy/policies remain on maintenance_line_items. '
      'Granting anon SELECT while a USING(true) policy is live would expose every '
      'user''s invoice line items, not just the demo vehicles''.', survivors;
  END IF;
END $$;

-- ─── 4. The grant itself ──────────────────────────────────────────────────────
--
-- SELECT only. Committed as a migration rather than applied in the dashboard
-- because a dashboard-only grant is invisible to a rebuild — the same drift
-- that made this table's live state unknowable in the first place.
-- `20260629203613_20260629_restore_demo_anon_grants.sql` sets the precedent.

GRANT SELECT ON public.maintenance_line_items TO anon;
