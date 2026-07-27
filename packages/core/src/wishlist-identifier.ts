/**
 * The canonical wishlist item identifier.
 *
 * ── The bug this exists to fix ──────────────────────────────────────────────
 *
 * `wishlist_items` dedupes on UNIQUE(vehicle_id, item_identifier), but three
 * entry points each built that identifier differently for the same item:
 *
 *   dossier      dossier:maintenance:cvt_fluid_flush
 *   consultant   consultant-cvt-fluid-flush
 *   manual       manual:maintenance:cvt_fluid_flush
 *
 * Because the source was baked into the dedupe key, the same job added twice
 * from different places produced two rows and no conflict. That caused three
 * user-visible failures:
 *
 *   1. Duplicates. Add from the dossier, then the consultant — two entries.
 *   2. A lying "already added" state. wishlist/check matches on the exact
 *      identifier, so the dossier asked about `dossier:…` while the row was
 *      stored as `consultant-…`. No match, button still says "Add", click
 *      again, another duplicate.
 *   3. Silent removal failures. removeItemFromWishlist recomputed the
 *      dossier-format identifier and deleted where it matched. For an item
 *      added elsewhere that matched zero rows and still returned success —
 *      the item stayed on screen and nothing reported an error.
 *
 * The normalisation differed too, not just the prefix: the dossier collapsed
 * every non-alphanumeric run to `_`, while the consultant only replaced
 * whitespace with `-`, keeping brackets and dots.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * The identifier describes WHAT the item is, never where it came from. Source
 * already has its own column; duplicating it inside the dedupe key was the
 * bug. Every call site must use this function — a fourth format would
 * reintroduce the same failure.
 */

export type WishlistItemType = 'issue' | 'maintenance' | 'modification';

/**
 * Build the identifier for an item.
 *
 * Stable properties, relied on by the migration that normalises existing
 * rows — change these and the two fall out of sync:
 *
 *   - lowercase
 *   - every run of non-alphanumerics becomes a single underscore
 *   - leading and trailing underscores are trimmed
 *
 * "Oil Dilution (2.0T)" as an issue  ->  issue:oil_dilution_2_0t
 * "CVT Fluid Flush" as maintenance   ->  maintenance:cvt_fluid_flush
 */
export function wishlistItemIdentifier(
  itemType: WishlistItemType | string,
  itemName: string
): string {
  const slug = itemName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${itemType}:${slug}`;
}
