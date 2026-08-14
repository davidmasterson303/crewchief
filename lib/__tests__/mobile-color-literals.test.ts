/**
 * `$rules.colorLiterals` — no colour literal in `apps/mobile`.
 *
 * @jest-environment node
 *
 * The handoff states it as the first rule of the design baseline, and it is
 * first because nothing downstream can be reviewed without it: twelve screens
 * carried **232** literals between them, so every screen was a slightly
 * different product and no judgement about "the app" was possible.
 *
 * ── Why a lint rather than a convention ─────────────────────────────────────
 *
 * Because the convention already existed and lost. `theme/tokens.json` has been
 * in this repo since 8 Aug holding six values, and exactly one component ever
 * read it while the screens went on hardcoding. A token layer nothing is
 * obliged to use is documentation, not a system.
 *
 * ── What counts ─────────────────────────────────────────────────────────────
 *
 * Hex literals and `rgb()`/`rgba()` strings in `.tsx` under `apps/mobile/src`.
 * The rule explicitly covers **computed and conditional** colours, which is why
 * this scans source text rather than inspecting StyleSheet objects: a ternary
 * picking between two hexes is the case a runtime check would miss and the case
 * most likely to hide a sub-floor value in a state nothing renders in a test.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { surface, text, brand } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/**
 * The two files allowed to name a colour.
 *
 * `theme/` is the token layer itself — the whole point is that the values live
 * in one place. `test-support/contrast.ts` hardcodes the backdrop deliberately:
 * a harness that imported the value it checks would agree with any drift, and
 * `theme/__tests__/theme-backdrop.test.tsx` is what keeps the two equal.
 */
const ALLOWED = [join('src', 'theme'), join('src', 'test-support')];

function sourceFiles(dir: string, acc: { rel: string; code: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, acc);
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      acc.push({ rel: full.slice(full.indexOf(join('apps', 'mobile')) ), code: readFileSync(full, 'utf8') });
    }
  }
  return acc;
}

/** Comments describe the rule constantly; they must not trip it. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(\s*\d/;

describe('the mobile app names no colour outside the token layer', () => {
  const files = sourceFiles(MOBILE_SRC)
    .filter((f) => !ALLOWED.some((a) => f.rel.includes(a)))
    .map((f) => ({ ...f, code: stripComments(f.code) }));

  it('has sources to scan', () => {
    // A broken walk would make the assertion below pass vacuously — the exact
    // failure mode Phase 0's ratchet shipped with.
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no colour literal', () => {
    const offenders = files
      .filter((f) => COLOUR.test(f.code))
      .map((f) => {
        const line = f.code.split('\n').find((l) => COLOUR.test(l))?.trim().slice(0, 80);
        return `${f.rel} — ${line}`;
      });

    expect(offenders).toEqual([]);
  });

  it('has somewhere for those colours to have gone', () => {
    /*
      The other half of the rule, and the half a file-scanner cannot state: an
      app with no colour literals and no token layer is not compliant, it is
      broken. This imports the layer the literals moved *into*, so the suite
      exercises shipped code rather than only reading it — and it fails if the
      theme is ever emptied to make the scan above pass.
    */
    expect(surface.page).toMatch(/^#[0-9A-F]{6}$/i);
    expect(text.primary).toMatch(/^#[0-9A-F]{6}$/i);
    expect(brand.primary).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('can still detect one, so this is not vacuous', () => {
    // Guards the guard. A regex that stopped matching would report a clean app
    // forever, which is indistinguishable from success.
    expect(COLOUR.test("backgroundColor: '#101010'")).toBe(true);
    expect(COLOUR.test("color: 'rgba(255,255,255,0.5)'")).toBe(true);
    expect(COLOUR.test('color: text.muted')).toBe(false);
  });
});
