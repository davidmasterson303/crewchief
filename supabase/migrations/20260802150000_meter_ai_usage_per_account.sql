/*
  # Meter every Gemini call, per account

  ## Why this is not observability

  Under Path B this table would have been nice to have. Under Path A it is
  load-bearing, and three separate things wait on it:

    - **Tier limits (5.1)** cannot enforce a monthly budget without a per-account
      number to enforce against. The only control today is 10 AI calls per minute
      per vehicle, which is a ceiling of 432,000 calls a month. There is no
      monthly cap of any kind.
    - **Decision D2 (price point)** is currently built on *estimated* tokens.
      `CREWCHIEF_COMMERCIAL_EVAL_2026-08-01.md` says so itself, and the roadmap
      says not to set D2 until this has two weeks of real data behind it.
    - **2.95d (windowing the consultant context)** is sized at 1.25 ed against a
      guess about how fast per-user cost grows with tenure. This measures it.

  ## What a row is

  One Gemini call. Not one user action — `sendConsultantMessage` is one call,
  but `parseInvoiceLineItems` on a three-page upload is three, and the bill
  follows the calls.

  ## Thinking tokens get their own column, and that is the point

  Measured 2 Aug 2026 against the live key: `gemini-3.6-flash` with no thinking
  level spent **861 thinking tokens to return 168 tokens of answer**. Thinking
  bills at the output rate, so on that call the *invisible* five-sixths was the
  bill. Folding it into `output_tokens` would hide the single largest cost lever
  in the application inside a number nobody would think to decompose.

  `cached_tokens` is recorded for the opposite reason: it is billed at a
  discount, so a total that ignores it overstates the cost.

  ## `purpose` is constrained, for the reason 20260801120000 gives

  A free-text column drifts — 'consultant', 'Consultant', 'chat', 'advisor' —
  and then the per-feature cost breakdown this exists to produce quietly stops
  matching. The CHECK is the point. Adding a value is a migration, which is the
  correct amount of friction for a vocabulary that reports are built on.

  ## Nullable `user_id`, on purpose

  The public demo is anonymous and it calls Gemini. That traffic is a real bill
  — it is the recruiter-facing surface, so it is *wanted* traffic — and it has
  never been measured. A NOT NULL here would have meant either dropping those
  rows or inventing a sentinel account. They are recorded with `user_id IS NULL`
  and are visible only to the service role, which is correct: they belong to
  nobody.

  ## Authorization

  `cc-tech-0010` — the database is the authorization boundary. Note that entry
  is `confidence: medium` and `provenance: inferred`, and its own open question
  says it was written from migration filenames rather than from reading the
  policies, so nothing here leans on it: the policy below is written out
  explicitly and scoped to the owner.

  Reads: a user may read their own rows and nothing else. There is deliberately
  **no INSERT, UPDATE or DELETE policy for `authenticated`**, so with RLS on and
  no permissive policy, those are denied. Writes go through the service role in
  `lib/ai-usage.ts`, which bypasses RLS — the same shape `api_rate_limits`
  already uses. A user who could write here could under-report their own usage,
  which is the whole attack against a metered tier.

  No `USING (true)` anywhere, so `rls-blanket-policies.test.ts` stays green.

  ## Pure additions — no DROP

  Nothing here is a DROP-class statement, so the SQL Editor's "Potential issue
  detected" modal will not fire and this will not stall mid-run.
*/

-- ─── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL means anonymous demo traffic. See the note above.
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  -- SET NULL rather than CASCADE: deleting a car should not erase the record of
  -- what it cost to run. Deleting the *account* still does, via user_id.
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,

  -- The pinned identifier, not the tier name. Which model served a call is the
  -- thing that changes under you, and a cost history that cannot say which
  -- model produced it cannot explain its own step changes.
  model text NOT NULL,

  purpose text NOT NULL,

  prompt_tokens   integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  thoughts_tokens integer NOT NULL DEFAULT 0,
  cached_tokens   integer NOT NULL DEFAULT 0,
  total_tokens    integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. The purpose vocabulary ────────────────────────────────────────────────
--
-- One value per Gemini call site as of 2 Aug 2026. Kept in step by
-- `ai-usage.test.ts`, which fails the build if the application knows a
-- purpose this constraint does not.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_purpose_check'
  ) THEN
    ALTER TABLE public.ai_usage_events
      ADD CONSTRAINT ai_usage_events_purpose_check CHECK (purpose IN (
        'consultant',
        'invoice_extraction',
        'vehicle_dossier',
        'vehicle_health_summary',
        'powertrain_options',
        'modification_details',
        'modification_backfill',
        'performance_stats',
        'health_check'
      ));
  END IF;
END $$;

-- ─── 3. Indexes ───────────────────────────────────────────────────────────────
--
-- The two queries this table exists to answer: "what has this account spent
-- this month" (5.1, on every metered call, so it has to be cheap) and "what did
-- each feature cost" (D2, monthly and offline).

CREATE INDEX IF NOT EXISTS ai_usage_events_user_created_idx
  ON public.ai_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx
  ON public.ai_usage_events (created_at DESC);

-- ─── 4. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_usage_events'
      AND policyname = 'Users read their own AI usage, and only their own'
  ) THEN
    CREATE POLICY "Users read their own AI usage, and only their own"
      ON public.ai_usage_events
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ─── 5. Grants ────────────────────────────────────────────────────────────────
--
-- `anon` gets nothing: the demo writes rows here but has no business reading
-- them, and there is no anonymous surface that needs a token count.
--
-- `authenticated` gets SELECT only. The absence of INSERT is what stops an
-- account editing its own meter; the RLS policy above is the second lock, not
-- the only one.

REVOKE ALL ON public.ai_usage_events FROM anon;
REVOKE ALL ON public.ai_usage_events FROM authenticated;
GRANT SELECT ON public.ai_usage_events TO authenticated;

COMMENT ON TABLE public.ai_usage_events IS
  'One row per Gemini call. Substrate for tier limits (5.1) and the price-point decision (D2). Written only by the service role; users may read their own rows.';

COMMENT ON COLUMN public.ai_usage_events.thoughts_tokens IS
  'Billed at the output rate. Separate from output_tokens because it is invisible to the user and was 5x the visible answer before 2.95a set a thinking level.';
