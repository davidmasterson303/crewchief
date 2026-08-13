/**
 * The primer's rule is right; this asserts the app actually obeys it.
 *
 * @jest-environment node
 *
 * Phase 5, C5. `push-priming.test.ts` proves *when* to ask. It would stay green
 * against an app that ignored the answer entirely — which is the exact failure
 * this repo has recorded before: eleven green tests in `security.test.ts`
 * asserting protection the exported middleware did not have.
 *
 * The property here is a wiring one — which module calls what, and in what
 * order — so it is a source scan. React Native cannot be rendered by this
 * runner, and the one thing that matters most (that iOS's dialog is not raised
 * uninvited) is not observable at runtime on any machine we have.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const NAVIGATOR = 'apps/mobile/src/navigation/RootNavigator.tsx';
const GARAGE = 'apps/mobile/src/screens/GarageScreen.tsx';
const PRIMER = 'apps/mobile/src/notifications/PushPrimer.tsx';

/** Source with comments removed — prose about a rule is not the rule. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

describe('the permission prompt is no longer raised uninvited', () => {
  it('the navigator does not call registerForPush unconditionally', () => {
    /*
      The defect C5 exists to fix. `registerForPush` asks iOS for permission as
      its first act, so calling it on entry to the signed-in stack spends the
      one irreversible ask before the person has seen the product.

      Asserted as: any call must sit behind `shouldRegisterSilently`.
    */
    const source = code(NAVIGATOR);

    if (source.includes('registerForPush(')) {
      expect(source).toContain('shouldRegisterSilently');
      const gate = source.indexOf('shouldRegisterSilently');
      const call = source.indexOf('registerForPush(');
      expect(gate).toBeLessThan(call);
    }
  });

  it('a device that already granted permission still registers', () => {
    /*
      The upgrade path, and the regression a careless fix would introduce:
      removing the call entirely would leave every existing user's token
      unfiled, and notifications would stop for exactly the people who had
      already said yes.
    */
    expect(code(NAVIGATOR)).toContain('shouldRegisterSilently');
    expect(code(NAVIGATOR)).toContain('registerForPush');
  });

  it('the garage decides with the shared rule rather than its own', () => {
    const source = code(GARAGE);

    expect(source).toContain('shouldShowPushPrimer');
    expect(source).toContain('@crewchief/core/push-priming');
    // The vehicle count is why this lives in the garage at all.
    expect(source).toMatch(/vehicleCount/);
  });

  it('accepting the primer is what raises the system prompt', () => {
    /*
      The whole mechanism in one assertion. If `registerForPush` were called
      from anywhere in the garage other than the accept path, the primer would
      be decoration in front of a dialog that fires regardless.
    */
    const source = code(GARAGE);
    expect(source).toContain('registerForPush');

    const accept = source.indexOf('acceptPrimer');
    const call = source.indexOf('registerForPush(');
    expect(accept).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(accept);
  });

  it('declining records a date, so the cooldown can expire', () => {
    /*
      A boolean would make the first "not now" permanent, and somebody who was
      busy once would never be asked again — leaving the system ask unspent
      forever, which is a worse outcome than having no primer.
    */
    const source = code(GARAGE);
    expect(source).toContain('recordPrimerDismissed');
    expect(source).toMatch(/recordPrimerDismissed\(\s*new Date\(\)/);
  });

  it('the primer writes none of its own copy', () => {
    /*
      Every string comes from `PUSH_PRIMER_COPY`, which is marked as David's to
      replace in Phase 5.5. A hard-coded sentence here would be a second place
      the wording lives, and the reviewed screen would drift from the shared
      one silently.
    */
    const source = code(PRIMER);
    expect(source).toContain('PUSH_PRIMER_COPY');

    /*
      Checked as "every rendered <Text> is an expression, not prose".

      ⚠ The first version of this scanned for long string literals anywhere in
      the file, and it matched almost the entire component — a regex counting
      `'` cannot tell an import path from a colour from a JSX attribute
      delimited with `"`, so one quote in an import opened a match that a quote
      in a StyleSheet closed. It reported the styles as copy.

      The property that actually matters is narrower and exactly expressible:
      nothing the user reads is written here.
    */
    // `exec` in a loop rather than spreading `matchAll` — this project's
    // tsconfig target predates downlevel iteration of a RegExp iterator, and
    // the spread compiles under SWC but fails `tsc` (TS2802).
    const rendered: string[] = [];
    const pattern = /<Text[^>]*>([\s\S]*?)<\/Text>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      rendered.push(match[1].trim());
    }

    expect(rendered.length).toBeGreaterThan(0);
    for (const body of rendered) {
      expect(body).toMatch(/^\{[\s\S]*\}$/);
      expect(body).toContain('PUSH_PRIMER_COPY');
    }
  });

  it('the primer offers a real way out', () => {
    // A modal with no decline path is a trap, and a trap gets answered at the
    // system level — permanently.
    const source = code(PRIMER);
    expect(source).toContain('onDecline');
    expect(source).toContain('onRequestClose');
  });
});
