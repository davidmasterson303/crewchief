/**
 * Does `@crewchief/core` actually work inside Metro?
 *
 * The monorepo decision rests on shared logic being genuinely shared. Three
 * separate things have to hold for that, and only the first is obvious:
 *
 *   1. Metro resolves the workspace symlink at all.
 *   2. The modules it resolves are Next-free and Node-free. `@crewchief/core`
 *      promises this in its own package.json — "No Next, no Supabase, no Node
 *      built-ins" — and React Native is where that promise gets tested, since
 *      an accidental `node:crypto` import throws at runtime rather than
 *      failing a build.
 *   3. They compute the same answers they compute on the server.
 *
 * Each check calls real shared code with a known input and asserts a known
 * output. A check that only asserted "the import did not throw" would pass
 * against a module that had been quietly stubbed.
 */

import { isDemoVehicleId } from '@crewchief/core/demo';
import { storedUrl, storagePathFromStoredUrl } from '@crewchief/core/storage-paths';
import { vehicleIdSchema } from '@crewchief/core/validation';
import { formatMileage } from '@crewchief/core/formatting-utils';

export interface CoreCheck {
  label: string;
  ok: boolean;
  detail: string;
}

const DEMO_ACCORD = 'a1000000-0000-0000-0000-000000000001';
const NOT_A_VEHICLE = 'nonsense';

export function checkSharedCore(): CoreCheck[] {
  return [
    run('demo — knows the seeded demo cars', () => {
      const isDemo = isDemoVehicleId(DEMO_ACCORD);
      const isNot = isDemoVehicleId('11111111-1111-4111-8111-111111111111');
      return {
        ok: isDemo && !isNot,
        detail: `demo Accord → ${isDemo}, a real id → ${isNot}`,
      };
    }),

    run('storage-paths — round-trips a stored URL', () => {
      const path = `${DEMO_ACCORD}/photos/hero.jpg`;
      const back = storagePathFromStoredUrl(storedUrl(path));
      return { ok: back === path, detail: back ?? 'null' };
    }),

    run('validation — zod runs on device', () => {
      // The one most likely to break: zod is the heaviest shared dependency
      // and the likeliest to reach for something Node-only.
      const good = vehicleIdSchema.safeParse(DEMO_ACCORD).success;
      const bad = vehicleIdSchema.safeParse(NOT_A_VEHICLE).success;
      return { ok: good && !bad, detail: `uuid → ${good}, "${NOT_A_VEHICLE}" → ${bad}` };
    }),

    run('formatting — same output as the web', () => {
      const formatted = formatMileage(94800);
      return { ok: formatted.includes('94'), detail: formatted };
    }),
  ];
}

function run(label: string, check: () => { ok: boolean; detail: string }): CoreCheck {
  try {
    const { ok, detail } = check();
    return { label, ok, detail };
  } catch (error) {
    // A throw here is the interesting failure: it means core reached for
    // something React Native does not have.
    return { label, ok: false, detail: (error as Error).message };
  }
}
