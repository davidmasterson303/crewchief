/*
  # Record where a maintenance line item came from

  ## Why

  `9597869` removed an unconditional **AI Extracted** badge from every row on
  the maintenance page, and a `Digitized by <model>` page heading with it. Both
  claimed a model had read records it never read. `maintenance_line_items` has
  three writers and only one of them is the vision path:

    - the invoice extraction path — a model genuinely reads the invoice
    - `moveServiceItemToHistory` — a user-typed completion form: date, shop,
      cost, notes. Nothing is read by a model.
    - `20260314142241_seed_demo_vehicles.sql` — an INSERT in a migration, and
      the origin of every row on all three demo cars, which is the surface
      recruiters are sent to.

  The badge was removed rather than gated **because provenance was not recorded
  anywhere**. There was no column saying where a row came from, and the commit
  message is explicit that any distinguisher based on which fields happen to be
  populated "would be a guess wearing a badge". This adds the column so the
  claim can be made from data.

  ## Nullable on purpose, and not backfilled by guessing

  Existing rows on real vehicles get `NULL`, meaning **unknown provenance**, and
  the badge will not render for them. That is the honest cost: a row genuinely
  extracted from an invoice last month cannot be distinguished today from one
  typed into a completion form, and inventing a rule to tell them apart is the
  exact failure this column exists to end.

  The demo rows are different, and are backfilled to `'seed'` — not as a guess.
  Demo vehicles are read-only (`authorizeVehicleAccess` denies every write
  intent on them, and the consultant route is the only demo-reachable write
  path at all), so the seed migration is provably the sole writer of those rows.
  Marking them records what is already known rather than inferring it.

  ## Constrained, so a fourth writer cannot invent a fourth meaning

  A free-text column would drift — 'ai', 'AI', 'gemini', 'extracted' — and the
  badge condition would quietly stop matching. The CHECK is the point.
*/

-- ─── 1. The column ────────────────────────────────────────────────────────────

ALTER TABLE public.maintenance_line_items
  ADD COLUMN IF NOT EXISTS source text;

/*
  Dropped and recreated rather than added conditionally, so re-running this
  migration converges on exactly this definition even if an earlier run left a
  different one behind. Same reasoning as the policy authoring in
  20260731040000.
*/
ALTER TABLE public.maintenance_line_items
  DROP CONSTRAINT IF EXISTS maintenance_line_items_source_check;

ALTER TABLE public.maintenance_line_items
  ADD CONSTRAINT maintenance_line_items_source_check
  CHECK (source IS NULL OR source IN ('vision', 'manual', 'seed'));

COMMENT ON COLUMN public.maintenance_line_items.source IS
  'Which writer produced this row: vision (a model read an invoice), manual (a '
  'user-typed completion form), seed (the demo seed migration). NULL means the '
  'row predates this column and its provenance is unknown — render no '
  'provenance claim for it.';

-- ─── 2. Backfill only what is known ───────────────────────────────────────────
--
-- Demo cars only. Every other row keeps NULL, because nothing on it says where
-- it came from and this migration will not guess.

UPDATE public.maintenance_line_items
SET source = 'seed'
WHERE source IS NULL
  AND vehicle_id IN (
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000003'
  );

-- ─── 3. What this does not do ─────────────────────────────────────────────────
--
-- No NOT NULL constraint. Adding one would require a default, a default would
-- have to pick a value, and picking one would reintroduce the guess. The write
-- sites set it explicitly; a row arriving without it is a bug worth seeing as
-- NULL rather than one silently labelled.
