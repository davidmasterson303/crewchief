/**
 * One score, one judgement, on every client.
 *
 * @jest-environment node
 *
 * The banding thresholds moved into `@wellkept/core/health-band` so the Expo
 * garage (Phase 3.2) reads the same ramp as the web dashboard. That move is
 * only worth anything if the web layer stays a *presentation* of the shared
 * judgement rather than quietly reintroducing its own.
 *
 * This is the bug that already happened once, at smaller scale: `DiagnosticHero`
 * and `HealthSummary` banded independently and DiagnosticHero missed the ≥40
 * boundary entirely, so one dashboard styled the same score two ways. At two
 * clients the same drift would be invisible — it takes a phone and a laptop
 * side by side to notice.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getHealthBandJudgement,
  healthBandHex,
  type HealthBandName,
} from '@wellkept/core/health-band';
import { getHealthBand } from '@/hooks/use-health-band';

const ROOT = join(__dirname, '..', '..');

/**
 * Source with comments stripped.
 *
 * The negative assertions below look for a banned *construct*, and both files
 * involved describe that construct in prose to explain why it is banned. The
 * first version of this test failed for that reason — `use-health-band.ts`
 * documents the `text-health-${name}` trap, and matching the raw file found the
 * explanation and called it the bug.
 *
 * Same shape as `provenance-claims.test.ts`, which strips comments for exactly
 * this reason. A guard that fires on its own documentation trains people to
 * delete the documentation.
 */
function code(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the shared judgement', () => {
  /*
    Boundaries stated as data. The ramp is `score >= min`, so the interesting
    values are each threshold and the integer below it — which is exactly where
    the DiagnosticHero bug lived.
  */
  const CASES: ReadonlyArray<[number, HealthBandName, string]> = [
    [100, 'good', 'Good'],
    [80, 'good', 'Good'],
    [79, 'ok', 'Fair'],
    [60, 'ok', 'Fair'],
    [59, 'warn', 'Needs attention'],
    [40, 'warn', 'Needs attention'],
    [39, 'bad', 'Critical'],
    [0, 'bad', 'Critical'],
  ];

  it.each(CASES)('scores %i as %s / "%s"', (score, name, label) => {
    const band = getHealthBandJudgement(score);
    expect(band.name).toBe(name);
    expect(band.label).toBe(label);
  });

  it('never returns undefined, including for scores off both ends', () => {
    // The `?? BANDS[last]` fallback. A negative score is not expected from the
    // database, but a band of `undefined` would throw inside a render.
    for (const score of [-1, -Infinity, 101, Number.NaN]) {
      expect(getHealthBandJudgement(score)).toBeDefined();
      expect(typeof getHealthBandJudgement(score).name).toBe('string');
    }
  });

  it('bands NaN as the worst rather than the best', () => {
    /*
      `NaN >= 80` is false and so is every other comparison, so the `.find()`
      misses entirely and the fallback decides. Worth pinning: a missing health
      score reading as "Good" is the overstatement this ramp's wording was
      rewritten to avoid.
    */
    expect(getHealthBandJudgement(Number.NaN).name).toBe('bad');
  });
});

describe('the web layer', () => {
  it('reports the same judgement as core, at every boundary', () => {
    for (let score = -5; score <= 105; score++) {
      const core = getHealthBandJudgement(score);
      const web = getHealthBand(score);
      expect(web.name).toBe(core.name);
      expect(web.label).toBe(core.label);
      expect(web.short).toBe(core.short);
      expect(web.rgb).toBe(core.rgb);
    }
  });

  it('adds styling for every band, so none can render unstyled', () => {
    for (const score of [100, 70, 50, 10]) {
      const band = getHealthBand(score);
      expect(band.color).toMatch(/^var\(--ring-/);
      expect(band.textClass).toMatch(/^text-health-/);
    }
  });

  it('spells the Tailwind classes out as literals', () => {
    /*
      Tailwind only generates classes it can see as literal strings. These were
      once built as `text-health-${band.name}`, so three of the four were never
      generated and the label fell back to inherited foreground — HealthSummary
      printed "Fair" in plain white beside a correctly coloured ring.

      Asserted against the source rather than the return value, because a
      template string returns a perfectly correct-looking value at runtime and
      still produces no CSS. That is the whole failure mode.
    */
    const source = code(join('hooks', 'use-health-band.ts'));
    for (const literal of [
      'text-health-good',
      'text-health-ok',
      'text-health-warn',
      'text-health-bad',
    ]) {
      expect(source).toContain(literal);
    }
    expect(source).not.toMatch(/text-health-\$\{/);
  });

  it('does not redefine the thresholds it was refactored to stop owning', () => {
    // The regression this whole split exists to prevent: a local BANDS array
    // reappearing beside the shared one.
    const source = code(join('hooks', 'use-health-band.ts'));
    expect(source).toContain('@wellkept/core/health-band');
    expect(source).not.toMatch(/min:\s*80/);
  });
});

describe('healthBandHex', () => {
  it('converts each band to six-digit hex for React Native', () => {
    // RN's StyleSheet has no rgba() string form, so the Expo garage needs this.
    expect(healthBandHex(getHealthBandJudgement(100))).toBe('#7fce9c');
    /*
      ⚠ `#b9c77e`, moved off cyan on 3 Sep. The old value was a desaturated
      cyan and cyan is the product's accent, so "Fair" wore the same hue as
      every link and the active tab. See `--ring-ok` in `app/globals.css` for
      the argument; this assertion exists so the web token and the value React
      Native reads cannot drift apart.
    */
    expect(healthBandHex(getHealthBandJudgement(70))).toBe('#b9c77e');
    expect(healthBandHex(getHealthBandJudgement(50))).toBe('#e0a468');
    expect(healthBandHex(getHealthBandJudgement(10))).toBe('#e08882');
  });

  it('pads single-digit channels', () => {
    // A channel below 16 produces one hex digit and silently shifts every
    // channel after it, turning a colour into a different colour.
    expect(healthBandHex({ name: 'good', rgb: '1,2,3', label: 'x', short: 'x' })).toBe('#010203');
  });
});
