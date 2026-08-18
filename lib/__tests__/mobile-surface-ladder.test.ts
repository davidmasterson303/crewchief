/**
 * `$rules.surfaceLadder` — a card is `Card`, on the ladder's card step.
 *
 * @jest-environment node
 *
 * ── The drift this closes ───────────────────────────────────────────────────
 *
 * On 15 August four screens — recalls, service history, the service milestone
 * and the wishlist — each carried a **private copy** of the card: a style
 * literally named `card`, painted on `surface.raised`, with no border. The
 * `Card` primitive is `surface.card` with `border.panel`.
 *
 * `raised` is the ladder's step for **bars, tab strips and chips**. A card
 * painted on it sits one step off from every other card in the app, so the same
 * object rendered differently depending on which screen you were on — which is
 * exactly the "twelve slightly different containers" `Card` was written to end,
 * surviving inside the very screens that were supposed to adopt it.
 *
 * ── Why the rule is this narrow ─────────────────────────────────────────────
 *
 * "Card-shaped containers must use the primitive" is the rule people mean and
 * it is not decidable from source — a `View` with a background and a radius
 * might legitimately be a chip, a sheet or a banner.
 *
 * What *is* decidable is the contradiction: a container carrying the **card
 * radius** on the **bar surface** is on two different steps at once, and there
 * is no reading of the token layer where that is intended. That is the shape
 * all four violations had, and it is the one this asserts.
 *
 * Same discipline as `mobile-radius-scale.test.ts`: a rule narrow enough to be
 * decidable, rather than a broad one people learn to route around.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { surface, radius } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

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

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** One `name: { ... }` style block, non-nested — which is every style here. */
const STYLE_BLOCK = /(\w+):\s*\{[^{}]*\}/g;

/**
 * A block claiming the card radius and the bar surface at once.
 *
 * `exec` in a loop rather than `matchAll`: this repo's web `tsconfig` targets
 * below ES2015 iteration, and `matchAll` needs `--downlevelIteration` there.
 * A fresh `RegExp` per call because `STYLE_BLOCK` is global and therefore
 * stateful — a shared `lastIndex` would make the second call on the same
 * string skip the start of it.
 */
function contradictions(code: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(STYLE_BLOCK.source, 'g');

  let match: RegExpExecArray | null = pattern.exec(code);
  while (match !== null) {
    const block = match[0];
    if (block.includes('radius.card') && block.includes('surface.raised')) {
      found.push(match[1]);
    }
    match = pattern.exec(code);
  }

  return found;
}

describe('a card sits on the card step, not the bar step', () => {
  const files = sourceFiles(MOBILE_SRC)
    .filter((f) => !f.rel.includes(join('src', 'theme')))
    .map((f) => ({ ...f, code: stripComments(f.code) }));

  it('has sources to scan', () => {
    // A broken walk makes the assertion below pass vacuously — the failure mode
    // §0.16 records catching twice, both times with a guard rather than a test.
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no container on two ladder steps at once', () => {
    const offenders = files.flatMap((f) =>
      contradictions(f.code).map((name) => `${f.rel} — ${name}`)
    );

    expect(offenders).toEqual([]);
  });

  it('keeps the two steps genuinely different, so the rule means something', () => {
    /*
      If `raised` and `card` ever collapsed to the same value the rule above
      would still pass while describing nothing — and the ladder would have
      quietly lost a step, which is the thing that made twelve screens read as
      one flat surface in the first place.
    */
    expect(surface.raised).not.toBe(surface.card);
    expect(radius.card).toBe(14);
  });

  it('can still detect one, so this is not vacuous', () => {
    // Guards the guard, with the exact shape all four violations had.
    expect(
      contradictions('card: { backgroundColor: surface.raised, borderRadius: radius.card }')
    ).toEqual(['card']);

    // And does not fire on the legitimate neighbours.
    expect(
      contradictions('chip: { backgroundColor: surface.raised, borderRadius: radius.pill }')
    ).toEqual([]);
    expect(
      contradictions('panel: { backgroundColor: surface.card, borderRadius: radius.card }')
    ).toEqual([]);
  });
});
