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
    /*
      Both indices must come from the SAME string. The first version took them
      from `css` and applied them to `code(css)` — stripping comments shortens
      the text, so the slice landed somewhere arbitrary and the assertion was
      not checking `:root` at all. Found by measuring the deployed page and
      seeing `--bay-heat` resolve to the empty string at `:root` while this
      test was green.
    */
    const bare = code(css);
    const root = bare.slice(bare.indexOf(':root {'), bare.indexOf("[data-register='sport']"));
    expect(root).toContain(`${token}:`);
  });
});

/**
 * The selector a declaration sits inside: the text between the previous `}` or
 * `{` and the `{` that opens this rule.
 */
function enclosingSelector(source: string, at: number): string {
  const open = source.lastIndexOf('{', at);
  const prior = Math.max(source.lastIndexOf('}', open), source.lastIndexOf('{', open - 1));
  return source.slice(prior + 1, open).trim();
}

/**
 * Where a register-controlled token may legally be declared.
 *
 * `:root` is the default and the register block is the override. Anything else
 * that declares one of these SHADOWS the register — see the test below.
 *
 * The third entry is a deliberate exception rather than an oversight.
 * `.service-bay-dim` is the auth screens' variant: the room is scenery there,
 * not the subject, so the LED comes down and the corners go darker. It should
 * keep winning in BOTH registers — a sign-in page has no reason to be brighter
 * because someone answered a modifications question — so it is allowed to
 * shadow on purpose. Adding to this list is a decision, which is the point of
 * it being a list.
 */
const DECLARATION_SITES = [':root', "[data-register='sport']", '.service-bay-dim'];

describe('nothing shadows an override', () => {
  it.each(overridden)('%s is not re-declared on a descendant rule', (token) => {
    /*
      The defect this suite was written to prevent, in the one form it did not
      originally check — and the form that actually shipped.

      **A custom property set directly on an element beats one inherited from
      an ancestor.** The register sets its tokens on <html>. `.service-bay`
      declared `--bay-heat`, `--bay-led` and `--bay-vignette` on ITSELF, and
      `.cockpit-belt` declared `--belt-led`, so all four of sport's biggest
      perceptual changes resolved to the local value and did nothing.

      It read naturally — the knob lives with the thing it drives — which is
      exactly why it needs a test rather than care. Declarations are legal in
      only two places: `:root` (the default) and the register block (the
      override).
    */
    const bare = code(css);

    let declaration: RegExpExecArray | null;
    const pattern = new RegExp(`${token}\\s*:`, 'g');
    const offenders: string[] = [];

    while ((declaration = pattern.exec(bare)) !== null) {
      const selector = enclosingSelector(bare, declaration.index);
      if (!DECLARATION_SITES.includes(selector)) offenders.push(selector);
    }

    expect(offenders).toEqual([]);
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

describe('the way back', () => {
  /** The `.register-switch` rule body. */
  function rule(): string {
    const bare = code(css);
    const start = bare.indexOf('.register-switch {');
    expect(start).toBeGreaterThan(-1);
    return bare.slice(start, bare.indexOf('}', start));
  }

  it('clears the 44px floor', () => {
    /*
      RB0 rule 3. `register-switch.test.tsx` asserts the control opts into this
      class; jsdom computes no layout, so the number itself can only be pinned
      here. The control this replaced was an 11px underline with no floor at
      all, which is exactly the regression worth catching.
    */
    expect(rule()).toMatch(/min-height:\s*44px/);
  });

  it('is a ghost, never a filled control', () => {
    /*
      It is not what anyone came to the garage to do. A filled button here
      competes with the actual primary action on the surface, and the design
      system is explicit that the filled primary is cyan in both registers.
    */
    expect(rule()).toMatch(/background:\s*transparent/);
    expect(rule()).toMatch(/border:\s*none/);
  });

  it('keeps a visible focus ring', () => {
    // `outline: none` without a replacement is a keyboard trap dressed as a
    // style choice. The pair is what makes removing the outline acceptable.
    const focus = code(css).slice(code(css).indexOf('.register-switch:focus-visible'));
    expect(focus.slice(0, 200)).toMatch(/box-shadow:[^;]*var\(--focus-ring-soft\)/);
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
