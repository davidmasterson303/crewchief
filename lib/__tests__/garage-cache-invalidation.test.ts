/**
 * Mutating a vehicle must tell the garage cache.
 *
 * @jest-environment node
 *
 * Three instances of one bug surfaced on 30 Jul 2026, all found by hand:
 *
 *   1. `VehicleCard` deleted a vehicle and called
 *      `setQueryData(['vehicles'], …)`. The garage keys are
 *      `['vehicles','mine',userId]` and `['vehicles','demo']`, and setQueryData
 *      matches keys *exactly*, so it had been writing to nothing.
 *   2. `OnboardingWizard` created a vehicle and navigated away without
 *      touching the cache. A brand-new user added their first car and the
 *      garage told them **"Your Garage is Empty"** for the next five minutes.
 *   3. `VehiclePhotoUploadDialog` called `router.refresh()`, which re-renders
 *      server components. The garage is not one — it is a TanStack Query cache
 *      with a five-minute staleTime — so an uploaded photo did not appear until
 *      a full reload.
 *
 * Each looked like data loss and was not. The common cause is that the garage
 * list is client-cached and nothing made mutations say so.
 *
 * ── What this check can and cannot do ───────────────────────────────────────
 *
 * It is a static check: it asserts that a component calling a vehicle-mutating
 * server action also invalidates the `['vehicles']` key somewhere in the same
 * file. It cannot prove the invalidation runs on the success path, or that it
 * runs at all at runtime.
 *
 * That is still worth having. All three bugs above had **no invalidation
 * anywhere in the file**, which is exactly what this catches — and it catches
 * the fourth one on the day it is written rather than when a user reports it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const COMPONENTS = join(ROOT, 'components');

/** Server actions that change what the garage should show. */
const VEHICLE_MUTATIONS = [
  'createVehicle',
  'deleteVehicle',
  'uploadVehiclePhoto',
  'removeVehiclePhoto',
];

/**
 * Prefix invalidation on the vehicles key. Deliberately not matching
 * `setQueryData`: exact-key writes are what bug 1 was, so a file that only
 * called setQueryData should still fail.
 */
const INVALIDATES_VEHICLES =
  /invalidateQueries\s*\(\s*\{\s*queryKey:\s*\[\s*['"`]vehicles['"`]/;

function componentFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) componentFiles(full, acc);
    else if (entry.name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

describe('vehicle mutations invalidate the garage', () => {
  const offenders: string[] = [];

  for (const file of componentFiles(COMPONENTS)) {
    const source = readFileSync(file, 'utf8');

    const mutates = VEHICLE_MUTATIONS.filter((fn) =>
      new RegExp(`\\b${fn}\\s*\\(`).test(source)
    );
    if (mutates.length === 0) continue;

    if (!INVALIDATES_VEHICLES.test(source)) {
      offenders.push(`${file.replace(ROOT + '/', '')} calls ${mutates.join(', ')}`);
    }
  }

  it('every component that mutates a vehicle invalidates the vehicles key', () => {
    expect(offenders).toEqual([]);
  });

  it('finds the mutation sites at all', () => {
    // Guards against the check silently passing because the regexes stopped
    // matching anything — a green test that examines nothing, which this
    // codebase has shipped before.
    const mutatingFiles = componentFiles(COMPONENTS).filter((f) => {
      const source = readFileSync(f, 'utf8');
      return VEHICLE_MUTATIONS.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(source));
    });

    expect(mutatingFiles.length).toBeGreaterThanOrEqual(3);
  });
});
