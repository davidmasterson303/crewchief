/*
  # A used car arrives with a history, and nowhere to put it

  Track A2a. **Additive only** — one new column and one new allowed value for an
  existing CHECK. Nothing is dropped, nothing is rewritten, and no existing row
  changes.

  ## Why

  `evaluateSchedule` in `packages/core/src/service-due.ts` accepts
  `lastServiceMileage(service)` and `lastServiceDate(service)`. Its own comment
  explains what happens without them:

    > Treating an unknown history as "never done" would open the app on a wall
    > of red for every second-hand car, which is both wrong and the fastest way
    > to teach someone the alerts are noise.

  So it degrades honestly instead: mileage services fall back to "next boundary
  above the current reading", and every **time-based** service reports
  `unknown`, which is why brake fluid renders as "we cannot say" on all four
  cars.

  `ServiceMilestoneScreen` calls it with **neither lookup supplied**, because
  there is nothing to supply. A person who bought a car at 94,800 miles has no
  way to tell this product anything about the 94,800 miles that came before
  them, and the screen a service notification opens is therefore permanently
  estimating.

  ## Why this is not a new table

  The obvious move is a `vehicle_service_baseline` table holding the answer to
  the onboarding question. It would also be a second history store, needing its
  own matching, its own RLS, and its own path into the lookups above.

  `maintenance_line_items` already *is* the service history, and
  `maintenance-sync.ts` already matches a free-text description to a scheduled
  category through `CATEGORY_KEYWORD_MAP`. An owner saying "major service at
  85,000, about six months ago" is the same shape as a line item from an
  invoice — a description, a date, a mileage, a source. So the baseline is a row
  in the table that already exists, and every consumer picks it up for free.

  ## 1. `mileage_at_service` — the column the code already reads

  `maintenance-sync.ts:52` is:

      return item.service_mileage || item.mileage_at_service || 0;

  **Neither column exists.** That expression has always returned `0`.

  It has not caused a visible defect because the only writer of a mileage —
  `LogServiceModal` — is reached solely through `UpcomingMaintenance`, which R14
  recorded as rendered by nothing (confirmed again on 8 Aug: zero importers).
  Dead code writing a column that was never added, read by a fallback chain that
  quietly resolved to zero.

  One name is added, not two. `mileage_at_service` reads as what it is and is
  the fallback every reader already tries second. `service_mileage` stays
  unimplemented; the dead writer that uses it is a separate clean-up.

  ## 2. `'owner-onboarding'` — a memory is not an invoice

  A new `source` value rather than reusing `'manual'`, because the distinction
  is one the product has to be able to state. An invoice is evidence. "I think
  it was around 85,000" is a recollection, offered on a sign-up screen by
  someone who wants to finish sign-up.

  `service-provenance.ts` renders that difference — a milestone resting on an
  owner-reported baseline must not claim "From your service records". Recording
  the two under one value would make that claim unsayable, which is precisely
  the failure `20260801120000` added this column to end.

  Note that `'manual_entry'` — what `LogServiceModal` actually inserts — is
  **not** in the CHECK and never has been, so that insert would be rejected on
  the constraint as well as on the missing column. Left alone deliberately: it
  is unreachable, and adding a value to legalise dead code would be inventing a
  meaning nothing uses.
*/

-- ─── 1. Mileage at the time of service ───────────────────────────────────────

ALTER TABLE public.maintenance_line_items
  ADD COLUMN IF NOT EXISTS mileage_at_service integer;

/*
  Bounded rather than left open. A null means "not recorded", which is the
  common case and stays legal; a negative reading is not a weaker fact but a
  wrong one, and `nextDueMileage` would take it as a real baseline and place
  the next service before the car was built.

  The ceiling is deliberately generous — the highest-mileage cars on record are
  around 3 million — so it rejects a typo or a VIN pasted into the wrong box
  without arguing with an unusual but genuine odometer.
*/
ALTER TABLE public.maintenance_line_items
  DROP CONSTRAINT IF EXISTS maintenance_line_items_mileage_at_service_check;

ALTER TABLE public.maintenance_line_items
  ADD CONSTRAINT maintenance_line_items_mileage_at_service_check
  CHECK (
    mileage_at_service IS NULL
    OR (mileage_at_service >= 0 AND mileage_at_service <= 3000000)
  );

COMMENT ON COLUMN public.maintenance_line_items.mileage_at_service IS
  'Odometer reading when this service was performed. NULL means not recorded — '
  'the common case for an invoice that does not print one. Read by '
  'maintenance-sync.ts to supply evaluateSchedule''s lastServiceMileage lookup.';

-- ─── 2. An owner-reported baseline is its own kind of source ─────────────────

ALTER TABLE public.maintenance_line_items
  DROP CONSTRAINT IF EXISTS maintenance_line_items_source_check;

ALTER TABLE public.maintenance_line_items
  ADD CONSTRAINT maintenance_line_items_source_check
  CHECK (
    source IS NULL
    OR source IN ('vision', 'manual', 'seed', 'owner-onboarding')
  );

COMMENT ON CONSTRAINT maintenance_line_items_source_check
  ON public.maintenance_line_items IS
  'vision = a model read an invoice. manual = typed into a completion form. '
  'seed = written by the demo seed migration. owner-onboarding = what the owner '
  'recalled at sign-up, which is a recollection rather than evidence and is '
  'labelled differently by service-provenance.ts.';
