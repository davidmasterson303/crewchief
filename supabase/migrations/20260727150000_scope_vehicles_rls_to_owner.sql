/*
  # Scope the vehicles table's own RLS policies to the owner

  ## NOT YET APPLIED — and the finding below has been PARTLY CORRECTED. Read this first.

  ## CORRECTION, 29 Jul — measured against the live database

  When this was written, no non-demo vehicle existed, so the anon-leak test was
  impossible and the conclusion rested on the migration history alone. A real
  private vehicle now exists, and the test was run:

    anon SELECT, listing all vehicles      -> 3 demo rows, nothing else
    anon SELECT by the private vehicle id  -> 0 rows
    anon SELECT by a demo vehicle id       -> 1 row
    anon on its child tables (knowledge
      base, health summary, nhtsa, wishlist)
      for the private vehicle              -> 0 rows each
    same child tables for a demo vehicle   -> readable

  **The live database scopes anon correctly.** The `USING (true)` policy in the
  migration history is NOT what is running.

  So what was right and what was wrong:

    RIGHT — the migration history really does leave `vehicles` with
            `USING (true)` for SELECT/INSERT/UPDATE/DELETE, never dropped.
    WRONG — the inference that the live database is therefore open. It is not,
            at least for anon.

  ## What this actually means, which is a different problem

  **The migrations do not reproduce the live database.** Someone fixed these
  policies outside the migration history — most likely through the Bolt or
  Supabase dashboard. That means a database rebuilt from `supabase/migrations`
  — a fresh environment, a local stack, a disaster recovery — comes up
  **wide open**, while production is fine.

  It also answers the question in the Wed 29 Jul prompt: the §2 task 0.2 audit
  was probably not wrong, and nothing regressed. The audit read the live
  database; this file read the history; they disagree because the history is
  incomplete.

  ## Therefore: do NOT apply this blind

  Permissive policies OR together. This migration's DROPs target policies *by
  name* — names taken from the history, which may not be what live actually
  has. Applying it could add a narrow policy alongside an unknown existing one
  and change nothing, while reading as though the hole was closed.

  **Get the live policy list first**, from the Supabase SQL editor:

      select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
      from pg_policy p join pg_class c on c.oid = p.polrelid
      where relname = 'vehicles';

  Then either reconcile this migration to match what is really there, or
  supersede it deliberately. The goal is that the history and the database
  agree — not that this particular file runs.

  ## Still genuinely unknown

  Whether the **authenticated** role is scoped. Anon is proven; a signed-in
  user reading another user's vehicle has not been tested, because it needs a
  second account. That is the remaining test and it is cheap now that signup
  works.

  ## The finding

  Every child table (`service_items`, `vehicle_documents`, `consultant_conversations`,
  …) is scoped with `user_owns_vehicle(vehicle_id)`. The `vehicles` table itself is
  not. Its policies have been unrestricted since `20260103030740`:

      CREATE POLICY "Allow select on vehicles" ON vehicles FOR SELECT USING (true);
      CREATE POLICY "Allow insert on vehicles" ON vehicles FOR INSERT WITH CHECK (true);
      CREATE POLICY "Allow update on vehicles" ON vehicles FOR UPDATE USING (true) WITH CHECK (true);
      CREATE POLICY "Allow delete on vehicles" ON vehicles FOR DELETE USING (true);

  No later migration drops or replaces them. `20260314234029_enforce_vehicle_ownership_and_rls`
  is the one that sounds like it would, and it does add the NOT NULL and the foreign
  key to `auth.users` — but its own security notes say the ownership checks live on
  *child* tables, and it leaves the four policies above untouched.

  ## Why it matters

  RLS is the only enforcement for anything the browser client queries directly, and
  the app does query `vehicles` directly:

    - `hooks/useVehicles.ts`, `app/demo/page.tsx`, and the dashboard, consultant,
      documents and vehicle-info pages all SELECT from `vehicles` with the session
      client.
    - `components/VehicleCard.tsx:170` runs
      `supabase.from('vehicles').delete().eq('id', vehicle.id)` — a DELETE issued
      straight from the browser, with no server-side authorization in front of it.

  `lib/api-auth.ts` protects the API routes and server actions, but it is not in the
  path for any of the above. With `USING (true)`, a signed-in user can read, modify
  and delete **any** vehicle row, including the three demo vehicles that the
  recruiter-facing public demo renders.

  ## What has and has not been verified (27 Jul)

  VERIFIED against the live database:
    - The `anon` role cannot INSERT, UPDATE or DELETE — it fails with "permission
      denied for table vehicles", which is the *table GRANT* from
      `20260726140000_lock_anon_writes_and_restore_dossier`, not a row policy.
    - `anon` can SELECT, and sees the three demo rows.

  NOT VERIFIED — needs a signed-in session, which the session that wrote this could
  not obtain:
    - Whether the `authenticated` role can read/modify/delete other users' rows.
      The migration history says yes. The `authenticated` GRANT must exist, or
      VehicleCard's client-side delete could not work at all.

  Migrations are not proof of live state — this project's Supabase is Bolt-managed
  and may have drifted. **Run the check at the bottom before and after applying.**

  ## The policy

  Owner-or-demo for reads; owner-and-not-demo for writes. Demo rows become readable
  by everyone and writable by nobody, which is what `lib/api-auth.ts` already
  enforces at the application layer (`intent: 'write'` on a demo vehicle is a 403).
  Service-role callers bypass RLS entirely, so migrations and the seeding scripts
  are unaffected.
*/

