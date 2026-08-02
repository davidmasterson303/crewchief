/*
  # Drop the duplicate SELECT policy on known_issue_tracking

  ## What is there

  Cowork read the live catalog as `postgres` on 1 Aug and found two SELECT
  policies on `known_issue_tracking`, not one:

      Users can view own issue tracking          ← not authored by any migration here
      Users can view own known issue tracking    ← 20260731040000, step 3

  Their `qual` expressions are byte-identical after whitespace normalisation.

  ## Why this is drift and not a hole

  Permissive policies OR together, so a predicate OR'd with an identical copy of
  itself grants exactly what one copy grants. Nothing is more reachable because
  of this. That is worth stating plainly, because the reflex on seeing "two
  policies where one was intended" is to assume exposure, and here there is
  none.

  What it does break is convergence. `20260731040000` sweeps unconditional
  policies by catalog introspection and then drops-and-recreates its own by
  name. The stray is neither unconditional nor named in that list, so re-running
  that migration leaves it standing. A file that claims to define the policy set
  on a table should end up defining it.

  ## Direction of travel

  Dropping a permissive policy can only ever reduce reachability, never widen
  it. If the two predicates were *not* in fact identical, the surviving policy
  is the one this repository deliberately authored, with both the ownership arm
  and the demo arm — which is the definition we want to converge on either way.
  So this is safe under both readings of the evidence.

  ## Why not amend 20260731040000 instead

  It has run. Editing an applied migration makes the file disagree with the
  database it already produced, which is the precise class of drift being
  cleaned up here. Forward-only.
*/

DROP POLICY IF EXISTS "Users can view own issue tracking" ON public.known_issue_tracking;

/*
  Deliberately not re-asserting the surviving policy. `20260731040000` owns its
  definition and re-authoring it here would create the second writer this
  migration exists to remove.

  ## Verify after applying

  Expect exactly one SELECT policy, carrying both arms:

      SELECT policyname, cmd, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'known_issue_tracking'
        AND cmd        = 'SELECT';

  One row: "Users can view own known issue tracking", with both auth.uid() and
  is_demo present in the predicate. DELETE and UPDATE policies on this table are
  scoped through `user_owns_vehicle(vehicle_id)` and are untouched.
*/
