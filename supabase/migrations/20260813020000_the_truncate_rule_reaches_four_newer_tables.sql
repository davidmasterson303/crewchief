/*
  # Take TRUNCATE off authenticated for the four tables created since 1 August

  **Additive in effect and purely restrictive — it only removes a privilege.**
  No table changes, no policy changes, no row is touched.

  ⚠ **The "Potential issue detected" modal WILL fire**, because `REVOKE` trips
  the dashboard's heuristic. That is expected here. See the note at the bottom
  on why the last three migrations predicted otherwise and were wrong.

  ## What this closes

  `20260801150000` took TRUNCATE off `authenticated` and wrote down why:

  > `authenticated` holds TRUNCATE on the public tables. **RLS cannot gate
  > TRUNCATE** — it is a table-level operation, so no policy, however scoped,
  > restricts it. A role holding it can empty a table outright.

  It did that with `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public`, which binds
  **only the tables that existed at that moment.** Postgres has no standing rule
  here; `ALL TABLES` is a shorthand expanded once, not a policy.

  That same migration anticipated exactly this and said what to do:

  > if a later table needs it, the honest fix is a line in that table's own
  > migration

  Four tables have been created since and **none carries that line**:

  | Table | Created by |
  |---|---|
  | `device_push_tokens` | `20260806120000` |
  | `recall_notifications` | `20260807120000` |
  | `service_notifications` | `20260808180000` |
  | `account_entitlements` | `20260812120000` |

  So each inherited Supabase's default grant and `authenticated` can TRUNCATE
  all four. Found by Cowork on 12 August while verifying the entitlements
  migration — not by any test here, and not by the migration that predicted it.

  ## Why this is defence in depth rather than an incident

  **Not reachable today.** PostgREST exposes no TRUNCATE verb, so nothing an API
  caller can send invokes it — the same reasoning `20260801150000` used, and it
  still holds. Every legitimate destructive path in this product already runs as
  the service role.

  It is worth closing anyway, and `account_entitlements` is why. A role that can
  empty that table cannot grant itself the paid tier — the read resolves a
  missing row to `free` — but it *can* strip every paying account of what it
  bought, in one statement, with no row-level check able to intervene. The
  blast radius of the others is smaller and the argument is the same.

  ## The rule this leaves behind

  **A new table in `public` does not inherit the 1 August revoke.** Any migration
  creating one must carry its own `REVOKE TRUNCATE ... FROM authenticated`, and
  `truncate-revoked.test.ts` now fails the build if it does not — because this is
  the second time the rule has been written down in prose and the first time it
  has been enforced.
*/

REVOKE TRUNCATE ON public.device_push_tokens FROM authenticated;
REVOKE TRUNCATE ON public.recall_notifications FROM authenticated;
REVOKE TRUNCATE ON public.service_notifications FROM authenticated;
REVOKE TRUNCATE ON public.account_entitlements FROM authenticated;

/*
  ## Verification

  Should return zero rows:

      SELECT table_name, grantee, privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND grantee = 'authenticated'
         AND privilege_type = 'TRUNCATE';

  ## ⚠ A correction to three earlier migration headers

  `20260806120000` says "No DROP, no TRUNCATE — the dashboard's 'Potential issue
  detected' modal will not fire", and `20260812120000` says the same in different
  words. **Observed on 12 August: the modal fires for `DROP POLICY IF EXISTS`
  and for `REVOKE`**, neither of which destroys data.

  The heuristic reads statement *shapes*, not consequences. So "this migration is
  additive" and "the modal will stay quiet" are different claims, and only the
  first is ours to make.

  ## ⚠ And a correction to the correction — 15 August

  **This header's own prediction was also wrong.** It says twice that the modal
  *will* fire here. Cowork applied these four statements in the SQL editor on
  15 August and **it did not fire** — four REVOKEs, executed straight through.

  So the score is four predictions and four misses: three headers said the modal
  would stay quiet and it fired, this one said it would fire and it did not. The
  12 August observation does not generalise the way it was written — whatever
  trips the heuristic, `REVOKE TRUNCATE ON public.<table>` is not it, and
  `DROP POLICY IF EXISTS` may have been doing the work all along.

  **The rule that survives: do not predict the modal at all.** It is a vendor
  heuristic this repo has no model of, it changes without notice, and every
  attempt to describe it has cost a later author a wrong expectation. State what
  the migration *does* — additive, restrictive, destructive — which is knowable,
  and leave the dashboard's behaviour to the person watching it.
*/
