/**
 * Wishlist identifier — the dedupe key.
 *
 * @jest-environment node
 *
 * `wishlist_items` enforces UNIQUE(vehicle_id, item_identifier), so this
 * function decides what counts as "the same item". Three entry points used to
 * build it differently, which meant the constraint never fired across
 * surfaces — the cause of the wishlist duplicating items, showing them as
 * un-added, and silently failing to delete them.
 *
 * The property that matters is not the exact string but that **every entry
 * point produces the same one for the same item**. The cross-surface tests
 * below are the real subject; the format assertions exist because a data
 * migration normalises existing rows using the identical rules in SQL, and
 * the two must not drift.
 */

import { wishlistItemIdentifier } from '@/lib/wishlist-identifier';

describe('the same item always gets the same identifier', () => {
  // The exact failure David reported: added from the dossier, then from the
  // consultant, and the wishlist ended up with two of them.
  it('matches across dossier, consultant and manual entry', () => {
    const fromDossier = wishlistItemIdentifier('maintenance', 'CVT Fluid Flush');
    const fromConsultant = wishlistItemIdentifier('maintenance', 'CVT Fluid Flush');
    const fromManual = wishlistItemIdentifier('maintenance', 'CVT Fluid Flush');

    expect(fromDossier).toBe(fromConsultant);
    expect(fromConsultant).toBe(fromManual);
  });

  it('ignores casing and surrounding whitespace', () => {
    expect(wishlistItemIdentifier('maintenance', '  cvt fluid FLUSH ')).toBe(
      wishlistItemIdentifier('maintenance', 'CVT Fluid Flush')
    );
  });

  it('treats punctuation and spacing variants as the same item', () => {
    // "Oil Dilution (2.0T)" typed slightly differently should not create a
    // second row for the same job.
    expect(wishlistItemIdentifier('issue', 'Oil Dilution (2.0T)')).toBe(
      wishlistItemIdentifier('issue', 'Oil Dilution 2.0T')
    );
  });

  it('carries no source prefix — that was the bug', () => {
    const id = wishlistItemIdentifier('maintenance', 'CVT Fluid Flush');
    expect(id).not.toMatch(/dossier|consultant|manual/);
  });
});

describe('different items stay distinct', () => {
  it('separates items by type', () => {
    expect(wishlistItemIdentifier('issue', 'Brake Fluid Flush')).not.toBe(
      wishlistItemIdentifier('maintenance', 'Brake Fluid Flush')
    );
  });

  it('separates genuinely different names', () => {
    expect(wishlistItemIdentifier('maintenance', 'CVT Fluid Flush')).not.toBe(
      wishlistItemIdentifier('maintenance', 'Brake Fluid Flush')
    );
  });
});

describe('format — must stay in step with the SQL migration', () => {
  // The migration normalising existing rows reimplements these rules in
  // Postgres. Changing them here without changing it there splits the data.
  it('is `type:slug`, lowercase, underscore-separated', () => {
    expect(wishlistItemIdentifier('maintenance', 'CVT Fluid Flush')).toBe(
      'maintenance:cvt_fluid_flush'
    );
  });

  it('collapses each run of non-alphanumerics to one underscore', () => {
    expect(wishlistItemIdentifier('issue', 'Oil   Dilution -- (2.0T)')).toBe(
      'issue:oil_dilution_2_0t'
    );
  });

  it('trims leading and trailing underscores', () => {
    // The old dossier format left a trailing underscore on names ending in
    // punctuation — "Oil Dilution (2.0T)" became `..._2_0t_`.
    expect(wishlistItemIdentifier('issue', '(Oil Dilution)')).toBe('issue:oil_dilution');
  });

  it('handles a name that normalises to nothing', () => {
    expect(wishlistItemIdentifier('maintenance', '---')).toBe('maintenance:');
  });
});
