/*
  # Key modification analysis by the goal it was written for

  `modification_details` holds Gemini's analysis of one modification for one
  vehicle. Every field in it is written *from* the owner's performance goal —
  the prompt says "tailor your analysis to align with the AGGRESSIVE goal", and
  `alignment_with_goals` is literally about that goal — but the row was keyed
  `UNIQUE(vehicle_id, mod_name)`. The goal that produced the text was not part
  of its identity, so one cache slot had to serve four different answers.

  ## Why this was invisible until 28 Jul

  `generateModificationDetails` read `vehicle.performance_goal`, a column no
  screen ever writes, which is `'moderate'` for every vehicle that has ever
  existed. Every row therefore held moderate analysis and the collision could
  not be observed. Commit c63bdc4 made the owner's real choice reach the prompt.
  From that commit the goal genuinely varies — and the key stopped being unique
  in the only sense that matters.

  ## What it costs live

  `preloadAllPerformanceModifications` loops mild → moderate → aggressive and,
  for each, reads through a goal-blind `getModificationDetails` before
  generating. The mild pass populates the row; the moderate and aggressive
  passes hit it and return mild analysis. All three `performance_mod_cache`
  rows end up holding the same mild text under three different goal labels.
  `generateBackfillMod` (tier) and the aggressive top-up path collide the same
  way.

  ## Why the backfill is 'moderate' and not the vehicle's current goal

  Tempting to stamp each row with its vehicle's `performance_mindedness`, and
  wrong: that claims the text was written for that goal when it was not. Every
  pre-existing row was generated under the moderate context regardless of what
  the owner chose. `'moderate'` is the *true* provenance. An owner set to
  aggressive then correctly misses the cache and gets analysis actually written
  for them — which is the fix working, not cache churn.

  Re-runnable. Adds a column and rewrites constraints; deletes nothing.
*/

-- ─── 1. The column ──────────────────────────────────────────────────────────

ALTER TABLE modification_details
  ADD COLUMN IF NOT EXISTS performance_goal text;

UPDATE modification_details
  SET performance_goal = 'moderate'
  WHERE performance_goal IS NULL;

ALTER TABLE modification_details
  ALTER COLUMN performance_goal SET DEFAULT 'moderate';

ALTER TABLE modification_details
  ALTER COLUMN performance_goal SET NOT NULL;

/*
  Four values, not three. 'stock' exists only in the `performance_mindedness`
  enum and 'moderate' only in the `performance_goal` text column; the app's
  GoalKey is the union of both. A CHECK covering only the text column's three
  would reject every row a stock owner produces.
*/
ALTER TABLE modification_details
  DROP CONSTRAINT IF EXISTS modification_details_performance_goal_check;

ALTER TABLE modification_details
  ADD CONSTRAINT modification_details_performance_goal_check
  CHECK (performance_goal IN ('stock', 'mild', 'moderate', 'aggressive'));

-- ─── 2. The key ─────────────────────────────────────────────────────────────

ALTER TABLE modification_details
  DROP CONSTRAINT IF EXISTS modification_details_vehicle_id_mod_name_key;

ALTER TABLE modification_details
  DROP CONSTRAINT IF EXISTS modification_details_vehicle_id_mod_name_performance_goal_key;

ALTER TABLE modification_details
  ADD CONSTRAINT modification_details_vehicle_id_mod_name_performance_goal_key
  UNIQUE (vehicle_id, mod_name, performance_goal);

-- ─── 3. The queue's vocabulary, widened to match ────────────────────────────

/*
  `mod_detail_queue` was already keyed by goal — it got this right in Jan — but
  its CHECK predates 'stock' reaching this code at all. `getModificationDetailsBatch`
  runs for stock owners too (VehicleInsights hides the mods *tab*, not the
  tracking load), so a stock enqueue must be representable rather than rejected.
*/
ALTER TABLE mod_detail_queue
  DROP CONSTRAINT IF EXISTS mod_detail_queue_performance_goal_check;

ALTER TABLE mod_detail_queue
  ADD CONSTRAINT mod_detail_queue_performance_goal_check
  CHECK (performance_goal IN ('stock', 'mild', 'moderate', 'aggressive'));
