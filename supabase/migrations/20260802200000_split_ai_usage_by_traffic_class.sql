/*
  # Split AI usage by traffic class, before the D2 dataset is worth anything

  ## Why this could not wait for 2.97

  It was going to. The reasoning was that the anonymous front door is what makes
  the distinction matter, so the column should ride with that phase's migration.
  That was wrong, and the meter itself is what disproved it: **the D2 dataset is
  already recording, and every row in it is `user_id IS NULL`.**

  Two weeks of a blended dataset that cannot be split afterwards is a corrupted
  input to the price decision, and the corruption is not recoverable by a later
  migration — the rows will have been written by then. The column has to exist
  before the data does.

  ## `purpose` already exists and does a different job

  `purpose` says *which feature* spent the money — consultant, invoice
  extraction, dossier. This says *whose traffic it was*. They are orthogonal:
  a consultant call can be demo, real or anonymous, and all three cost the same
  to serve and mean completely different things to a price decision.

  ## Four values, and the fourth is the one that was skewing everything

  | `surface` | What it is | Belongs in unit economics? |
  |---|---|---|
  | `account` | A signed-in user | **Yes — this is the D2 dataset** |
  | `demo` | The seeded public demo garage | No. Wanted traffic, but nobody will ever pay for it |
  | `anonymous` | The 2.97 front door, when it exists | Its own budget line (roadmap D3) |
  | `canary` | `/api/health/consultant` | **No, and it was distorting the numbers badly** |

  The canary earns its own value rather than being folded into `demo`. Measured
  on the first eight rows: it was **5 of 8**, and because it asks a fixed
  question and gets a ~40-token answer while thinking is roughly a fixed cost
  per call, it ran at **7.34x thinking-to-visible against real consultant
  traffic's 1.39x**. Averaged together those produced 3.45x, a number that
  describes neither path and flattered nothing — it was read as evidence that
  2.95a had only half worked. It had not: user traffic was at 1.39x the whole
  time.

  A synthetic health check is not usage. Leaving it in the same bucket as
  traffic that a price is derived from is how a monitoring artifact ends up
  setting a subscription price.

  ## Derived, not passed in at eleven call sites

  `lib/ai-usage.ts` works the value out from what it already has — a `user_id`
  means `account`, a demo vehicle id means `demo`, neither means `anonymous` —
  and any call site may override it. The canary overrides. This means the front
  door gets correct attribution on the day it ships without touching the other
  ten sites, and there is no per-call-site opportunity to forget.

  ## Backfill is honest about being a reconstruction

  The eight existing rows are labelled from their `purpose`: `health_check`
  becomes `canary`, everything else becomes `demo` — correct, because the only
  traffic before this migration was the seeded demo garage and the canary, and
  no account had yet made a metered call. That is a reconstruction rather than a
  measurement, which is why the default for *new* rows is `account`: a row
  written by code that has not been taught about this column should land in the
  conservative bucket, not the free one.

  ## Pure additions — no DROP

  `ADD COLUMN`, one CHECK, one index, one backfill `UPDATE`. Nothing here is a
  DROP-class statement, so the SQL Editor's "Potential issue detected" modal
  will not fire and this will not stall mid-run.
*/

-- ─── 1. The column ────────────────────────────────────────────────────────────
--
-- DEFAULT 'account' is deliberate and is the conservative choice: an un-taught
-- writer lands in the bucket that counts toward cost rather than the one that
-- is excluded from it. Over-counting a price input is recoverable; silently
-- under-counting it is not.

ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'account';

-- ─── 2. The vocabulary ────────────────────────────────────────────────────────
--
-- Constrained for the same reason `purpose` is: a free-text column drifts
-- ('demo', 'Demo', 'public'), and then the split this exists to make quietly
-- stops splitting. Kept in step with the application by
-- `ai-usage-surfaces.test.ts`.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_surface_check'
  ) THEN
    ALTER TABLE public.ai_usage_events
      ADD CONSTRAINT ai_usage_events_surface_check CHECK (surface IN (
        'account',
        'demo',
        'anonymous',
        'canary'
      ));
  END IF;
END $$;

-- ─── 3. Backfill ──────────────────────────────────────────────────────────────
--
-- Scoped to rows written before this migration. `created_at` is not used as the
-- discriminator because the clock is not the authority here; the fact that no
-- authenticated account had made a metered call before this point is. Both
-- branches are therefore stated as what they are — a reconstruction from
-- `purpose`, applied only where the column still holds its default.

UPDATE public.ai_usage_events
   SET surface = 'canary'
 WHERE purpose = 'health_check'
   AND surface = 'account';

UPDATE public.ai_usage_events
   SET surface = 'demo'
 WHERE purpose <> 'health_check'
   AND surface = 'account'
   AND user_id IS NULL;

-- ─── 4. Index ─────────────────────────────────────────────────────────────────
--
-- The D2 query is "what did real account traffic cost over this window", which
-- filters on surface and orders on time. Without this it is a full scan, which
-- is free today at eight rows and will not be at two weeks of production.

CREATE INDEX IF NOT EXISTS ai_usage_events_surface_created_idx
  ON public.ai_usage_events (surface, created_at DESC);

COMMENT ON COLUMN public.ai_usage_events.surface IS
  'Whose traffic this was, orthogonal to purpose. Only surface = ''account'' belongs in the D2 price dataset; ''canary'' is a synthetic health check and was skewing the thinking-token ratio badly before it was split out.';
