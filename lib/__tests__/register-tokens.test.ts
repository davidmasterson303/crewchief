/**
 * The sport register overrides only tokens that something actually reads.
 *
 * @jest-environment node
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 *
 * v8 §6 ships a second register — same product, harder delivery — as a block
 * of custom-property overrides. That is an elegant mechanism with one failure
 * mode, and it is silent: **overriding a token nothing reads changes nothing,
 * and looks exactly like working code.** No error, no warning, no failing
 * build. The register just does less than it says.
 *
 * This is not hypothetical. Checked against the tree before it was written,
 * `tokens/register.css` overrode five properties this repo does not define
 * (`--radius-md`, `--radius-lg`, `--radius-full`, `--build-far`,
 * `--font-sans`) and one it defines but never reads (`--radius-xl` at the
 * time). Copied verbatim it would have squared off `rounded-xl` elements and
 * left every other corner at 14px, because Tailwind derives `rounded-lg/md/sm`
 * from `--radius` — which the export never mentions.
 *
 * It is the same shape as the `--bay-heat` finding in §3, and the reason the
 * two prerequisite commits exist. A guard is what stops the third one.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * jsdom does not implement `clip-path`, does not resolve `var()` through
 * Tailwind's generated utilities, and computes no layout — so it cannot tell
 * whether a token reaches a pixel. What is checkable, and what regresses, is
 * whether the override has a reader at all.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const GLOBALS = join(ROOT, 'app', 'globals.css');

const css = readFileSync(GLOBALS, 'utf8');

/**
 * Every place a token could legitimately be read from: the stylesheet itself,
 * the Tailwind config that turns tokens into utilities, and any component that
 * inlines a `var()` (which `BuildGauge` does for the ramp and the redline).
 */
function sources(): string {
  const files: string[] = [GLOBALS, join(ROOT, 'tailwind.config.ts')];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(entry.name)) files.push(full);
    }
  };
  walk(join(ROOT, 'components'));
  walk(join(ROOT, 'app'));

  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

const all = sources();

/** Strip comments — every claim below is discussed in prose beside the code it
 *  describes, and an unstripped scan would be satisfied by the explanation
 *  rather than the declaration. The sixth time in this repo. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** The `[data-register='sport']` token block, comments removed. */
function sportBlock(): string {
  const bare = code(css);
  const start = bare.indexOf("[data-register='sport'] {");
  expect(start).toBeGreaterThan(-1);
  return bare.slice(start, bare.indexOf('}', start));
}

/**
 * An `exec` loop rather than `matchAll` — this repo's tsconfig targets below
 * ES2015, so spreading an iterator needs `--downlevelIteration`. Third time.
 * The regex is built here rather than hoisted so its `lastIndex` cannot leak.
 */
function overriddenTokens(): string[] {
  const found: string[] = [];
  const pattern = /(--[a-z0-9-]+)\s*:/g;
  const block = sportBlock();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) found.push(match[1]);
  return found;
}

const overridden = overriddenTokens();

describe('the sport register', () => {
  it('overrides something', () => {
    // Guards the guard: every assertion below iterates this list, so an empty
    // list would make the whole suite vacuously green.
    expect(overridden.length).toBeGreaterThan(5);
  });

  it.each(overridden)('%s is read by something', (token) => {
    /*
      The rule the register lives or dies by. `var(--token)` must appear
      somewhere outside the declarations themselves — in a Tailwind mapping, a
      CSS rule, or an inline style.
    */
    /*
      `var(--x)` and `var(--x, fallback)` are both reads. Matching only the
      bare form reported `--register-tracking` as unread when `.num` reads it
      with a fallback — which is exactly the false positive that would get this
      guard weakened rather than obeyed.
    */
    const reader = new RegExp(`var\\(\\s*${token}\\s*[,)]`, 'g');
    expect(code(all).match(reader)?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(overridden)('%s has a default at :root', (token) => {
    /*
      An override with no default is a token that exists only in one register.
      Anything reading it gets the empty string in the other, which is how a
      `calc()` goes invalid at computed-value time and drops its whole
      declaration — the failure `--register-chamfer: 0px` exists to prevent.
    */
    const root = code(css).slice(css.indexOf(':root {'), css.indexOf("[data-register='sport']"));
    expect(root).toContain(`${token}:`);
  });
});

describe('the radius collapse', () => {
  it('moves `--radius`, which is what Tailwind actually derives from', () => {
    /*
      The whole finding, pinned. `rounded-lg`, `rounded-md` and `rounded-sm`
      are all `calc()`s over `--radius` in `tailwind.config.ts`. A register
      that overrides `--radius-lg` instead — as the export does — changes
      nothing, because `--radius-lg` does not exist here.
    */
    expect(sportBlock()).toMatch(/--radius\s*:/);
  });

  it('leaves `--radius-full` alone', () => {
    /*
      94 sites, nearly all pills, avatars and status dots. At 3px those read as
      a rendering fault rather than a decision. The register sharpens panels;
      it does not turn every badge into a chiclet.
    */
    expect(sportBlock()).not.toMatch(/--radius-full\s*:/);
  });
});

describe('the accent', () => {
  it('resolves to a colour, not a bare HSL triplet', () => {
    /*
      This file stores most colours as bare triplets for Tailwind's
      `hsl(var(--x))` mapping. `--register-accent` is used as `color:
      var(--register-accent)` directly, so its target must be a complete
      colour. `--info` is a full hex today; "harmonising" it into a triplet
      would break the register silently.
    */
    expect(code(css)).toMatch(/--info:\s*#[0-9a-fA-F]{6}/);
    expect(code(css)).toMatch(/--build-far:\s*#[0-9a-fA-F]{6}/);
  });
});
