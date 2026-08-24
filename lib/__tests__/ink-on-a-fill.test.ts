/**
 * Ink is never chosen without knowing what it sits on.
 *
 * @jest-environment node
 *
 * ── ⚠ The hole this fills (UI-01, 24 Aug) ───────────────────────────────────
 *
 * A primary button rendered **white on cyan at 1.81:1** on six controls,
 * despite a claimed 4.5:1 floor and a green guard.
 *
 * `text-contrast-floor.test.ts` is one regex — `text-white\/(\d{1,2})` — so
 * bare `text-white` at full alpha **cannot match it**. It is not "missed", it
 * is unrepresentable. And the scan has no concept of a background at all:
 * white on cyan and white on black are the same input.
 *
 * The good instrument exists — the rendered-tree walker at
 * `apps/mobile/src/test-support/contrast.ts`, which composites correctly — and
 * it is **mobile only**, with `jest.config.js` putting `<rootDir>/apps/` in
 * `testPathIgnorePatterns` so web's `npm test` never runs it. The project's
 * stated constraint ("a source scan and a rendered-pixel suite") is true only
 * if you read it as *one each per platform*.
 *
 * ── What this checks, and why it is not the whole answer ────────────────────
 *
 * A **pairing** rule rather than a ratio: a class list that sets a background
 * from the token palette must not also set its own ink. The tokens come in
 * pairs — `--primary` with `--primary-foreground`, `--accent` with
 * `--accent-foreground` — each measured, and `components/ui/button.tsx` already
 * says the rule out loud: *"a call site that still needs a colour is a bug in
 * the primitive."*
 *
 * ⚠ That is deliberately narrower than measuring ratios from source, and the
 * reason is the guard-hole table in the audit: a scan that tried to compute
 * contrast from Tailwind class names would have to resolve `bg-accent/90`
 * through an HSL custom property, over an unknown parent, at an unknown
 * opacity — and would be confidently wrong. Refusing the *pattern* that
 * produced every one of these defects is checkable and cannot be wrong.
 *
 * The ratios themselves stay where they can be measured honestly: against a
 * rendered tree, which is `contrast.test.tsx` on the phone and is the gap web
 * still has.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SURFACES = ['app', 'components'].map((directory) => join(ROOT, directory));

/**
 * Backgrounds taken from the token palette, which is where the measured pairs
 * live. `bg-white`, `bg-black` and the raw Tailwind palette are out of scope:
 * they have no partner token, so "did you override the partner" is not a
 * question that can be asked about them.
 */
const TOKEN_FILL = /\bbg-(primary|accent|secondary|destructive|muted|card|popover)(?:\/\d{1,3})?\b/;

/** Ink written at a call site, in any variant. `hover:text-white` counts. */
const OWN_INK = /(?:^|\s)(?:[a-z-]+:)*text-(white|black|slate-\d{2,3}|gray-\d{2,3}|zinc-\d{2,3})\b/;

/**
 * Class strings, one per `className="…"`.
 *
 * ⚠ Template literals and `cn(...)` calls are **not** parsed. A class assembled
 * at runtime cannot be read from source, and pretending otherwise is how a
 * scan reports clean on a file it did not understand. `hasClassStrings` below
 * asserts the parser found some, so a formatting change that breaks it fails
 * rather than passing silently.
 */
function classStrings(source: string): string[] {
  const pattern = /className="([^"]*)"/g;
  const found: string[] = [];

  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    found.push(match[1]);
    match = pattern.exec(source);
  }

  return found;
}

function tsxFiles(dir: string, into: Array<{ rel: string; code: string }> = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__') tsxFiles(full, into);
      continue;
    }

    if (entry.name.endsWith('.tsx')) {
      into.push({ rel: full.slice(ROOT.length + 1), code: readFileSync(full, 'utf8') });
    }
  }

  return into;
}

const files = SURFACES.flatMap((dir) => tsxFiles(dir));

describe('a token fill keeps its own ink', () => {
  it('found class strings to read', () => {
    /*
      The anti-vacuous half, and this repo has shipped its absence twice: a
      walker that silently returns nothing reports a clean app forever.
    */
    const strings = files.flatMap((file) => classStrings(file.code));

    expect(files.length).toBeGreaterThan(30);
    expect(strings.length).toBeGreaterThan(200);
  });

  it('never overrides the ink that comes with a fill', () => {
    /*
      ⚠ The six sites that shipped: `bg-accent hover:bg-accent/90 text-white` on
      `ModWishlistButton`, `MaintenanceHistoryDialog`, `IssueFixDialog` and
      `ModificationDetailsCard` (×3), plus `bg-primary hover:bg-accent` on
      settings — which renders "Save changes" at **1.72:1 while the pointer is
      on it**, because the default variant supplies `text-primary-foreground`
      and the hover moved the fill out from under it.
    */
    const offenders = files.flatMap((file) =>
      classStrings(file.code)
        .filter((classes) => TOKEN_FILL.test(classes) && OWN_INK.test(classes))
        .map((classes) => `${file.rel} — ${classes.slice(0, 90)}`)
    );

    expect(offenders).toEqual([]);
  });

  it('never moves the fill on hover out from under the ink', () => {
    /*
      ⚠ The subtler half, and the one `globals.css:203-211` already documents
      and rejects for `--primary`: *"Hover is a live, readable state; nothing
      exempts it."* A resting `bg-primary` with a `hover:bg-accent` changes the
      background and leaves the paired ink behind — so the control is legible
      until somebody points at it.
    */
    const offenders = files.flatMap((file) =>
      classStrings(file.code)
        .filter((classes) => {
          const resting = TOKEN_FILL.exec(classes.replace(/(?:^|\s)[a-z-]+:\S+/g, ''));
          const hovered = /\bhover:bg-(primary|accent|secondary|destructive)\b/.exec(classes);

          return Boolean(resting && hovered && resting[1] !== hovered[1]);
        })
        .map((classes) => `${file.rel} — ${classes.slice(0, 90)}`)
    );

    expect(offenders).toEqual([]);
  });

  it('can still detect both, so this is not vacuous', () => {
    /*
      Rule 5's other half, against the exact strings that shipped. Without it,
      both assertions above pass on any file whose class strings the parser
      failed to find.
    */
    const shipped = 'bg-accent hover:bg-accent/90 text-white whitespace-nowrap';
    const shippedHover = 'bg-primary hover:bg-accent';

    expect(TOKEN_FILL.test(shipped) && OWN_INK.test(shipped)).toBe(true);
    expect(/\bhover:bg-accent\b/.test(shippedHover)).toBe(true);

    // …and the corrected forms must not fire.
    expect(OWN_INK.test('whitespace-nowrap transition-colors')).toBe(false);
    expect(TOKEN_FILL.test('h-7 text-xs hover:border-red-600 hover:text-red-600')).toBe(false);
  });
});
