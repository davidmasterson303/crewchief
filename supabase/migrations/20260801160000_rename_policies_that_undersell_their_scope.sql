/*
  # Rename two policies whose names hide the fact that they are scoped

  ## The names

  Measured live on 1 Aug:

      nhtsa_data             "Users can view nhtsa data"
      vehicle_knowledge_base "Users can view vehicle knowledge"

  Both are correctly scoped — `EXISTS (… WHERE user_id = auth.uid() OR
  is_demo)`, verified by anonymous REST reads that returned the three demo rows
  and withheld the one real row. Their sibling on `vehicle_health_summary` is
  scoped identically and is named "Users can view own vehicle health".

  The two above omit "own". That single word is the difference between a name
  that states a scope and one that reads like `FOR ALL USING (true)` wearing a
  friendly label.

  ## Why a name is worth a migration

  Because names being wrong has now cost three migrations in two days.

  `20260731040000` dropped "Users can view own consultant conversations" by
  name; live was "Users can view own conversations", so the drop matched
  nothing and left a duplicate — fixed by `20260801150000`. `20260801130000`
  cleaned up the same shape on `known_issue_tracking`. And the reason
  `ed97038` asserted a live security hole that did not exist is that the repo's
  description of these tables was read instead of the catalog.

  A policy whose name understates its predicate is the same failure in advance:
  the next person auditing this database reads "Users can view nhtsa data",
  concludes it is unscoped, and writes a migration to close something that is
  already closed. That is not hypothetical — it is exactly what happened here,
  and this file exists so it does not happen again on these two.

  ## What this does and does not change

  Renames only. `ALTER POLICY … RENAME TO` leaves the predicate, the command,
  the roles and the permissive/restrictive flag untouched — so there is no
  access change, in either direction, and nothing to verify beyond the names.

  Guarded so a rename cannot silently become a no-op: if a policy is missing
  under its old name, that means live has drifted again and the assumption
  behind this file is wrong, which is worth a raised exception rather than a
  quiet success.
*/

DO $$
DECLARE
  renames CONSTANT text[][] := ARRAY[
    ARRAY['nhtsa_data',             'Users can view nhtsa data',       'Users can view own nhtsa data'],
    ARRAY['vehicle_knowledge_base', 'Users can view vehicle knowledge', 'Users can view own vehicle knowledge']
  ];
  r         text[];
  has_old   boolean;
  has_new   boolean;
BEGIN
  FOREACH r SLICE 1 IN ARRAY renames
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = r[1] AND policyname = r[2]
    ) INTO has_old;

    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = r[1] AND policyname = r[3]
    ) INTO has_new;

    IF has_new THEN
      -- Already renamed. Re-running this migration converges rather than fails.
      RAISE NOTICE 'skip %.%: already named %', r[1], r[2], r[3];
      CONTINUE;
    END IF;

    IF NOT has_old THEN
      /*
        Neither name present. The policy this file was written against is gone
        under some third name, which is the drift this whole exercise is about
        — fail loudly rather than report success for work not done.
      */
      RAISE EXCEPTION
        'expected policy "%" on public.% and found neither it nor "%"; live has drifted, re-run scripts/audit-remaining-blanket-tables.sql',
        r[2], r[1], r[3];
    END IF;

    EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I', r[2], r[1], r[3]);
    RAISE NOTICE 'renamed %.% -> %', r[1], r[2], r[3];
  END LOOP;
END $$;

/*
  ## Verify after applying

  Three SELECT policies, all named consistently, all still carrying both arms:

      SELECT tablename, policyname, qual::text
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('nhtsa_data', 'vehicle_health_summary',
                          'vehicle_knowledge_base')
        AND cmd = 'SELECT'
      ORDER BY tablename;

  Expect "Users can view own nhtsa data", "Users can view own vehicle health",
  "Users can view own vehicle knowledge", each with `auth.uid()` and `is_demo`
  in the predicate.

  Then confirm nothing moved, which is the actual claim this migration makes.
  An anonymous read of each must still return exactly the three demo vehicles
  and withhold the real one — the non-vacuous check, and the reason these three
  tables are the ones worth re-running it on:

      GET /rest/v1/nhtsa_data?select=vehicle_id             (publishable key)
      GET /rest/v1/vehicle_health_summary?select=vehicle_id
      GET /rest/v1/vehicle_knowledge_base?select=vehicle_id

  Three rows each, all demo vehicle ids. Four rows, or a non-demo id, means a
  rename changed something it had no business changing.
*/
