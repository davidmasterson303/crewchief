/*
  # Claim a scan into an account, without re-uploading it

  Phase 2.97c. The conversion moment: a stranger got an answer, liked it, and
  made an account. Asking them to photograph the estimate a second time is the
  cheapest possible way to lose them at the exact instant they decided to stay.

  It is also what makes `saved` reachable. The step exists in the funnel
  vocabulary and **nothing can currently record it**, so the conversion rate the
  whole phase is justified on is structurally uncomputable until this lands.

  ## What is stored, and everything that is not

  The stored row is the *answer*, not the evidence:

    job_summary · vehicle · quoted_total · typical_low · typical_high

  **No image.** The upload is never persisted — it is read in memory, sent to
  Gemini, and dropped. A photographed estimate carries a shop's name, an
  address, sometimes a customer's, and it arrived from someone with no account
  who agreed to nothing.

  **No line items, no shop name, no free text beyond the job summary**, which is
  capped at 120 characters by `parseQuoteCheck` before it ever reaches here.

  That is enough to re-display the answer in the new account, which is the whole
  requirement. Storing the source document would buy a nicer future feature and
  is not what the visitor consented to by pressing "check this quote".

  ## Why it is keyed on visitor_id and not on a session

  There is no session — that is the premise. The join key is the same
  first-party id the funnel uses, which expires in 24 hours, so the claim window
  is naturally bounded by the cookie rather than by a rule anyone has to
  remember.

  A consequence worth stating: **someone who signs up on a different device, or
  after the cookie expires, cannot claim their scan.** That is correct rather
  than unfortunate. The alternative is a durable cross-device identifier for
  anonymous users, which is exactly the tracking posture the 24-hour ttl was
  chosen to avoid.

  ## Retention is not solved here

  Unclaimed rows are dead weight the moment their cookie expires. There is no
  scheduled job in this project, so `front_door_scans_created_idx` exists to
  make a later sweep cheap, and this is recorded as owed rather than pretended
  to be handled. **An unclaimed scan older than 30 days should be deleted.**

  ## Pure addition

  CREATE TABLE, one FK, two indexes, RLS, one policy. No DROP, no TRUNCATE — the
  dashboard's "Potential issue detected" modal will not fire.
*/

-- ─── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.front_door_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The same first-party id the funnel joins on. text, not uuid: the issuer is
  -- a browser and the format decision belongs with the issuing code.
  visitor_id text NOT NULL,

  -- The answer, and only the answer. See the header for what is deliberately
  -- absent and why.
  job_summary text NOT NULL,
  vehicle text,
  quoted_total numeric(10, 2),
  typical_low numeric(10, 2) NOT NULL,
  typical_high numeric(10, 2) NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  /*
    Set when the scan is claimed. CASCADE rather than SET NULL: an unclaimed
    scan is anonymous data with a 24-hour useful life, but a *claimed* one
    belongs to an account — and when that account is deleted it must go with it.
    `cc-product-0005` ships immediate-only deletion, and a row surviving it
    would be a quiet exception to a promise the product makes explicitly.
  */
  claimed_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at timestamptz,

  -- Either both or neither. A claimed_by with no timestamp makes the retention
  -- sweep unable to tell a fresh claim from an ancient one.
  CONSTRAINT front_door_scans_claim_is_whole
    CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
);

-- ─── 2. Bounds ────────────────────────────────────────────────────────────────
--
-- The application caps these first (`parseQuoteCheck`), and this is the second
-- lock, because the application is the half that can be redeployed with a bug.
-- Mirrors MAX_ECHOED_TEXT and the plausibility rails.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'front_door_scans_text_bounds'
  ) THEN
    ALTER TABLE public.front_door_scans
      ADD CONSTRAINT front_door_scans_text_bounds CHECK (
        char_length(visitor_id) BETWEEN 8 AND 128
        AND char_length(job_summary) BETWEEN 1 AND 120
        AND (vehicle IS NULL OR char_length(vehicle) <= 60)
      );
  END IF;
END $$;

-- ─── 3. Indexes ───────────────────────────────────────────────────────────────
--
-- The claim: "unclaimed scans for this visitor", run once at signup.
CREATE INDEX IF NOT EXISTS front_door_scans_visitor_idx
  ON public.front_door_scans (visitor_id)
  WHERE claimed_by IS NULL;

-- Reading an account's claimed scans, and the retention sweep that does not
-- exist yet. See the header.
CREATE INDEX IF NOT EXISTS front_door_scans_created_idx
  ON public.front_door_scans (created_at DESC);

CREATE INDEX IF NOT EXISTS front_door_scans_owner_idx
  ON public.front_door_scans (claimed_by, created_at DESC)
  WHERE claimed_by IS NOT NULL;

-- ─── 4. RLS ───────────────────────────────────────────────────────────────────
--
-- One policy, and it is narrower than it looks. An authenticated user may read
-- rows they have claimed — nothing else. There is deliberately no policy for
-- `anon`: an unclaimed scan is readable by anyone who guesses a visitor id,
-- and visitor ids travel in a cookie, so the row is served by the server
-- action that already holds the cookie rather than by PostgREST.
--
-- No INSERT or UPDATE policy for anyone. Both happen through the service role.
-- The absence of an UPDATE policy is what stops an account claiming a second
-- visitor's scan by editing the row directly.

ALTER TABLE public.front_door_scans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'front_door_scans'
      AND policyname = 'Users read the scans they claimed, and only those'
  ) THEN
    CREATE POLICY "Users read the scans they claimed, and only those"
      ON public.front_door_scans
      FOR SELECT
      TO authenticated
      USING (claimed_by = auth.uid());
  END IF;
END $$;

-- ─── 5. Grants ────────────────────────────────────────────────────────────────

REVOKE ALL ON public.front_door_scans FROM anon;
REVOKE ALL ON public.front_door_scans FROM authenticated;
GRANT SELECT ON public.front_door_scans TO authenticated;

COMMENT ON TABLE public.front_door_scans IS
  'Answers produced by the anonymous front door, held so a visitor who signs up does not have to re-upload. Stores the answer, never the image or the line items. Unclaimed rows should be swept after 30 days — no scheduled job exists yet.';

COMMENT ON COLUMN public.front_door_scans.visitor_id IS
  'The same first-party id the funnel joins on, which expires in 24 hours. That bounds the claim window deliberately: a durable cross-device id for anonymous users is the tracking posture this project chose not to have.';
