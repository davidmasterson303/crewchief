/*
  # Drop the duplicate conversations policy, and take TRUNCATE off authenticated

  Two unrelated one-liners in one file, deliberately. Every migration here is
  applied by hand through a dashboard that interrupts on DROP, so a trip has a
  real cost and batching two trivial changes is worth more than the tidiness of
  separating them. They are sectioned below and neither depends on the other.

  ── 1. The duplicate on consultant_conversations ─────────────────────────────

  Predicted before 20260801140000 was applied, and it happened. That migration
  drops "Users can view own consultant conversations" by name and recreates it.
  The policy live was named **"Users can view own conversations"**, so the drop
  matched nothing and both now exist.

  Identical shape to the `known_issue_tracking` pair that 20260801130000
  cleaned up, and identical reasoning: not a hole, because permissive policies
  OR together and both arms carry owner-or-demo. It is a convergence failure —
  re-running 140000 leaves the stray standing, so the file does not define the
  policy set it appears to define.

  Dropping a permissive policy can only reduce reachability, never widen it, and
  the survivor is the one this repository authors. Safe under either reading of
  whether the predicates match exactly.

  **This is the third stray policy found under a name no migration here uses.**
  The lesson is now well paid for: authoring by name converges only if the name
  is right, and in this database it repeatedly is not. A future policy migration
  should sweep by introspection — as 140000's step 2 does — rather than trust a
  DROP ... IF EXISTS list.

  ── 2. TRUNCATE ──────────────────────────────────────────────────────────────

  `authenticated` holds TRUNCATE on the public tables. **RLS cannot gate
  TRUNCATE** — it is a table-level operation, so no policy, however scoped,
  restricts it. A role holding it can empty a table outright.

  Not currently reachable: PostgREST exposes no TRUNCATE verb, so nothing an
  API caller can send invokes it. This is defence in depth against a future
  surface that speaks SQL more directly, and it costs nothing today because
  every legitimate destructive path already runs as the service role.
*/

-- ─── 1. Converge the conversations policy ─────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own conversations" ON public.consultant_conversations;

/*
  Deliberately not re-asserting the survivor. 20260801140000 owns its
  definition, and re-authoring it here would create the second writer this
  migration exists to remove — the same reasoning as 20260801130000.
*/

-- ─── 2. Remove TRUNCATE from authenticated ────────────────────────────────────

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

/*
  Scoped to tables that exist now, on purpose.

  `ALTER DEFAULT PRIVILEGES` would cover future ones, but it applies only to
  objects created by the role that runs it, and migrations here have been
  applied by more than one identity — dashboard sessions as `postgres`, and
  Bolt-era tooling before that. A default-privileges rule attached to whichever
  role happens to run this would silently fail to cover tables created by the
  other, which is a guarantee that reads stronger than it is.

  If a later table needs it, the honest fix is a line in that table's own
  migration.
*/

/*
  ## Verify after applying

  1. Exactly one SELECT policy on the table, the one 140000 authors:

       SELECT policyname, cmd
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = 'consultant_conversations'
         AND cmd        = 'SELECT';

     Expect one row: "Users can view own consultant conversations".

  2. The demo still reads its seeded transcripts — this is the check that
     matters, because step 1 removed a policy the demo may have been relying on:

       GET /rest/v1/consultant_conversations?select=id,title  (publishable key)
         → 200, exactly the three seeded demo conversations, and none of
           David's real ones.

     If this returns `[]`, the surviving policy's demo arm is not doing what
     140000 believes it does, and that is worth knowing immediately.

  3. TRUNCATE is gone from authenticated:

       SELECT count(*) AS truncate_grants
       FROM information_schema.role_table_grants
       WHERE grantee = 'authenticated'
         AND table_schema = 'public'
         AND privilege_type = 'TRUNCATE';

     Expect 0.
*/