-- ============================================================
-- Replace the unrestricted policies
-- ============================================================

DROP POLICY IF EXISTS "Allow select on vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow insert on vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow update on vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow delete on vehicles" ON public.vehicles;

-- Also drop the original catch-all in case an environment predates 20260103030740.
DROP POLICY IF EXISTS "Allow all operations on vehicles" ON public.vehicles;

/*
  SELECT — demo rows are public by design; everything else is owner-only.

  `auth.uid()` is NULL for anon, so `user_id = auth.uid()` is NULL and the row is
  admitted only when `is_demo`. That is what keeps the anonymous demo working, and
  it is the clause to be most careful with: §3 item 6 records the demo going down
  when route protection stopped accounting for anonymous visitors.
*/
CREATE POLICY "vehicles_select_own_or_demo"
  ON public.vehicles FOR SELECT
  USING (is_demo OR user_id = auth.uid());

/*
  INSERT — you may only create vehicles you own, and may not mint demo rows.
  Without the is_demo guard, any user could create a row that every visitor to the
  public demo would then see.
*/
CREATE POLICY "vehicles_insert_own"
  ON public.vehicles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT is_demo);

/*
  UPDATE — owner only, and never a demo row.

  `WITH CHECK` as well as `USING`: without it a user could update their own row and
  set `user_id` to someone else, or flip `is_demo` true and publish it into the demo.
*/
CREATE POLICY "vehicles_update_own"
  ON public.vehicles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND NOT is_demo)
  WITH CHECK (user_id = auth.uid() AND NOT is_demo);

/*
  DELETE — owner only, and never a demo row. This is the one that matters most:
  components/VehicleCard.tsx deletes from the browser, so this policy is the only
  thing standing between a signed-in user and the public demo's vehicles.
*/
CREATE POLICY "vehicles_delete_own"
  ON public.vehicles FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND NOT is_demo);

/*
  ── BEFORE APPLYING ────────────────────────────────────────────────────────────

  Confirm the finding is real on the live database rather than only in the
  migration history. Signed in as a real user, from the browser console:

      await supabase.from('vehicles').select('id,make,is_demo')

  If that returns the three demo vehicles plus any other account's vehicles, the
  policies are unrestricted and this migration is needed. If it returns only your
  own vehicles plus the demo rows, the live state has already diverged from the
  migrations and this should be reconciled rather than applied blind.

  ── AFTER APPLYING — all four must hold ────────────────────────────────────────

  1. Anonymous /demo still lists three vehicles, and a demo dashboard still renders.
     This is the one that takes the demo down if the SELECT clause is wrong.
  2. `node scripts/verify-demo.mjs <url>` passes.
  3. A signed-in user sees their own vehicles and can add, edit and delete them.
  4. A signed-in user CANNOT delete a demo vehicle from the browser console:
         await supabase.from('vehicles').delete().eq('id','a1000000-0000-0000-0000-000000000001')
     must affect zero rows.

  Apply to the CI project first, not to the project the live demo reads from.
*/
