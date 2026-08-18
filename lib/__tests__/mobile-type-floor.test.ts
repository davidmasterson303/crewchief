/**
 * `$rules.typeFloor` — nothing in the product renders below 12pt.
 *
 * @jest-environment node
 *
 * ── One of the four floors, and the one nothing was checking ────────────────
 *
 * The theme names four lintable floors: a 44pt target, a 16px field on touch,
 * **12px type**, and 50% text. Three of them had teeth. `TYPE_MIN` was asserted
 * against the `label` token and against `Chip`, and **nothing scanned a screen**
 * — so the floor held exactly where someone had already thought about it.
 *
 * It drifted, repeatedly and independently:
 *
 *   - the advisor's provenance chips at 11 (§0.16 records finding these)
 *   - the garage card's band label at 11
 *   - vehicle detail's band label at 11
 *   - vehicle detail's `cardLabel` at 11
 *
 * Four sites, four authors, one rule nobody could break loudly. The first three
 * are gone; the fourth was dead style and went with this test.
 *
 * ── ⚠ Why this is not simply "no fontSize under 12" ────────────────────────
 *
 * Two styles are genuinely below the floor and genuinely fine, because they
 * only ever render in a **development build**: the access-token block and the
 * sign-in diagnostics. A dev build is not the product, and treating its
 * artefacts as shippable defects is a mistake this project has made in the
 * other direction — reading `__DEV__` UI as something to fix.
 *
 * They are listed rather than pattern-matched on their names. A `dev` prefix
 * would be a rule anyone could satisfy by renaming, which is not a rule.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { TYPE_MIN } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/**
 * Styles that render only under `__DEV__`.
 *
 * ⚠ Each entry is a promise that the style is unreachable in a release build.
 * Adding one to silence a failure on real product UI is the abuse this list is
 * most exposed to — there is no automatic check that a name here is genuinely
 * dev-gated, so it is on the reader.
 */
const DEV_ONLY = [
  // The JWT block on the garage. Monospaced and small because a token has to
  // select as one run rather than reflow into something that copies back broken.
  'devToken',
  // The sign-in screen's environment diagnostics.
  'devCheckDetail',
];

function sourceFiles(dir: string, acc: { rel: string; code: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, acc);
    } else if (entry.endsWith('.tsx')) {
      acc.push({ rel: full.slice(full.indexOf(join('apps', 'mobile'))), code: readFileSync(full, 'utf8') });
    }
  }
  return acc;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * `name: { ... fontSize: N ... }` — the style's own name and its size.
 *
 * Instrument readings are deliberately off the type scale and *above* it, so a
 * floor rule never has to reason about them: the dial's 30pt numeral and the
 * bay's 28pt wordmark are language-free marks, not copy, and both are far
 * clear of 12.
 */
const SIZED_STYLE = /(\w+)\s*:\s*\{([^{}]*fontSize:\s*(\d+)[^{}]*)\}/g;

function belowFloor(code: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(SIZED_STYLE.source, 'g');

  let match: RegExpExecArray | null = pattern.exec(code);
  while (match !== null) {
    const [, name, , size] = match;

    if (Number(size) < TYPE_MIN && !DEV_ONLY.includes(name)) {
      found.push(`${name} — ${size}pt`);
    }

    match = pattern.exec(code);
  }

  return found;
}

describe('no product text renders below the type floor', () => {
  const files = sourceFiles(MOBILE_SRC).map((f) => ({ ...f, code: stripComments(f.code) }));

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('finds sized styles at all, so the pattern still matches the codebase', () => {
    /*
      Sharper than "has sources", and the check this repo has now been caught
      by three times: a regex that stopped matching would report a clean app
      forever, which is indistinguishable from success.
    */
    const sized = files.filter((f) => /fontSize:\s*\d/.test(f.code));

    expect(sized.length).toBeGreaterThan(5);
  });

  it('has nothing under the floor', () => {
    const offenders = files.flatMap((f) =>
      belowFloor(f.code).map((issue) => `${f.rel} — ${issue}`)
    );

    expect(offenders).toEqual([]);
  });

  it('keeps the dev list honest — every entry still exists and is still small', () => {
    /*
      The half that makes an exemption list a ratchet. Without it an entry
      outlives its style and the list becomes a permanent hole nobody rereads.
    */
    const all = files.map((f) => f.code).join('\n');

    for (const name of DEV_ONLY) {
      expect(all).toContain(`${name}:`);
    }
  });

  it('can still detect one, so this is not vacuous', () => {
    expect(belowFloor('bandLabel: { ...type.label, fontSize: 11 },')).toEqual([
      'bandLabel — 11pt',
    ]);

    // The floor itself passes, and so does an instrument reading above it.
    expect(belowFloor('label: { fontSize: 12 },')).toEqual([]);
    expect(belowFloor('rowReading: { fontSize: 30, fontWeight: "700" },')).toEqual([]);

    // And the dev exemption applies to the listed name only.
    expect(belowFloor('devToken: { fontSize: 10 },')).toEqual([]);
    expect(belowFloor('sneakyToken: { fontSize: 10 },')).toEqual(['sneakyToken — 10pt']);
  });
});
