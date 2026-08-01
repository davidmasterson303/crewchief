-- CrewChief — live state of the eight tables still on the blanket baseline
--
-- Run in the Supabase dashboard SQL Editor. READ-ONLY: selects from catalog
-- views and counts rows. Changes nothing, and contains no DROP, so it will not
-- trigger the "Potential issue detected" modal.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Why this exists, and why it comes before the migration rather than after
-- ───────────────────────────────────────────────────────────────────────────
--
-- `rls-blanket-policies.test.ts` lists eight tables whose migration history
-- declares `FOR ALL USING (true)`. Closing them is the remaining backlog.
--
-- On 1 Aug a migration was written for the last two of that list on exactly
-- that evidence — the corpus and the static replay — and its commit asserted a
-- live hole in consequence. A catalog read found both tables already scoped
-- with owner and demo arms, RLS enabled, and no unconditional policy anywhere.
-- Live was tighter than the repo. The migration's two real effects were still
-- wanted, but its stated premise was false.
--
-- That was the fourth corpus-versus-live disagreement, and the first in that
-- direction. So the order is now: measure, then write. This script is the
-- measurement, and its output is the input to the next migration.
--
-- Note what an anonymous REST probe cannot answer here. `anon` holds no grant
-- on most of these, so it returns 42501 — a GRANT failure, raised before any
-- policy is consulted. "anon blocked" is true and says nothing about what an
-- `authenticated` caller reaches. That is the gap section 4 measures.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Is RLS even on?
--
-- A policy is decoration if `relrowsecurity` is false. Checked first because
-- every later section is meaningless without it.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  c.relname                        AS table_name,
  c.relrowsecurity                 AS rls_enabled,
  c.relforcerowsecurity            AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'consultant_documents', 'labor_bundles', 'location_zones',
    'modification_details', 'nhtsa_data', 'quote_requests',
    'vehicle_health_summary', 'vehicle_knowledge_base'
  )
ORDER BY c.relname;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Every policy actually present, whatever its name.
--
-- Read the names carefully against the migration corpus. Three strays have
-- already been found under names no migration here uses — which is why the
-- recent migrations sweep by introspection rather than DROP ... IF EXISTS.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  permissive,
  roles,
  qual::text        AS using_expr,
  with_check::text  AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'consultant_documents', 'labor_bundles', 'location_zones',
    'modification_details', 'nhtsa_data', 'quote_requests',
    'vehicle_health_summary', 'vehicle_knowledge_base'
  )
ORDER BY tablename, cmd, policyname;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Which of them are genuinely unconditional, live.
--
-- Same predicate the migrations use to sweep. Empty result means the corpus
-- overstates the backlog and the next migration is smaller than the test's
-- baseline implies — the ed97038 situation, caught in advance this time.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND permissive = 'PERMISSIVE'
  AND (roles && ARRAY['public', 'anon', 'authenticated']::name[])
  AND (
    btrim(coalesce(qual::text,       '')) = 'true'
    OR btrim(coalesce(with_check::text, '')) = 'true'
  )
ORDER BY tablename, policyname;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Grants — the half an anonymous probe cannot see.
--
-- A blanket policy only matters for a role that holds a grant. `authenticated`
-- generally does and `anon` generally does not, so this column pair is what
-- decides whether an entry in the baseline is reachable by anybody.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'consultant_documents', 'labor_bundles', 'location_zones',
    'modification_details', 'nhtsa_data', 'quote_requests',
    'vehicle_health_summary', 'vehicle_knowledge_base'
  )
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Is there anything to leak, and would a REST test prove anything?
--
-- The lesson from A2 on 1 Aug. An anonymous read returning "only demo rows"
-- looks like proof of correct scoping and proves nothing when every row in the
-- table belongs to a demo vehicle — there was no other row it could have
-- returned. That test would have passed identically against a wide-open table.
--
-- `non_demo_rows` is the column that decides whether a REST check has teeth.
-- Zero means: verify from the catalog, and do not report a REST pass as
-- evidence of scoping.
--
-- The three vehicle-scoped tables can be split by owner. The rest are either
-- empty or shared reference data with no vehicle_id, so they get a bare count.
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'vehicle_knowledge_base' AS table_name,
       count(*)                                                   AS total_rows,
       count(*) FILTER (WHERE v.is_demo)                           AS demo_rows,
       count(*) FILTER (WHERE v.is_demo IS NOT TRUE)               AS non_demo_rows
FROM public.vehicle_knowledge_base t
LEFT JOIN public.vehicles v ON v.id = t.vehicle_id
UNION ALL
SELECT 'vehicle_health_summary',
       count(*), count(*) FILTER (WHERE v.is_demo),
       count(*) FILTER (WHERE v.is_demo IS NOT TRUE)
FROM public.vehicle_health_summary t
LEFT JOIN public.vehicles v ON v.id = t.vehicle_id
UNION ALL
SELECT 'nhtsa_data',
       count(*), count(*) FILTER (WHERE v.is_demo),
       count(*) FILTER (WHERE v.is_demo IS NOT TRUE)
FROM public.nhtsa_data t
LEFT JOIN public.vehicles v ON v.id = t.vehicle_id
UNION ALL
SELECT 'consultant_documents', count(*), NULL, NULL FROM public.consultant_documents
UNION ALL
SELECT 'quote_requests',       count(*), NULL, NULL FROM public.quote_requests
UNION ALL
SELECT 'labor_bundles',        count(*), NULL, NULL FROM public.labor_bundles
UNION ALL
SELECT 'location_zones',       count(*), NULL, NULL FROM public.location_zones
UNION ALL
SELECT 'modification_details', count(*), NULL, NULL FROM public.modification_details
ORDER BY table_name;

-- ───────────────────────────────────────────────────────────────────────────
-- What to send back
--
-- All five results. Section 3 decides how much migration is actually needed,
-- section 4 decides whether any of it is reachable, and section 5 decides
-- which claims may be made from a REST check afterwards.
--
-- If section 3 is empty, say so plainly rather than writing a migration to
-- close policies that are not there. That is the whole point of running this
-- first.
-- ───────────────────────────────────────────────────────────────────────────
