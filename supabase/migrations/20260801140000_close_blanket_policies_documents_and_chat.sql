/*
  # Close the blanket policies on vehicle_documents and consultant_conversations

  The last two tables from the Phase 2.9 list. They were held back from
  20260731040000 with a note that they "need policies written deliberately, not
  this pattern applied a fourth and fifth time" — and the deliberate answer
  turns out to be different for each, which is why they are here together and
  not as a copy of that file.

  ## CORRECTION, 1 Aug — the premise below was wrong, the changes were not

  This header originally said both tables carry `FOR ALL USING (true)` from
  20260101215332, and that any signed-in user could therefore read every other
  user's invoices and chat transcripts. **That was false, and it was false
  before this migration ran.**

  Cowork checked the live catalog before applying, three ways: zero
  unconditional policies on either table, RLS enabled on both, and every policy
  already scoped with owner and demo arms. `vehicle_documents` already had
  "Users can view own vehicle documents"; `consultant_conversations` already had
  "Users can view own conversations". The `FOR ALL USING (true)` is in this
  repository's migration history. It is not in the database and had not been.

  The claim came from reading migration files and the static replay in
  `rls-blanket-policies.test.ts` — whose own header says it proves what a
  *rebuild* would produce, not what live is running. That warning was read and
  then contradicted in the same change.

  **The fourth catalog-versus-repo disagreement, and the first running the other
  way: live was tighter than the repo.** Drift is not conservatively safe in
  either direction. A file read overstated a security finding here exactly as
  readily as file reads have understated others.

  The empirical audits were not wrong either. "anon blocked" was true and
  irrelevant: `anon` has no grant, `authenticated` does, so an anonymous probe
  could never have measured this.

  ## What this migration actually did, both wanted

  1. `vehicle_documents` lost its demo arm and is now owner-only. A genuine
     tightening — just not the one originally described.
  2. `consultant_conversations` gained the anon grant, so the demo's sidebar
     renders the seeded transcripts instead of "No conversations yet".

  ## Why the two tables get different policies

  **consultant_conversations — ownership arm AND demo arm, plus an anon grant.**

  The seed migration writes one conversation per demo vehicle: "CVT Fluid & Oil
  Dilution Questions", "Stage 2 Build Planning", "Water Pump & High Mileage
  Planning". They are showcase content — full transcripts written to be read by
  someone evaluating the product — and the demo's Conversations sidebar
  currently renders "No conversations yet", because the client reads this table
  with the publishable key and gets 42501. Verified in the browser against the
  demo Accord on 1 Aug.

  So the demo arm here is not the pattern being repeated out of habit. There are
  real rows it is meant to expose, and exposing them fixes a visible defect on
  the recruiter-facing surface.

  **vehicle_documents — ownership arm ONLY. No demo arm, and no anon grant.**

  The opposite conclusion, from the same question: what does the demo actually
  need? Nothing. The only client-side read of this table fed a `documents` prop
  that `ConsultantChat` destructured and never rendered — removed in the commit
  that carries this migration. With that gone, no demo surface reads the table
  at all.

  The five demo rows are placeholders (`demo-placeholder.local/...`) that point
  at no file, so exposing them would show a visitor nothing. Every other row is
  a real invoice, and `file_url` is a path into a private bucket. Granting anon
  read here would widen the surface to buy a feature nobody asked for.

  Recording the reasoning because "the last one got a demo arm" is exactly how
  the fourth application of a pattern happens.

  ## What this does not touch

  Writes. Every INSERT/UPDATE/DELETE on both tables goes through
  `getServiceRoleClient()` — including `uploadInvoice`, whose `access.client` is
  the service role once ownership is proven (lib/api-auth.ts:233). The service
  role bypasses RLS, so sweeping the `FOR ALL` policies removes no write path.
  Checked at every call site rather than assumed, because a blanket policy that
  something quietly depends on is how this kind of migration breaks production.

  Storage. `vehicle-documents` is a private bucket and its access is decided by
  signed URLs and by `downloadStoredFile`'s ownership check, not by this policy.
  A row being readable is not the file being readable.
*/

-- ─── 1. Named drops, for the static reader ────────────────────────────────────
--
-- Redundant with the sweep in step 2, and present so the migration history
-- reads as though these policies were closed by name.

DROP POLICY IF EXISTS "Allow all operations on vehicle_documents"          ON public.vehicle_documents;
DROP POLICY IF EXISTS "Allow all operations on consultant_conversations"   ON public.consultant_conversations;

