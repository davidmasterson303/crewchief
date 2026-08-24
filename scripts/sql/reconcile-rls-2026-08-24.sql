/*
  ── Run this in the Supabase SQL editor before acting on any DB finding ──────

  The 24 Aug QA audit derived a complete 35-table RLS matrix by **replaying all
  85 migrations in order**. That is a file read, not a fact about the database,
  and `CLAUDE.md` §2 records that the two have disagreed **five times, in both
  directions**.

  PostgREST cannot answer any of this — it cannot see `information_schema` or
  `pg_catalog`, and there is no `exec_sql` RPC. So these six queries need the
  SQL editor, which is David's.

  ⚠ **Nothing in the DB lane should be changed until this has been run.** A
  migration that drops and recreates a policy which is already correct is a
  regression written from a stale map, and this project has produced one before.

  Copy the output into `docs/design-system-drift.md` or a dated note so the next
  reader has a fact rather than a replay.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. HIGHEST VALUE (DB-01). Does a signed-in user's own RLS narrow a policy's
--    EXISTS against another table?
--
--    `invoice_line_items`' DELETE policy is:
--
--      USING (EXISTS (SELECT 1 FROM vehicles WHERE vehicles.id = invoice_line_items.vehicle_id))
--
--    which is "a vehicle with this id exists", not "this vehicle is mine". Three
--    of its four policies have **no `TO` clause**, so they apply to PUBLIC, and
--    `components/DocumentLibrary.tsx` reads this table straight from the browser
--    — so RLS is the only control.
--
--    Whether the blast radius is total or bounded turns on one Postgres
--    behaviour that cannot be settled from files: whether the referenced
--    `vehicles` table's own RLS narrows that EXISTS.
--
--    ⚠ Run as **two different real users**, not as postgres — the service role
--    bypasses RLS and would report "everything is visible" for both.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT id, vehicle_id FROM invoice_line_items LIMIT 5;
-- Expect 0 rows as user B against user A's data if the EXISTS is narrowed.
-- If user B sees user A's rows, DB-01 is a live cross-tenant read.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DB-05. The function five surviving policies delegate their entire
--    ownership boundary to — and which **no migration in the corpus creates.**
--
--    Two things follow if it is missing or wrong. `supabase db reset` on a fresh
--    project aborts at `20260314234029` with `42883`, so every migration after
--    it never runs — a staging or reviewer environment built that way stops in
--    mid-March. And `20260727150000:85-87` says plainly that its body has never
--    been read: "whether it is SECURITY DEFINER, and whether its search_path is
--    pinned, both matter. Outstanding."
--
--    It could be `RETURN true` and every instrument in this repo would stay
--    green.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  p.proname,
  p.prosecdef AS security_definer,
  p.proconfig  AS settings,          -- null here means search_path is NOT pinned
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'user_owns_vehicle';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The whole matrix, live. Every policy that actually exists, by name and
--    command, with its predicate.
--
--    ⚠ `roles = {public}` is the DB-01/DB-03 shape: a policy with no `TO`
--    clause applies to everyone who holds the grant, which is what made
--    `location_zones` deletable by any signed-in user.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Grants — the layer every policy audit in this repo has missed.
--
--    `scripts/audit-rls.mjs` probes only `anon`, which holds no grant on
--    `invoice_line_items`, so it reports "ok" for a table `authenticated` can
--    write. A policy is irrelevant where there is no grant, and a grant is
--    unbounded where there is no policy; only both together say anything.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Confirm the entitlement lock is live rather than only in the corpus.
--
--    `20260812120000` gets this right four ways and the audit calls it the
--    standard the rest of the repo should be held to. Worth confirming it
--    survived, because it is the table that decides who has paid.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE tablename = 'account_entitlements';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. DB-08. Is there an index on `vehicles.user_id`?
--
--    Every RLS evaluation of a garage is a sequential scan without one, and the
--    `storage.objects` policies do a subquery against this table **per object
--    listed**. Invisible at four rows; the shape of thing that is invisible
--    until it is not.
--
--    `20260824130000` adds it idempotently — run this first to see whether it
--    is already there.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'vehicles';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Which migrations this database believes it has run.
--
--    The corpus/live disagreement is usually visible here first: a migration in
--    the folder and not in this list is one that has never been applied, and a
--    row here with no file is one somebody ran by hand.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 20;
