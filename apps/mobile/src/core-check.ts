/**
 * Does `@wellkept/core` actually work inside Metro?
 *
 * The monorepo decision rests on shared logic being genuinely shared. Four
 * separate things have to hold for that, and only the first is obvious:
 *
 *   1. Metro resolves the workspace symlink at all.
 *   2. The modules it resolves are Next-free and Node-free. `@wellkept/core`
 *      promises this in its own package.json — "No Next, no Supabase, no Node
 *      built-ins" — and React Native is where that promise gets tested, since
 *      an accidental `node:crypto` import throws at runtime rather than
 *      failing a build.
 *   3. The **runtime features** that code relies on exist here. This is the one
 *      no static check can reach — see below.
 *   4. They compute the same answers they compute on the server.
 *
 * Each check calls real shared code with a known input and asserts a known
 * output. A check that only asserted "the import did not throw" would pass
 * against a module that had been quietly stubbed.
 *
 * ── Why this is not made redundant by `portability.test.ts` ─────────────────
 *
 * That suite walks every file in `packages/core/src` transitively and rejects
 * `next/*`, `@supabase/*`, `node:*`, bare `fs`/`path`/`crypto` and browser
 * globals. It is thorough, and it covers point 2 better than this file does.
 *
 * **It cannot cover point 3, because a runtime capability is not an import.**
 * `formatting-utils.ts` calls `Intl.NumberFormat` and `toLocaleString` — Hermes
 * has historically shipped without full Intl, and no import scan would ever
 * mention it. On 5 Aug `Object.hasOwn` was added to
 * `consultant-context-kinds.ts`; it is ES2022, Jest runs on Node where it
 * always exists, and confirming it on the phone meant reading the builtin table
 * out of `hermesvm.framework` by hand. That is the failure this file exists to
 * make visible, and it is exactly the shape of the three "green but did not
 * run" defects of 4 Aug.
 *
 * So the two are complementary: the Node suite proves core *may* be imported
 * here, and this proves it *works* here. Deleting either leaves a real gap.
 */

import { isDemoVehicleId } from '@wellkept/core/demo';
import { storedUrl, storagePathFromStoredUrl } from '@wellkept/core/storage-paths';
import { vehicleIdSchema } from '@wellkept/core/validation';
import { formatMileage } from '@wellkept/core/formatting-utils';

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
      /*
        Not just "did it return a string". `formatMileage` is
        `toLocaleString('en-US')`, and a Hermes built without Intl returns the
        *unseparated* digits rather than throwing — so a check for "94" would
        pass against a garage rendering "94800 mi". The separator is the
        assertion, because the separator is what would silently go missing.
      */
      const formatted = formatMileage(94800);
      return { ok: formatted === '94,800', detail: `${formatted} (want 94,800)` };
    }),

    run('runtime — the ES2022 features core relies on', () => {
      /*
        The gap `portability.test.ts` cannot see, and the one that cost real
        time on 5 Aug. `Object.hasOwn` is what `isContextKind` narrows with;
        it exists in Node, so Jest can never fail on it, and its absence here
        would throw inside the advisor's provenance row rather than anywhere
        near this file.

        Checked by calling it rather than by `typeof`, so a polyfill that is
        present but wrong fails too.
      */
      const hasOwn = typeof Object.hasOwn === 'function' && Object.hasOwn({ a: 1 }, 'a');
      const notInherited = typeof Object.hasOwn === 'function' && !Object.hasOwn({}, 'toString');
      return {
        ok: hasOwn && notInherited,
        detail: `Object.hasOwn own=${hasOwn}, ignores-prototype=${notInherited}`,
      };
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
