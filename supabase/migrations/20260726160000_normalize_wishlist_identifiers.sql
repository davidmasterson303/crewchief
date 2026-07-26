/*
  # Normalise wishlist identifiers and collapse the duplicates they hid

  ## Why

  `wishlist_items` dedupes on UNIQUE(vehicle_id, item_identifier), but three
  entry points each built that key differently for the same item:

    dossier      dossier:maintenance:cvt_fluid_flush
    consultant   consultant-cvt-fluid-flush
    manual       manual:maintenance:cvt_fluid_flush

  Because the *source* was baked into the key, the constraint never fired
  across surfaces. Reported symptom: the wishlist "never really worked
  reliably". Concretely —

    1. Adding an item from the dossier and again from the consultant created
       two rows.
    2. `wishlist/check` matches identifiers exactly, so an item added on one
       surface read as absent on another. Clicking again made a third.
    3. `removeItemFromWishlist` recomputed the *dossier*-format identifier and
       deleted where it matched. For an item added elsewhere that matched zero
       rows and still returned success — the item stayed on screen and nothing
       errored.

  The application now derives every identifier from `lib/wishlist-identifier.ts`
  as `${item_type}:${slug}`, describing what the item *is* rather than where
  it came from. `source` already has its own column.

  ## What this does

  Rewrites existing rows into the new format. Because normalisation makes
  previously-distinct keys collide, duplicates must be removed *before* the
  update or it will violate the unique constraint mid-statement.

  Order is therefore load-bearing:

    1. delete the duplicates that normalisation would expose, keeping the
       earliest of each group
    2. rewrite the survivors

  ## Keeping the earliest

  Ordered by created_at, then id as a tiebreaker for rows created in the same
  transaction. The oldest row is the one the user added first and has most
  likely edited since — notes, costs, status — so it is the one to preserve.

  Idempotent: re-running finds nothing to collapse and rewrites values to
  themselves.
*/

-- ============================================================
-- 1. Collapse duplicates that normalisation would create
-- ============================================================

WITH normalized AS (
  SELECT
    id,
    vehicle_id,
    created_at,
    -- Must match wishlistItemIdentifier() in lib/wishlist-identifier.ts:
    -- lowercase, non-alphanumeric runs to a single underscore, trimmed.
    item_type || ':' || trim(
      BOTH '_' FROM regexp_replace(lower(item_name), '[^a-z0-9]+', '_', 'g')
    ) AS new_identifier
  FROM wishlist_items
),
ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id, new_identifier
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM normalized
)
DELETE FROM wishlist_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ============================================================
-- 2. Rewrite the survivors
-- ============================================================

UPDATE wishlist_items
SET item_identifier = item_type || ':' || trim(
  BOTH '_' FROM regexp_replace(lower(item_name), '[^a-z0-9]+', '_', 'g')
);

/*
  ## Verifying

  No identifier should carry a source prefix any more — expect zero rows:

    SELECT item_identifier FROM wishlist_items
    WHERE item_identifier LIKE 'dossier:%'
       OR item_identifier LIKE 'consultant-%'
       OR item_identifier LIKE 'manual:%';

  And no vehicle should hold two rows for the same item — also zero:

    SELECT vehicle_id, item_identifier, count(*)
    FROM wishlist_items
    GROUP BY 1, 2 HAVING count(*) > 1;

  The demo seed used the `dossier:` format, so the three demo vehicles' items
  are rewritten too. Their names are unchanged, so the dossier UI — which
  computes identifiers from the same names — will match them again. Confirm
  with `node scripts/verify-demo.mjs`, then open a demo dashboard and check
  the wishlist still lists its items and shows them as already added.
*/
