/*
  # Make the migration history reproduce the live vehicles policies

  ## What this is now, and what it used to be

  This file used to *change* production. It no longer does. It exists to make a
  database rebuilt from `supabase/migrations` come up with the policies
  production already has.

  **Applying this to production is intended to be a no-op**, and it is written
  so that it provably is: it drops only policy names production does not have,
  and creates only policy names production does have — each guarded by an
  existence check. Against live, every statement below skips.

  ## Why the rewrite was necessary — the first version would have failed silently

  The original dropped four wide-open policies by the names found in the
  migration history, and created four narrow ones:

      "Allow select on vehicles"          20260103030740, USING (true)
      "Allow insert on vehicles"          20260103030740, WITH CHECK (true)
      "Allow update on vehicles"          20260103030740, USING (true)
      "Allow delete on vehicles"          20260103030740, USING (true)
      "Allow all operations on vehicles"  20260101215332, FOR ALL USING (true)

  A read-only sweep of production on 28 Jul 2026 found **none of those names
  exist live.** Live has four differently-named, correctly-scoped policies —
  someone fixed them by hand, through the Bolt or Supabase dashboard, and never
  wrote the change back.

  Had the original run:

    1. All five DROPs would have silently no-op'd — they name nothing that
       exists.
    2. The four new policies would have been *added alongside* the four live
       ones. Eight policies, not four.
    3. **Permissive policies OR together.** The new `AND NOT is_demo` guard
       would have been nullified by the broader live policy beside it.

  Access would not have widened, so nothing would have looked wrong. The one
  protection the migration existed to add simply would not have worked, while
  this file read as though it did — a known gap converted into an invisible
  one, which is worse than the gap.

  ## What production actually has (verified 28 Jul 2026, read-only)

    "Users can view own and demo vehicles"        SELECT  (user_id = auth.uid()) OR (is_demo = true)
    "Authenticated users can insert own vehicles" INSERT  role authenticated
    "Users can update own vehicles"               UPDATE  (user_id = auth.uid())
    "Users can delete own vehicles"               DELETE  (user_id = auth.uid())

  There is no `USING (true)` on `vehicles`, nor on any of the seven other tables
  swept. The `authenticated` role is scoped everywhere. This answers the
  question that had been open since 27 Jul — whether a signed-in user could
  reach another account's vehicle — at the policy-definition level. **A
  two-account behavioural test is still the only way to confirm it holds at
  runtime rather than on paper.**

  On UPDATE, live defines `USING` without `WITH CHECK`. That is not a gap:
  Postgres reuses the `USING` expression as the `WITH CHECK` expression when the
  latter is omitted, so a user cannot reassign `user_id` to another account. The
  form below matches live rather than "improving" on it.

  ## What this deliberately does NOT do

  **It does not add the `AND NOT is_demo` write guard.** Live protects demo rows
  through ownership — `user_id = auth.uid()` never matches for a demo row — not
  through an explicit flag check. Adding the guard is defence in depth and
  probably worth having, but it is a *change to production behaviour*, and
  folding it into a reconciliation is precisely how the first version of this
  file went wrong. It belongs in its own migration, applied deliberately, once
  this one has made the two agree.

  **It does not touch the six child tables.** They are scoped by
  `user_owns_vehicle(vehicle_id)` in the history *and* live, so those already
  agree.

  Two known divergences are recorded here and not addressed:

    - `wishlist_items` carries six policies live where four suffice: a `FOR ALL`
      catch-all beside three narrower ones doing the same ownership check, plus
      a separate anon demo read. Not a hole — everything resolves to the same
      boundary — but redundant coverage, and another fingerprint of
      hand-patching.
    - The body of `user_owns_vehicle()` has not been read. Six tables delegate
      their entire boundary to it, so whether it is SECURITY DEFINER, and
      whether its `search_path` is pinned, both matter. **Outstanding.**

  ## Verifying after this runs

    -- expect exactly the four names above, and nothing else
    select polname, polcmd, pg_get_expr(polqual, polrelid)
    from pg_policy p join pg_class c on c.oid = p.polrelid
    where relname = 'vehicles';

    -- and the behaviour that pays for it
    -- 1. anonymous /demo still lists three vehicles
    -- 2. node scripts/verify-demo.mjs <url> passes
    -- 3. a signed-in user sees, adds, edits and deletes only their own
*/

-- ============================================================
-- 1. Remove the wide-open policies the history creates.
--    No-ops against production; the whole point on a rebuild.
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow select on vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow insert on vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow update on vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow delete on vehicles" ON public.vehicles;

-- ============================================================
-- 2. Create production's policies, but only where absent.
--
--    Postgres has no CREATE POLICY IF NOT EXISTS, and an unguarded CREATE
--    would abort the whole migration against live. Guarding each one is what
--    makes this file safe to run anywhere, more than once.
-- ============================================================

DO $$
BEGIN
  /*
    SELECT is intentionally not restricted `TO authenticated`. `auth.uid()` is
    NULL for an anonymous visitor, so `user_id = auth.uid()` is NULL and the row
    is admitted only by `is_demo` — which is what keeps the public demo working
    without a session. Adding a role restriction here takes the demo down; §3
    item 6 records that happening once already.
  */
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'vehicles' AND p.polname = 'Users can view own and demo vehicles'
  ) THEN
    CREATE POLICY "Users can view own and demo vehicles"
      ON public.vehicles FOR SELECT
      USING ((user_id = auth.uid()) OR (is_demo = true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'vehicles' AND p.polname = 'Authenticated users can insert own vehicles'
  ) THEN
    CREATE POLICY "Authenticated users can insert own vehicles"
      ON public.vehicles FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  /*
    `WITH CHECK` is omitted to match live exactly. Postgres then reuses the
    `USING` expression for the new row, so reassigning `user_id` to another
    account is already refused. Spelling it out would make this a different
    policy definition from the one production runs — the thing this file exists
    to stop.
  */
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'vehicles' AND p.polname = 'Users can update own vehicles'
  ) THEN
    CREATE POLICY "Users can update own vehicles"
      ON public.vehicles FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid());
  END IF;

  /*
    The one that matters most: components/VehicleCard.tsx issues
    `supabase.from('vehicles').delete()` straight from the browser, with no
    server-side authorization in front of it. This policy is the only thing
    between a signed-in user and another account's vehicles.
  */
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'vehicles' AND p.polname = 'Users can delete own vehicles'
  ) THEN
    CREATE POLICY "Users can delete own vehicles"
      ON public.vehicles FOR DELETE
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- RLS itself, in case a rebuilt environment somehow reaches here without it.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
