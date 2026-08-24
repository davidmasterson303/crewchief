/*
  A recall lookup that found nothing is not the same as a car with no recalls.

  ── ⚠ The defect, from the 24 Aug QA audit (FN-03) ─────────────────────────

  `recallsByVehicle` matches on NHTSA's own controlled vocabulary. A make or
  model it does not recognise returns **HTTP 200 with `{"Count": 0, "results":
  []}`** — byte-identical to a genuinely clean vehicle. Both were written here
  as `recalls: []`, and `recallsChecked` was then derived from *row existence*:

      const recallsChecked = Boolean(nhtsa);        -- app/actions.ts

  So typing the make as **"Chevy"** instead of **"CHEVROLET"** — or "Dodge Ram",
  or any accented marque, or any model with a slash — produced a green tick and
  the sentence "No active recalls" on a truck with real open campaigns. The
  vehicle strings are user-supplied and were never validated against NHTSA's
  vocabulary.

  This is the same class of defect `health-claims.ts` was written for and the
  same one `20260821…` addressed one table over: **absence rendered as an
  all-clear, on a safety claim.**

  ── Why a column rather than an inference ──────────────────────────────────

  There is no way to tell the two apart after the fact. `recalls = []` is the
  same bytes either way, and `last_checked` only says a request happened, not
  that it matched anything. The outcome has to be recorded at the moment it is
  known, by the code that made the call.

  `matched`  NHTSA recognised the vehicle. `recalls` is authoritative,
             including when it is empty.
  `no_match` NHTSA returned 200 and zero results for a vehicle it does not
             recognise. **`recalls` says nothing about this car.**
  `failed`   The request errored, timed out, or returned a non-200.

  Only `matched` may be rendered as an all-clear. The other two are "we cannot
  say", which is what §10 of `CLAUDE.md` requires and what the recall tile
  already knows how to draw.

  ── ⚠ Existing rows are backfilled to `unknown`, not to `matched` ──────────

  Every row already in this table was written by the old code path, which did
  not distinguish the three outcomes — so we genuinely do not know which of
  them each row is. Defaulting them to `matched` would assert the all-clear
  this migration exists to prevent, for exactly the vehicles most likely to be
  affected. `unknown` reads as "we cannot say", the honest answer, and the
  quarterly refresh replaces it with a real one on the next sweep.
*/

ALTER TABLE nhtsa_data
  ADD COLUMN IF NOT EXISTS lookup_status text NOT NULL DEFAULT 'unknown';

/*
  Constrained rather than left free-text. A fifth spelling arriving from a
  future call site is precisely how "matched" and "match" end up meaning
  different things to the reader and the writer.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nhtsa_data_lookup_status_check'
  ) THEN
    ALTER TABLE nhtsa_data
      ADD CONSTRAINT nhtsa_data_lookup_status_check
      CHECK (lookup_status IN ('matched', 'no_match', 'failed', 'unknown'));
  END IF;
END $$;

COMMENT ON COLUMN nhtsa_data.lookup_status IS
  'How the NHTSA lookup ended. Only ''matched'' permits an all-clear; ''no_match'' means NHTSA did not recognise the vehicle and this row says nothing about it. See lib/vehicle-research.ts.';

/*
  ── The unique key the upsert needs ────────────────────────────────────────

  `fetchNHTSARecalls` used `.insert()`, and **did not destructure the result**,
  so the second call for a vehicle raised `23505` into a variable nobody read.
  The practical effect was that recalls were fetched **once per vehicle, ever**:
  a car researched in February shows a green tick forever, even after NHTSA
  opens a campaign against it in April.

  `.upsert(…, { onConflict: 'vehicle_id' })` needs a unique constraint to
  conflict on. `vehicle_id` is already `UNIQUE NOT NULL` on this table, so this
  is defensive — it makes the constraint the upsert depends on explicit rather
  than inherited, and it is a no-op where it already holds.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nhtsa_data'::regclass AND contype IN ('u', 'p')
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'nhtsa_data'::regclass AND attname = 'vehicle_id')]
  ) THEN
    ALTER TABLE nhtsa_data ADD CONSTRAINT nhtsa_data_vehicle_id_key UNIQUE (vehicle_id);
  END IF;
END $$;

/*
  ── The index the quarterly refresh reads ──────────────────────────────────

  `next_check_due` has been written since this table was created and **read by
  nothing** — `grep` finds the write and a type declaration and no consumer, so
  the "quarterly recheck" the schema header advertises has never existed. The
  nightly sweep now selects on it, which makes it a query predicate for the
  first time.

  Partial, on the rows the sweep actually wants: a full index over a column
  where most values are in the future would be mostly dead weight.
*/
CREATE INDEX IF NOT EXISTS nhtsa_data_next_check_due_idx
  ON nhtsa_data (next_check_due)
  WHERE next_check_due IS NOT NULL;
