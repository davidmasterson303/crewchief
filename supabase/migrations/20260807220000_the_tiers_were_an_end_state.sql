/*
  # Drop the two columns the tier system left behind

  ⚠ **This is the first destructive migration in a week.** Every recent one has
  been CREATE TABLE only, with a note that the dashboard's "Potential issue
  detected" modal will not appear. **This one drops columns and that modal WILL
  fire — correctly.** Read this header before running it.

  ## What is being removed, and why it is safe now

  `vehicles.performance_goal` — a text column with `NOT NULL DEFAULT 'moderate'`
  that **no screen ever wrote**. `app/actions.ts` recorded the bug it caused:
  modification analysis read it instead of the owner's real answer, so someone
  who said "stock" in onboarding got mod analysis written for a "moderate"
  owner. Every reader is gone as of 7 Aug — the mobile API, the two garage
  selects and the last fallback in `generateModDetails`.

  `vehicles.earned_tier` — the unlockable tier. It gated the modification list
  to *exactly* its own difficulty, so a car sitting at `mild` showed only Easy
  mods; measured on this database, every vehicle but one sat at `mild`, which is
  how the WRX owner who asked for "track-ready, high-performance builds" was
  shown one modification out of five. You advanced by completing mods and
  `modification_tracking` is empty across the entire product, so nobody ever
  advanced. `recomputeVehicleTier`, `getTierProgress` and `TierProgressCard` are
  all deleted; the build dial shows where a car sits directly.

  ## 🚨 `performance_goal` exists on three tables. This drops it from ONE.

    vehicles              <- dropped here. Vestigial.
    mod_detail_queue      <- LEAVE. NOT NULL, and part of
                             UNIQUE (vehicle_id, mod_name, performance_goal).
    performance_mod_cache <- LEAVE. Cache key.

  An unqualified `DROP COLUMN performance_goal` is a plausible reading of the
  decision and would destroy the mod cache's dedupe and the queue's. Both
  statements below name `public.vehicles` explicitly and nothing else.

  ## Not dropped, deliberately

  `modification_tracking.tier` stays for now. Rows carry it, and it is still
  written — as a constant — so an existing backfill row keeps a sensible
  difficulty. Removing it is a second, smaller change once those rows are
  reconciled, and bundling it here would put two unrelated risks in one
  irreversible statement.

  ## Reversing this

  There is no undo. Both columns are recreatable — the values are not. Neither
  holds anything a screen produced: `performance_goal` holds a default nobody
  chose, `earned_tier` holds a tier nobody could advance past. That is the
  argument for dropping them rather than a reason to be casual about it.
*/

ALTER TABLE public.vehicles DROP COLUMN IF EXISTS performance_goal;

ALTER TABLE public.vehicles DROP COLUMN IF EXISTS earned_tier;
