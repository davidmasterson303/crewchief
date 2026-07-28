/**
 * The garage grid's image payload has a budget, and this holds it.
 *
 * CC-142's acceptance criteria include "garage grid total image payload under
 * 250 KB with all three demo vehicles photographed." Before the derivatives it
 * was **2,252 KB** — three page-width heroes fetched to fill three ~400px
 * boxes, which is roughly a tenth of each file doing any work.
 *
 * This is a ratchet rather than documentation because the regression is
 * invisible in every way that usually catches things. Pointing DEMO_IMAGES back
 * at `hero-3x2.jpg` renders *identically* — same photograph, same crop, same
 * layout — and costs 2 MB. Nothing about the page looks wrong, no test of
 * behaviour fails, and on a development machine it is not even slow.
 *
 * The likeliest way it comes back is someone deleting the DEMO_IMAGES map, as
 * its own comment invites, and letting the card fall through to
 * `vehicles.image_url` — which holds the hero. That is a correct-looking
 * cleanup with a 10x payload cost, so it fails here instead.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_IMAGES } from '@crewchief/core/demo';

const PUBLIC = join(__dirname, '..', '..', 'public');

/** CC-142's stated criterion. */
const GRID_BUDGET_BYTES = 250 * 1024;

/**
 * No single card may dominate the budget. Without this, one busy photograph
 * re-encoded at high quality can eat the headroom the other two left, and the
 * total still passes.
 */
const PER_CARD_CEILING_BYTES = 120 * 1024;

function sizeOf(publicPath: string): number {
  return statSync(join(PUBLIC, publicPath.replace(/^\//, ''))).size;
}

describe('the demo garage grid stays inside its payload budget', () => {
  const paths = Object.values(DEMO_IMAGES);

  it('has three demo photographs to measure', () => {
    // Guards the guard: an empty map would make every assertion below vacuous.
    expect(paths).toHaveLength(3);
  });

  it.each(paths)('%s exists and is a card-sized derivative', (path) => {
    expect(() => sizeOf(path)).not.toThrow();
    expect(sizeOf(path)).toBeLessThanOrEqual(PER_CARD_CEILING_BYTES);
  });

  it('totals under 250 KB across all three cards', () => {
    const total = paths.reduce((sum, p) => sum + sizeOf(p), 0);

    // Reported in KB so a failure says how far over, not just that it is over.
    expect({ totalKB: Math.round(total / 1024) }).toEqual({
      totalKB: expect.any(Number),
    });
    expect(total).toBeLessThanOrEqual(GRID_BUDGET_BYTES);
  });

  it('does not serve the page-width hero to a card', () => {
    // The specific regression: the heroes are the right source for a 400px
    // full-width band and the wrong one for a 400px card. Naming them here
    // makes the failure message say which mistake was made.
    for (const path of paths) {
      expect(path).not.toMatch(/hero-3x2\.jpg$/);
    }
  });

  it('keeps the card and the hero pointed at the same photograph', () => {
    /*
      The rule DEMO_IMAGES has carried since the Pexels cutover: the card and
      the hero must not show different cars. The derivative changes the file
      size, never the frame, so each card path must sit in the same per-vehicle
      folder the migration's hero path does.
    */
    const migration = readFileSync(
      join(
        __dirname, '..', '..', 'supabase', 'migrations',
        '20260726230000_local_demo_photos_and_focal_points.sql'
      ),
      'utf8'
    );

    for (const path of paths) {
      const folder = path.split('/')[2]; // /vehicles/<folder>/<file>
      expect(folder).toBeTruthy();
      expect(migration).toContain(`/vehicles/${folder}/`);
    }
  });
});