-- ─── 2. Sweep every unconditional policy off both tables ──────────────────────
--
-- Introspection rather than names. 20260731040000 found policies live that
-- appear in no migration in this repository — a duplicate SELECT policy on
-- known_issue_tracking, and scoped user_owns_vehicle() policies on DELETE and
-- UPDATE. A name-driven sweep would have missed them and reported success.

DO $$
DECLARE
  tbl      text;
  blanket  record;
  dropped  int := 0;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['vehicle_documents', 'consultant_conversations']
  LOOP
    FOR blanket IN
      SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = tbl
        AND permissive = 'PERMISSIVE'
        AND (roles && ARRAY['public', 'anon', 'authenticated']::name[])
        AND (
          btrim(coalesce(qual::text,         '')) = 'true'
          OR btrim(coalesce(with_check::text, '')) = 'true'
        )
    LOOP
      RAISE NOTICE 'dropping blanket policy %.% (cmd=%, roles=%, qual=%, with_check=%)',
        tbl, blanket.policyname, blanket.cmd, blanket.roles, blanket.qual, blanket.with_check;
      EXECUTE format('DROP POLICY %I ON public.%I', blanket.policyname, tbl);
      dropped := dropped + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'blanket policies dropped across both tables: %', dropped;
END $$;

-- ─── 3. Author the scoped SELECT policies ─────────────────────────────────────

/*
  Owner only. No `OR vehicles.is_demo = true` — that omission is the point of
  this policy, not an oversight. See the header.
*/
DROP POLICY IF EXISTS "Users can view own vehicle documents" ON public.vehicle_documents;
CREATE POLICY "Users can view own vehicle documents"
  ON public.vehicle_documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles
      WHERE vehicles.id = vehicle_documents.vehicle_id
        AND vehicles.user_id = auth.uid()
    )
  );

/*
  Ownership arm first, demo arm second — the demo arm carries the three seeded
  showcase conversations and nothing else.
*/
DROP POLICY IF EXISTS "Users can view own consultant conversations" ON public.consultant_conversations;
CREATE POLICY "Users can view own consultant conversations"
  ON public.consultant_conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles
      WHERE vehicles.id = consultant_conversations.vehicle_id
        AND (vehicles.user_id = auth.uid() OR vehicles.is_demo = true)
    )
  );

-- ─── 4. Refuse to grant if anything unconditional survived ────────────────────
--
-- The grant below is only safe because the scoped policy is the *only* SELECT
-- policy. If a blanket one outlived the sweep, granting anon would be the data
-- leak 20260731030000's header warns about. Fail the migration instead.

DO $$
DECLARE
  survivors int;
BEGIN
  SELECT count(*) INTO survivors
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('vehicle_documents', 'consultant_conversations')
    AND permissive = 'PERMISSIVE'
    AND (roles && ARRAY['public', 'anon', 'authenticated']::name[])
    AND (
      btrim(coalesce(qual::text,         '')) = 'true'
      OR btrim(coalesce(with_check::text, '')) = 'true'
    );

  IF survivors > 0 THEN
    RAISE EXCEPTION
      'refusing to grant: % unconditional policy/policies survived the sweep', survivors;
  END IF;
END $$;

-- ─── 5. The grant, on one table only ──────────────────────────────────────────
--
-- consultant_conversations only. vehicle_documents is deliberately left with no
-- anon grant, so an anonymous caller keeps getting 42501 on it — which is the
-- correct answer for a table of private invoices that no demo surface reads.

GRANT SELECT ON public.consultant_conversations TO anon;

/*
  ## Verify after applying

  1. No unconditional policy survives on either table:

       SELECT tablename, policyname, cmd, qual
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('vehicle_documents', 'consultant_conversations')
         AND (btrim(coalesce(qual::text,'')) = 'true'
              OR btrim(coalesce(with_check::text,'')) = 'true');

     Expect zero rows.

  2. From outside, with the publishable key — the two tables must disagree:

       GET /rest/v1/consultant_conversations?select=id,title
         → 200, exactly the three seeded demo conversations, no others.
       GET /rest/v1/vehicle_documents?select=id
         → 401 / 42501. Still blocked, deliberately.

     The first check has teeth only if a non-demo conversation exists to be
     wrongly returned. One does — a real conversation on David's vehicle — so
     unlike the anon read on the advisor tables, this one is not vacuous.

  3. The demo's Conversations sidebar shows "CVT Fluid & Oil Dilution Questions"
     on the Accord instead of "No conversations yet".
*/
