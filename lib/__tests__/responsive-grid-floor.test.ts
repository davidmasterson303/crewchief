/**
 * A grid of three or more columns has to say what it does on a phone.
 *
 * @jest-environment node
 *
 * R3, from the 2 Aug responsive audit: `app/vehicle-info/[vehicleId]/page.tsx`
 * ran a bare `grid grid-cols-3` with no breakpoint. From the 231px a card gets
 * at 375px, each column is 66px — of which a 32px icon, a 12px gap and 32px of
 * tile padding are already spent. **The text column resolved to roughly zero
 * and "8-speed automatic" wrapped one character per line.**
 *
 * That was fixed. Nothing stopped the next one, and three more had appeared by
 * 8 Aug.
 *
 * ── Why three and not two ───────────────────────────────────────────────────
 *
 * Two columns at 375px leaves ~160px a cell, which is tight but survivable and
 * is often deliberate — a pair of stat tiles reads better side by side than
 * stacked. Three is where the arithmetic stops working: the same width divided
 * again, minus the same fixed padding, is what produced R3.
 *
 * So this pins the case that actually broke rather than every multi-column grid
 * in the app. Thirteen unbreakpointed grids exist; three of them had 3+ columns
 * and all three were the R3 shape — text cells with padding.
 *
 * ── Why source and not a rendered probe ─────────────────────────────────────
 *
 * Same reasoning as `text-contrast-floor.test.ts`. A rendered check needs a
 * browser, only sees routes someone remembered to visit, and cannot reach a
 * state that needs data — R3's own page is behind auth. The class string is
 * deterministic and it is the whole signal.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const ROOTS = ['app', 'components'];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next') return [];
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * A class string carrying `grid-cols-3` or higher.
 *
 * Built fresh per file rather than shared: a `g` regex carries `lastIndex`
 * between calls, so one module-scope instance would resume mid-way through the
 * next file and skip whatever sat before that offset.
 */
const unbreakpointed = () => /class(?:Name)?="([^"]*\bgrid-cols-[3-9]\b[^"]*)"/g;
const HAS_BREAKPOINT = /\b(sm|md|lg|xl|2xl):/;

/**
 * Grids that are deliberately three-up on a phone, with the argument.
 *
 * ── ⚠ The rule invites this, and asks for the reasoning to live here ────────
 *
 * "If a fixed three-up is genuinely right for some future case — three icons
 * with no text, say — this is the place to argue it, and the argument should be
 * written here rather than the rule quietly loosened." So:
 *
 * **`vehicle-info` performance readings.** Three cells holding a numeral, its
 * unit and a one-word label. Nothing else — no icon, no tile, no border, no
 * body copy, which is what separates it from R3: that grid put a 32px icon, a
 * 12px gap and 32px of padding into a 66px cell and left the text column at
 * roughly zero, so "8-speed automatic" wrapped one character per line.
 *
 * Measured at 390px on the rendered page: cells are **96px**, content boxes
 * **80px**, and every child fits inside without overflow —
 * `scrollWidth === clientWidth` on all six elements. That check is what caught
 * "Horsepower" at 97px, which is why the label reads "Power".
 *
 * ⚠ The exemption is the class string, not the file. A different three-up grid
 * appearing in the same page is still a failure, which is the point — R3's own
 * page is exactly where this keeps happening.
 */
const DELIBERATE_THREE_UP = [
  'grid grid-cols-3 divide-x divide-white/8 rounded-xl border border-white/10 bg-white/[0.02]',
];

const offenders = ROOTS.flatMap((root) => tsxFiles(join(ROOT, root))).flatMap((path) => {
  const source = readFileSync(path, 'utf8');
  const found: string[] = [];
  const pattern = unbreakpointed();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (!HAS_BREAKPOINT.test(match[1]) && !DELIBERATE_THREE_UP.includes(match[1])) {
      found.push(`${path.slice(ROOT.length + 1)} — "${match[1]}"`);
    }
  }

  return found;
});

describe('three-column grids declare a phone layout', () => {
  it('has files to check, so this cannot pass vacuously', () => {
    // Guards the guard. A walk that silently found nothing would make the
    // assertion below trivially true — the failure mode this repo keeps
    // re-learning.
    expect(ROOTS.flatMap((root) => tsxFiles(join(ROOT, root))).length).toBeGreaterThan(50);
  });

  it('can still catch one, so the exemption list is not a hole', () => {
    /*
      §5: every scanner here carries a case proving it can still fail. The
      exemption matches an exact class string, so a grid that merely resembles
      the sanctioned one is still reported — which is what stops the list from
      becoming "this page is allowed three columns".
    */
    const pattern = unbreakpointed();
    const planted = 'x <div className="grid grid-cols-3 gap-4 p-5">y</div>';
    const match = pattern.exec(planted);

    expect(match).not.toBeNull();
    expect(DELIBERATE_THREE_UP.includes(match![1])).toBe(false);
  });

  it('finds none without a breakpoint', () => {
    /*
      To fix one: `grid-cols-1 sm:grid-cols-3` is what R3 itself used, and what
      the three found on 8 Aug took. Stacking to one below `sm` rather than two
      avoids leaving an orphan cell on a row of three.

      If a fixed three-up is genuinely right for some future case — three icons
      with no text, say — this is the place to argue it, and the argument should
      be written here rather than the rule quietly loosened.
    */
    expect(offenders).toEqual([]);
  });
});
