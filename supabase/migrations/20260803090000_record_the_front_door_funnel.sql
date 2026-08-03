/*
  # Record the front door's funnel, before the front door exists

  ## Why this lands ahead of the surface it measures

  Phase 2.97 is blocked on two decisions (D8, the anonymous abuse posture, and
  D9, what the door actually does). This is neither — it is the third blocker,
  which the roadmap re-sized on 2 Aug from "0.5 ed" to 0.75 ed once it turned
  out the substrate it assumed does not exist. Work rather than a question, so
  it does not have to wait for D8 and D9 and should not.

  Neither pending decision changes these four steps. Whether the door checks a
  quote or scans an invoice, a visitor lands, gives it something, gets an
  answer, and either keeps it or leaves.

  ## Advisory P1: this is a ship gate

  Scored 7.6 and adopted. The door does not open without funnel instrumentation
  behind it, because the phase is justified on producing evidence and this is
  the only part of it that produces any.

  ## No vendor

  Deliberate. A third-party tracker on an anonymous endpoint pulls in a consent
  banner — a conversion tax on the exact surface being measured, and a new item
  in 5.0's legal scope. This is the `ai_usage_events` shape for the third time;
  it is well understood here and it costs a table.

  ## UNIQUE (visitor_id, step) is the design, not a constraint bolted on

  The roadmap flagged `landed` as the awkward event: it is a render, so
  prefetches, reloads and a back-button all fire it. Deduping at four call sites
  is four chances to get it wrong. Deduping here makes the table answer "did
  this visitor ever reach this step", which is what a funnel is, and makes every
  writer idempotent for free — so the fire-and-forget writer can retry, or not,
  without anyone reasoning about it.

  ## What is deliberately NOT in this table

  - **No `user_id`.** Linking anonymous browsing to the account it became is a
    materially different privacy proposition from counting steps, and 2.97c's
    conversion is already measured by `saved`. Not needed, so not collected.
  - **No free-text or `jsonb` detail column.** It would be the obvious place for
    a shop name or a photographed invoice's contents to end up, on the one
    surface where the visitor never agreed to anything.
  - **No IP, no user agent.** Same reason, and `cc-tech-0003` is explicit that
    request-derived values the caller influences are not to be trusted anyway.

  ## Pure additions — no DROP

  CREATE TABLE, one CHECK, one UNIQUE, two indexes, RLS. Nothing DROP-class, so
  the dashboard SQL Editor's "Potential issue detected" modal will not fire and
  stall this mid-run.
*/

-- ─── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A first-party id issued on landing. NOT NULL and no default: four events
  -- that cannot be joined per visitor are four counters, and the whole added
  -- cost of 2.97d over "0.25 ed of table and writer" is this column meaning
  -- something. A row without one is not a degraded funnel event, it is a
  -- different kind of record, and the writer drops it rather than writing it.
  --
  -- text, not uuid: the issuer is a browser, and constraining the shape here
  -- would force a format decision that belongs with the issuing code.
  visitor_id text NOT NULL,

  step text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- See the header. Makes the table answer "did this visitor ever reach this
  -- step" rather than "how many times did something fire", and makes every
  -- write idempotent.
  CONSTRAINT funnel_events_visitor_step_key UNIQUE (visitor_id, step)
);

-- ─── 2. The step vocabulary ───────────────────────────────────────────────────
--
-- Constrained for the reason `purpose` and `surface` are: free text drifts
-- ('saved', 'save', 'clicked_save') and then the funnel silently stops being
-- comparable week to week. Held in step with the application by
-- `funnel-steps.test.ts`.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funnel_events_step_check'
  ) THEN
    ALTER TABLE public.funnel_events
      ADD CONSTRAINT funnel_events_step_check CHECK (step IN (
        'landed',
        'uploaded',
        'answered',
        'saved'
      ));
  END IF;
END $$;

-- ─── 3. Bound the visitor id ──────────────────────────────────────────────────
--
-- An anonymous, unauthenticated caller supplies this value. Without a bound it
-- is an unbounded text column on a public write path. Mirrors
-- `isRecordableVisitorId` in `packages/core/src/funnel.ts`; the application
-- refuses first and this refuses second, because the application is the half
-- that can be redeployed with a bug.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'funnel_events_visitor_id_length_check'
  ) THEN
    ALTER TABLE public.funnel_events
      ADD CONSTRAINT funnel_events_visitor_id_length_check
        CHECK (char_length(visitor_id) BETWEEN 8 AND 128);
  END IF;
END $$;

-- ─── 4. Indexes ───────────────────────────────────────────────────────────────
--
-- Two queries, and only two. "Rebuild the funnel over a window" groups by
-- visitor within a date range; "how many reached step X this week" filters on
-- step and orders on time. The UNIQUE constraint above already provides a
-- (visitor_id, step) index, so the per-visitor lookup is covered and is not
-- repeated here.

CREATE INDEX IF NOT EXISTS funnel_events_created_idx
  ON public.funnel_events (created_at DESC);

CREATE INDEX IF NOT EXISTS funnel_events_step_created_idx
  ON public.funnel_events (step, created_at DESC);

-- ─── 5. RLS ───────────────────────────────────────────────────────────────────
--
-- Enabled with no policy, which denies every request that is not the service
-- role. That is the whole intent and it is worth stating, because "RLS enabled,
-- zero policies" reads like an unfinished migration and is not: there is no
-- caller who should read this table. It is not user data — no account owns a
-- row — so there is nobody for a SELECT policy to be written for. The service
-- role bypasses RLS and does the writing.

ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;

-- ─── 6. Grants ────────────────────────────────────────────────────────────────
--
-- Belt to RLS's braces, and the more important of the two here: the front door
-- is reached by `anon`, so `anon` is the role an attacker actually holds. It
-- gets nothing — not INSERT either. Writes go through the server action with
-- the service-role client, never from the browser, or the counts are a text box
-- anyone on the internet can type into.

REVOKE ALL ON public.funnel_events FROM anon;
REVOKE ALL ON public.funnel_events FROM authenticated;

COMMENT ON TABLE public.funnel_events IS
  'One row per visitor per step reached on the Phase 2.97 anonymous front door. Written only by the service role; nobody reads it through the API. Deliberately holds no user_id, no IP, no user agent and no free-text column — see the migration header.';

COMMENT ON COLUMN public.funnel_events.visitor_id IS
  'First-party id issued on landing. The join key that makes four events a funnel rather than four counters. Not linked to any account, by design.';
