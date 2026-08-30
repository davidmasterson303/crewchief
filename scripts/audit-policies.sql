-- Well Kept — grants and RLS policy audit (task 0.2)
--
-- Run in the Supabase dashboard SQL Editor. Read-only: it only selects from
-- catalog views and changes nothing.
--
-- This complements scripts/audit-rls.mjs, which tests *behaviour* — what an
-- anonymous caller can actually reach. This one reads the *configuration*
-- behind that behaviour, which the REST API cannot expose.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The immediate question: why do two tables 401 for anonymous visitors?
--
-- The demo dashboard queries five tables directly from the browser.
-- vehicle_knowledge_base and recall_actions return 401, so the structured
-- dossier silently renders empty. Expect these two to have no `anon` grant.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'vehicles',
    'vehicle_health_summary',
    'nhtsa_data',
    'wishlist_items',
    'vehicle_knowledge_base',
    'recall_actions'
  )
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Policies on those same tables.
--
-- A grant alone is not enough — the row must also satisfy a policy. For the
-- demo these should be scoped to is_demo, never blanket USING (true).
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual        AS using_expression,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'vehicles',
    'vehicle_health_summary',
    'nhtsa_data',
    'wishlist_items',
    'vehicle_knowledge_base',
    'recall_actions'
  )
ORDER BY tablename, cmd, policyname;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The wider audit: every permissive policy in the schema.
--
-- A policy whose qualifier is literally `true` grants unconditional access to
-- whichever roles hold the table grant. wishlist_items is known to have four
-- of these, from a February 2026 migration commented "temporary fix for
-- development". Anything else appearing here deserves the same scrutiny.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename, cmd;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Tables with RLS disabled entirely.
--
-- Should return zero rows. A table here is readable by anyone holding the
-- table grant, regardless of policies.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Storage bucket visibility.
--
-- vehicle-documents is expected to still be public = true. That is task 0.3:
-- a public bucket serves objects through a path that never evaluates RLS, so
-- the correctly-scoped read policy added in June is effectively dead code
-- while this stays true.
-- ───────────────────────────────────────────────────────────────────────────
SELECT id, name, public, file_size_limit
FROM storage.buckets;
