/*
  # Restore demo dossier reads — scoped, not blanket

  ## The problem

  The public demo dashboard queries five tables directly from the browser with
  the anon key. Two of them return 401, so the structured dossier — known
  issues, maintenance schedule, fluid specs, common mods, and which recall
  campaigns have been addressed — renders empty for every visitor:

    vehicle_knowledge_base
    recall_actions

  The June 2026 hardening pass revoked anon SELECT from every table, then
  restored only four (vehicles, nhtsa_data, vehicle_health_summary,
  wishlist_items). These two were missed.

  Nothing errored, because the client queries use maybeSingle(): a 401
  resolves to null and the page renders with a hole. The narrative content a
  visitor sees first comes from vehicle_health_summary and was unaffected,
  which is why this went unnoticed on a live portfolio piece.

  ## Why this is not simply a GRANT

  vehicle_knowledge_base still carries this, from the original schema:

    CREATE POLICY "Allow all operations on vehicle_knowledge_base"
      ON vehicle_knowledge_base FOR ALL USING (true) WITH CHECK (true);

  It has no TO clause, so it applies to every role. Granting anon SELECT
  against that policy would expose *every user's* knowledge base to the
  public internet — trading a cosmetic demo gap for a real data leak.

  So the policy is replaced first, then the grant is narrow:

    anon           SELECT, demo vehicles only
    authenticated  full access to their own vehicles' rows

  recall_actions already has an ownership-scoped policy for authenticated and
  needs only the anon demo read added.

  ## Scope

  Deliberately limited to the two tables blocking the demo. Migration history
  shows similar permissive policies on other tables; those are being audited
  separately rather than swept up here, because a broad policy rewrite should
  follow evidence from pg_policies, not inference from migration files.
*/

-- ============================================================
-- vehicle_knowledge_base
-- ============================================================

-- Unconditional access for all roles. Replaced below.
DROP POLICY IF EXISTS "Allow all operations on vehicle_knowledge_base"
  ON vehicle_knowledge_base;

ALTER TABLE vehicle_knowledge_base ENABLE ROW LEVEL SECURITY;

/*
  Demo rows are public by design — the three seeded vehicles are the product
  demo. The subquery is used rather than user_owns_vehicle() because that
  function is SECURITY INVOKER with EXECUTE revoked from anon, so anon cannot
  call it.
*/
CREATE POLICY "Anon reads demo knowledge base"
  ON vehicle_knowledge_base
  FOR SELECT
  TO anon
  USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE is_demo)
  );

CREATE POLICY "Users read own knowledge base"
  ON vehicle_knowledge_base
  FOR SELECT
  TO authenticated
  USING (
    user_owns_vehicle(vehicle_id)
    OR vehicle_id IN (SELECT id FROM vehicles WHERE is_demo)
  );

-- Writes are owner-only, and never anon: the demo vehicles are shared, so an
-- anonymous write would alter what the next visitor sees.
CREATE POLICY "Users write own knowledge base"
  ON vehicle_knowledge_base
  FOR ALL
  TO authenticated
  USING (user_owns_vehicle(vehicle_id))
  WITH CHECK (user_owns_vehicle(vehicle_id));

GRANT SELECT ON public.vehicle_knowledge_base TO anon;
REVOKE INSERT, UPDATE, DELETE ON public.vehicle_knowledge_base FROM anon;

-- ============================================================
-- recall_actions
-- ============================================================

-- Additive: the existing "Users can view own recall actions" policy for
-- authenticated is correct and stays.
DROP POLICY IF EXISTS "Anon reads demo recall actions" ON recall_actions;

CREATE POLICY "Anon reads demo recall actions"
  ON recall_actions
  FOR SELECT
  TO anon
  USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE is_demo)
  );

GRANT SELECT ON public.recall_actions TO anon;
REVOKE INSERT, UPDATE, DELETE ON public.recall_actions FROM anon;

/*
  ## Verifying this worked

  From the repo:  node scripts/verify-demo.mjs

  Both tables should move from "known gap" to readable. Then remove them from
  ANON_READ_TABLES.knownGaps in lib/demo-contract.ts and add them to
  `required`, so the demo-availability test starts guarding them.

  The check that matters most: anon must see demo rows ONLY. If a non-demo
  vehicle's knowledge base becomes visible, this migration is wrong.
*/
