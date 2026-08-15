/**
 * `$rules.radiusScale` — no raw corner radius in `apps/mobile`.
 *
 * @jest-environment node
 *
 * ── Why this exists, and why it is radius and not all geometry ──────────────
 *
 * The token layer says it plainly: **"9, 10 and 16 do not exist."** On 15 August
 * `borderRadius: 10` appeared at **nine** sites and `16` at one, alongside
 * twenty-eight more written as bare `12`, `14` and `20` — on-scale by luck
 * rather than by reference.
 *
 * That is the same failure `mobile-color-literals.test.ts` was written for, one
 * property along, and §0.16's argument applies unchanged: *a token layer nothing
 * is obliged to use is documentation, not a system.* Step 1 removed 232 colour
 * literals and left the geometry alone, so radius went on drifting quietly —
 * every screen a slightly different card.
 *
 * ⚠ **Radius only, deliberately.** The same scan finds ~60 off-scale paddings
 * and gaps, and most of them are not defects: a 2pt gap between a title and its
 * subtitle is an optical hairline, not a spacing step, and a rule that flagged
 * it would be trained around within a week. Radius is a **closed set** the theme
 * enumerates, which makes the rule decidable. The spacing scale wants its own
 * pass with a designer's eye, not a regex.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { radius } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/**
 * `theme/` is the layer itself — the whole point is that the values live in one
 * place.
 */
const ALLOWED = [join('src', 'theme')];

/**
 * ── The ratchet, and its one entry ──────────────────────────────────────────
 *
 * `AddVehicleScreen.tsx` carries four on-scale-by-luck radii and is **being
 * edited by another session right now** — the one diagnosing the null-tree
 * pollution in `contrast.test.tsx`. Two sessions share one working tree here,
 * so editing it concurrently is not a merge, it is a race.
 *
 * ⚠ **This list may only ever shrink.** A file left here after it is fixed
 * fails the suite too, so it cannot quietly become the place violations go.
 */
const PENDING = ['AddVehicleScreen.tsx'];

function sourceFiles(dir: string, acc: { rel: string; code: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, acc);
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      acc.push({ rel: full.slice(full.indexOf(join('apps', 'mobile'))), code: readFileSync(full, 'utf8') });
    }
  }
  return acc;
}

/** Comments name the forbidden values constantly; they must not trip the rule. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const RAW_RADIUS = /border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius:\s*\d/;

describe('the mobile app names no corner radius outside the token layer', () => {
  const files = sourceFiles(MOBILE_SRC)
    .filter((f) => !ALLOWED.some((a) => f.rel.includes(a)))
    .map((f) => ({ ...f, code: stripComments(f.code) }));

  it('has sources to scan', () => {
    // A broken walk makes the assertion below pass vacuously — the failure mode
    // Phase 0's ratchet shipped with, and the one §0.16 records catching twice.
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no raw radius', () => {
    const offenders = files
      .filter((f) => RAW_RADIUS.test(f.code))
      .filter((f) => !PENDING.some((p) => f.rel.endsWith(p)))
      .map((f) => {
        const line = f.code.split('\n').find((l) => RAW_RADIUS.test(l))?.trim().slice(0, 80);
        return `${f.rel} — ${line}`;
      });

    expect(offenders).toEqual([]);
  });

  it('keeps the pending list honest — nothing already fixed is left on it', () => {
    /*
      The half that makes a ratchet a ratchet. Without this, an entry outlives
      its reason and the list becomes a permanent exemption nobody rereads.
    */
    const stale = PENDING.filter((pending) => {
      const file = files.find((f) => f.rel.endsWith(pending));
      return file !== undefined && !RAW_RADIUS.test(file.code);
    });

    expect(stale).toEqual([]);
  });

  it('has somewhere for those radii to have gone', () => {
    /*
      The other half of the rule, and the half a file-scanner cannot state: an
      app with no radius literals and no token layer is not compliant, it is
      broken. This imports the layer they moved *into*, so the suite exercises
      shipped code rather than only reading it.
    */
    expect(radius.well).toBe(8);
    expect(radius.button).toBe(12);
    expect(radius.card).toBe(14);
    expect(radius.hero).toBe(20);
  });

  it('still names the three the theme says do not exist', () => {
    // The comment in `theme/index.ts` is load-bearing documentation. If one of
    // these is ever adopted, this test is where the decision gets recorded.
    for (const forbidden of [9, 10, 16]) {
      expect(Object.values(radius)).not.toContain(forbidden);
    }
  });

  it('can still detect one, so this is not vacuous', () => {
    // Guards the guard. A regex that stopped matching would report a clean app
    // forever, which is indistinguishable from success.
    expect(RAW_RADIUS.test('borderRadius: 10,')).toBe(true);
    expect(RAW_RADIUS.test('borderTopLeftRadius: 20,')).toBe(true);
    expect(RAW_RADIUS.test('borderRadius: radius.card,')).toBe(false);
  });
});
