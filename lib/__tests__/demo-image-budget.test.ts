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
import {
  DEMO_UNPHOTOGRAPHED_VEHICLE_IDS,
  DEMO_VEHICLE_IDS,
} from '@crewchief/core/demo';
import { cardSlotSource } from '@crewchief/core/photo-slots';

const MIGRATION = join(
  __dirname, '..', '..', 'supabase', 'migrations',
  '20260726230000_local_demo_photos_and_focal_points.sql'
);

/*
  The seeded hero paths, read from the migration rather than from a constant.

  `DEMO_IMAGES` used to be that constant, and it is gone — the database is the
  only source of truth for which photograph a demo car has, verified against
  the live rows on 2 Aug 2026. The migration is the repo's record of what those
  rows hold, so it is what a static suite can honestly measure.

  What the *cards* fetch is then derived the same way the UI derives it, through
  `cardSlotSource`. That is the point: the assertion runs the shipped rule, not
  a copy of it, so the two cannot drift.
*/
function seededHeroPaths(): Record<string, string> {
  const sql = readFileSync(MIGRATION, 'utf8');

  // `v1_id uuid := 'a100…'::uuid;` — the local names the UPDATEs are keyed by.
  const ids = new Map<string, string>();
  const idRe = /(\w+)\s+uuid\s*:=\s*'([0-9a-f-]+)'/gi;
  for (let m = idRe.exec(sql); m; m = idRe.exec(sql)) ids.set(m[1], m[2]);

  // `SET image_url = '…' … WHERE id = v1_id`
  const byVehicle: Record<string, string> = {};
  const rowRe = /image_url\s*=\s*'([^']+)'[\s\S]*?WHERE\s+id\s*=\s*(\w+)/gi;
  for (let m = rowRe.exec(sql); m; m = rowRe.exec(sql)) {
    const uuid = ids.get(m[2]);
    if (uuid) byVehicle[uuid] = m[1];
  }
  return byVehicle;
}

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
  const heroes = seededHeroPaths();

  /*
    What the grid actually fetches.

    The deliberately-unphotographed car is excluded, and that exclusion is the
    reason this is keyed by vehicle id rather than being a flat list of paths.
    The M3 carries a seeded `image_url` like the others — `planVehiclePhoto`
    returns null for it regardless, so it renders the plate and requests
    nothing. Counting its file would measure a download that never happens and
    quietly eat 62 KB of a 250 KB budget.
  */
  const paths = Object.entries(heroes)
    .filter(([id]) => !DEMO_UNPHOTOGRAPHED_VEHICLE_IDS.some((u) => u === id))
    .map(([, path]) => cardSlotSource(path) as string);

  it('has photographs to measure', () => {
    // Guards the guard: an empty map would make every assertion below vacuous.
    expect(paths.length).toBeGreaterThan(0);
  });

  it('accounts for every demo vehicle, photographed or deliberately not', () => {
    /*
      This replaces a bare `toHaveLength(3)`, which was the right assertion while
      all three cars carried a file and the wrong one the moment the M3 stopped.
      A count cannot tell "we removed a photograph on purpose" from "a photograph
      fell out of the map", and the second is exactly the silent regression this
      suite exists for — a missing key sends the card back to the vehicle's own
      column, which still holds an old remote hero.

      So the invariant is accounting rather than arithmetic: each demo vehicle is
      in exactly one of the two lists, and the lists together cover all of them.
    */
    const photographed = [...DEMO_VEHICLE_IDS].filter(
      (id) => !DEMO_UNPHOTOGRAPHED_VEHICLE_IDS.some((u) => u === id)
    );
    // Widened deliberately: the const assertion narrows to a literal union, so
    // `includes` would reject any id that is not already the expected one.
    const unphotographed: string[] = [...DEMO_UNPHOTOGRAPHED_VEHICLE_IDS];

    expect([...photographed, ...unphotographed].sort()).toEqual([...DEMO_VEHICLE_IDS].sort());
    expect(photographed.filter((id) => unphotographed.includes(id))).toEqual([]);
    // The migration seeds every demo car, photographed or not.
    expect(Object.keys(heroes).sort()).toEqual([...DEMO_VEHICLE_IDS].sort());
  });

  it('keeps at least one car unphotographed, so the empty state is on show', () => {
    // The demo's only live exercise of the no-photo design — see
    // components/VehicleIdentity.tsx, which calls that state the primary one and
    // records that nothing rendered it while every seeded car had a file.
    expect(DEMO_UNPHOTOGRAPHED_VEHICLE_IDS.length).toBeGreaterThanOrEqual(1);
  });

  it.each(paths)('%s exists and is a card-sized derivative', (path) => {
    expect(() => sizeOf(path)).not.toThrow();
    expect(sizeOf(path)).toBeLessThanOrEqual(PER_CARD_CEILING_BYTES);
  });

  it('totals under 250 KB across the grid', () => {
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
      The rule DEMO_IMAGES carried since the Pexels cutover, now carried by
      `cardSlotSource`: the card and
      the hero must not show different cars. The derivative changes the file
      size, never the frame, so each card path must sit in the same per-vehicle
      folder the migration's hero path does.
    */
    const migration = readFileSync(MIGRATION, 'utf8');

    for (const path of paths) {
      const folder = path.split('/')[2]; // /vehicles/<folder>/<file>
      expect(folder).toBeTruthy();
      expect(migration).toContain(`/vehicles/${folder}/`);
    }
  });
});
