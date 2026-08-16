/**
 * `$rules.pressedStates` — a pressed style must change something.
 *
 * @jest-environment node
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * `ListRow` — the primitive behind every tappable row in the app — carried
 * `pressed: { opacity: 1 }`. That changes **nothing**. Worse than having no
 * pressed state at all: the branch exists, so it reads as handled and nobody
 * re-opens it, while every row in the product acknowledged a tap with silence.
 *
 * Almost certainly residue from taking group opacity off this app's controls:
 * `0.7` became `1` rather than the branch being replaced.
 *
 * ── Why this is a source scan and not a render test ─────────────────────────
 *
 * ⚠ It was tried as a render test first and cannot be written that way here.
 * React Native's `Pressable` drives its pressed state through `usePressability`
 * and the responder system, not a prop this runner can fire at — both a
 * `props.style` read and a `fireEvent(node, 'pressIn')` return the style
 * resolved for `pressed: false`. The rendered tree only ever shows the resting
 * state.
 *
 * So this is the weaker check that is actually available, and the trade is
 * stated rather than hidden. `primitives.test.tsx` keeps what a render *can*
 * assert — that the role appears only when the row is tappable.
 *
 * ── The two shapes it refuses ───────────────────────────────────────────────
 *
 *   - `opacity: 1` — a no-op wearing the clothes of feedback.
 *   - any `opacity` at all — a fade composites the **label** as well as the
 *     fill, which is how this app put a near-black "Ask" at 1.61:1. Pressed is
 *     a fill swap. `Button` states the rule and every variant follows it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { surface } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

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

/** A style whose name marks it as the pressed variant. */
const PRESSED_STYLE = /(\w*[Pp]ressed)\s*:\s*\{([^{}]*)\}/g;

function offendingPressedStyles(code: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(PRESSED_STYLE.source, 'g');

  let match: RegExpExecArray | null = pattern.exec(code);
  while (match !== null) {
    const [, name, body] = match;
    const declarations = body.trim();

    if (declarations.length === 0) {
      found.push(`${name} — empty`);
    } else if (/opacity\s*:\s*1\b/.test(declarations)) {
      found.push(`${name} — opacity: 1 changes nothing`);
    } else if (/opacity\s*:/.test(declarations)) {
      found.push(`${name} — fades the label; pressed is a fill swap`);
    }

    match = pattern.exec(code);
  }

  return found;
}

describe('a pressed style changes something, and never by fading', () => {
  const files = sourceFiles(MOBILE_SRC).map((f) => ({ ...f, code: stripComments(f.code) }));

  it('has sources to scan', () => {
    // A broken walk makes the assertion below pass vacuously — the failure mode
    // this repo has now caught three times, each time with a guard.
    expect(files.length).toBeGreaterThan(10);
  });

  it('finds pressed styles at all, so the pattern still matches the codebase', () => {
    /*
      Sharper than "has sources". If `Button`'s variants were ever renamed the
      regex would match nothing and this suite would report a clean app forever
      — indistinguishable from success.
    */
    const withPressed = files.filter((f) => /[Pp]ressed\s*:\s*\{/.test(f.code));

    expect(withPressed.length).toBeGreaterThan(1);
  });

  it('has no pressed style that does nothing or fades', () => {
    const offenders = files.flatMap((f) =>
      offendingPressedStyles(f.code).map((issue) => `${f.rel} — ${issue}`)
    );

    expect(offenders).toEqual([]);
  });

  it('has a fill for the feedback to be made of', () => {
    /*
      The other half of the rule, and the half a scanner cannot state: an app
      with no offending pressed styles and no distinct surface to press *to* is
      not compliant, it is invisible. This exercises the layer the feedback is
      built from rather than only reading source.

      `raised` is what `ListRow` and `Button`'s `ghost` press to. If it ever
      collapsed into the surfaces it sits on — the card above it or the page
      below — a press would change the declaration and nothing on screen.
    */
    expect(surface.raised).not.toBe(surface.card);
    expect(surface.raised).not.toBe(surface.page);
    expect(surface.well).not.toBe(surface.raised);
  });

  it('can still detect one, so this is not vacuous', () => {
    // The exact shape `ListRow` carried.
    expect(offendingPressedStyles('pressed: { opacity: 1 },')).toEqual([
      'pressed — opacity: 1 changes nothing',
    ]);

    expect(offendingPressedStyles('acceptPressed: { opacity: 0.9 },')).toEqual([
      'acceptPressed — fades the label; pressed is a fill swap',
    ]);

    // And clears a real one.
    expect(offendingPressedStyles('primaryPressed: { backgroundColor: brand.primaryPressed },'))
      .toEqual([]);
  });
});
