/**
 * Every motion the CSS blanket rule cannot reach asks for itself.
 *
 * @jest-environment node
 *
 * `docs/roadmap.md` item 17 asks for `prefers-reduced-motion` coverage across
 * the door intro, the scan line and the ignition sweep "as one audited list
 * rather than per-feature memory". A list read once is per-feature memory with
 * extra steps, so it is a test.
 *
 * The audit that produced it found two gaps nobody had reported:
 *
 *   - `TCOCard` drew its ring over 1200ms through a `requestAnimationFrame`
 *     loop with no check at all. CSS cannot see rAF, so the blanket rule in
 *     globals.css never applied to it.
 *   - `ConsultantChat` scrolled with `behavior: 'smooth'`, which is specified
 *     to override the `scroll-behavior` property — the one case where the
 *     blanket rule looks like it has motion covered and does not.
 *
 * Both are fixed. This stops the next one.
 *
 * What is deliberately *not* asserted: CSS animations and transitions. Those
 * are genuinely covered by the blanket rule, and requiring every one of them
 * to name the media query would be noise that teaches people to silence the
 * test.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['components', 'hooks', 'app'];

/** The shared helper. Referencing it counts as asking. */
const ASKS = /prefersReducedMotion|scrollBehavior\(\)|prefers-reduced-motion/;

/** Motion CSS cannot neutralise. */
const RAF = /requestAnimationFrame\s*\(/;
const SMOOTH = /behavior:\s*['"]smooth['"]/;

/**
 * `use-reduced-motion.ts` defines the helper, so it names the media query
 * without importing anything — it is the answer, not a caller.
 */
const EXEMPT = new Set(['hooks/use-reduced-motion.ts']);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = SCANNED.flatMap((d) => sourceFiles(join(ROOT, d)));

describe('reduced motion is asked for wherever CSS cannot answer', () => {
  it('found files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every requestAnimationFrame loop checks the preference', () => {
    const offenders = files
      .filter((f) => {
        const rel = f.replace(ROOT + '/', '');
        if (EXEMPT.has(rel)) return false;
        const src = readFileSync(f, 'utf8');
        return RAF.test(src) && !ASKS.test(src);
      })
      .map((f) => f.replace(ROOT + '/', ''));

    expect(offenders).toEqual([]);
  });

  it("every scrollTo({ behavior: 'smooth' }) checks the preference", () => {
    const offenders = files
      .filter((f) => {
        const rel = f.replace(ROOT + '/', '');
        if (EXEMPT.has(rel)) return false;
        const src = readFileSync(f, 'utf8');
        return SMOOTH.test(src) && !ASKS.test(src);
      })
      .map((f) => f.replace(ROOT + '/', ''));

    expect(offenders).toEqual([]);
  });

  it('the blanket rule still covers CSS animation, transition and scrolling', () => {
    const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(block).toContain('animation-duration');
    expect(block).toContain('transition-duration');
    expect(block).toContain('scroll-behavior');
  });
});
