/**
 * `$rules.viewportFloors` — RP4, the half that does not need a browser.
 *
 * @jest-environment node
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * The responsive audit closed RP0 and RP1 across a few dozen files, and its last
 * line is the point of this file: **"Then this audit cannot happen twice."** An
 * audit that fixes 54 sites and leaves nothing watching them has bought a good
 * afternoon, not a property.
 *
 * RP4 asks for four assertions at 320 · 375 · 768 · 1440. Two of them —
 * no horizontal overflow, no interactive target under 44px — need a real
 * browser and layout, and ride with item 15's Lighthouse CI owner. **The other
 * two are decidable from source**, cheaply, in the pattern
 * `image-weight-budget.test.ts` established:
 *
 * - no rendered text under 12px
 * - no focusable input under 16px at ≤640
 *
 * ── Why the input rule is checked three ways ────────────────────────────────
 *
 * Because R2's fix has three separate ways to come undone, and the symptom of
 * all three is identical and invisible in a desktop browser: mobile Safari zooms
 * the page on focus and **never restores the scale**, leaving the user
 * horizontally scrolled for the rest of the session.
 *
 * 1. The rule is deleted or its media query loosened.
 * 2. A Tailwind utility is added at a call site — `text-sm` on a `<textarea>` —
 *    which beats a bare element selector on specificity. This is exactly how the
 *    bug shipped the first time, and the audit's own fix was to remove the
 *    utility rather than mark the rule `!important`.
 * 3. Somebody "fixes" a zoom complaint with `maximum-scale=1` or
 *    `user-scalable=no`, which does stop the zoom — by disabling pinch-zoom
 *    entirely. That fails WCAG 1.4.4 and quietly undoes the accessibility work
 *    in item 17. The roadmap says **do NOT** in capitals; this is that in code.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['app', 'components'];

/**
 * The type floor, in px. Tailwind's `text-xs` sits exactly here, which is why
 * the audit could resolve 54 sites by moving all of them to it.
 */
const TYPE_FLOOR_PX = 12;

/**
 * The size below which iOS Safari zooms a focused field.
 *
 * Not a design number — it is Safari's, and it is why 14px density survives on
 * desktop: a mouse-driven window has no zoom rule to satisfy.
 */
const NO_ZOOM_PX = 16;

/**
 * `app/dev/` never ships.
 *
 * The one sub-floor site in the repo is a 9px caption under an illustration
 * swatch on `app/dev/vehicle-illustrations`, which exists to compare drawings
 * side by side. Same exemption the mobile token block gets, and named here so
 * the exemption is a decision rather than a hole.
 */
const NOT_SHIPPED = [join('app', 'dev')];

function sourceFiles(dir: string, acc: { rel: string; code: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') sourceFiles(full, acc);
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      acc.push({ rel: full.slice(ROOT.length + 1), code: readFileSync(full, 'utf8') });
    }
  }
  return acc;
}

/**
 * Arbitrary font sizes, in either unit Tailwind accepts.
 *
 * Named sizes are not scanned and do not need to be: `text-xs` is the floor and
 * everything above it is larger. Only an arbitrary value can go under, which is
 * also what every one of the audit's 54 sites was.
 */
function sizesBelowFloor(code: string): string[] {
  const found: string[] = [];
  const pattern = /text-\[(\d*\.?\d+)(px|rem)\]/g;

  let match: RegExpExecArray | null = pattern.exec(code);
  while (match !== null) {
    const px = match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
    if (px < TYPE_FLOOR_PX) found.push(match[0]);
    match = pattern.exec(code);
  }

  return found;
}

describe('nothing renders below the type floor', () => {
  const files = sourceFiles(join(ROOT, SCANNED[0]))
    .concat(sourceFiles(join(ROOT, SCANNED[1])))
    .filter((f) => !NOT_SHIPPED.some((skip) => f.rel.startsWith(skip)));

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('names no size under 12px', () => {
    const offenders = files
      .flatMap(({ rel, code }) => sizesBelowFloor(code).map((size) => `${rel} — ${size}`))
      .sort();

    expect(offenders).toEqual([]);
  });

  it('still measures rem as well as px, so this is not vacuous', () => {
    // `text-[0.625rem]` is 10px and reads as innocuous. The repo has a real
    // `text-[0.8rem]` (12.8px) which must keep passing, so the unit conversion
    // has to be right in both directions rather than merely strict.
    expect(sizesBelowFloor('class="text-[0.625rem]"')).toEqual(['text-[0.625rem]']);
    expect(sizesBelowFloor('class="text-[11px]"')).toEqual(['text-[11px]']);
    expect(sizesBelowFloor('class="text-[0.8rem]"')).toEqual([]);
    expect(sizesBelowFloor('class="text-xs"')).toEqual([]);
  });
});

/**
 * Variants that move a utility onto something that is not the field's own text.
 *
 * `file:` reaches a file control's button, `placeholder:` the placeholder,
 * `selection:` the highlight. None of them sets the size iOS measures when it
 * decides whether to zoom, so none of them is a violation — see the test that
 * pins this.
 */
const PSEUDO_ELEMENT_VARIANTS = ['file', 'placeholder', 'selection', 'marker', 'before', 'after', 'first-letter', 'first-line'];

/**
 * Font-size utilities under 16px applied to a field's own text.
 *
 * Returns the offending class with its variant chain intact, because
 * `sm:text-sm` and `text-sm` are different mistakes and the message should say
 * which one was made.
 */
function fieldsWithSmallType(code: string): string[] {
  const hits: string[] = [];
  const element = /<(input|textarea|select)\b([^>]*)>/g;

  let tag: RegExpExecArray | null = element.exec(code);
  while (tag !== null) {
    const attrs = tag[2];
    const utility = /(?:^|["'\s])((?:[a-z-]+:)*text-(?:xs|sm))\b/g;

    let found: RegExpExecArray | null = utility.exec(attrs);
    while (found !== null) {
      const parts = found[1].split(':');
      const variants = parts.slice(0, -1);

      if (!variants.some((v) => PSEUDO_ELEMENT_VARIANTS.includes(v))) {
        hits.push(`<${tag[1]}> carries ${found[1]}`);
      }

      found = utility.exec(attrs);
    }

    tag = element.exec(code);
  }

  return hits;
}

describe('no focusable field is small enough to zoom the page', () => {
  const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');

  it('keeps the pointer-scoped rule that sets fields to 16px', () => {
    /*
      Scoped to the pointer rather than to a width, deliberately: a 500px
      desktop window has no zoom rule to satisfy and keeps its 14px density,
      while a 1024px tablet does have one and gets 16.
    */
    const rule = css.slice(css.indexOf('@media (hover: none) and (pointer: coarse)'));

    expect(rule).toContain('font-size: 16px');
    expect(`${NO_ZOOM_PX}px`).toBe('16px');

    // Bare element selectors as well as the classes, so a control that never
    // adopted `.field` is covered too.
    for (const selector of ['.field', 'textarea', 'select', "input[type='text']"]) {
      expect(rule.slice(0, rule.indexOf('}'))).toContain(selector);
    }
  });

  it('lets no call site out-specify it with a smaller utility', () => {
    /*
      ⚠ How the bug shipped the first time. A Tailwind utility beats a bare
      element selector, so `text-sm` on the chat composer silently reinstated
      14px under the media query — and the audit's fix was to delete the utility
      at the call site rather than mark the rule `!important`. Nothing but this
      stops it being typed again.
    */
    const files = sourceFiles(join(ROOT, 'app'))
      .concat(sourceFiles(join(ROOT, 'components')))
      .filter((f) => !NOT_SHIPPED.some((skip) => f.rel.startsWith(skip)));

    const offenders = files
      .flatMap(({ rel, code }) => fieldsWithSmallType(code).map((hit) => `${rel} — ${hit}`))
      .sort();

    expect(offenders).toEqual([]);
  });

  it('does not mistake a pseudo-element utility for the field s own type', () => {
    /*
      ⚠ The first version of this scan failed on `components/ui/input.tsx`, and
      it was **wrong**. That file carries `file:text-sm`, which styles a file
      control's `::file-selector-button` — a button inside the field, not the
      field's text. It cannot cause the zoom, because the zoom is decided by the
      input's own computed size.

      Worth pinning rather than quietly narrowing the regex, because the failure
      mode of a guard that cries wolf is specific and bad: the next person makes
      it pass. On a rule whose real violation is invisible in every desktop
      browser, a spurious failure spends the credibility the rule runs on.

      Responsive and state variants stay violations. A coarse pointer is not a
      narrow one — an iPad is 768px wide and still zooms — so `sm:text-sm` on a
      field is a real regression, not a safe one.
    */
    expect(fieldsWithSmallType('<input className="field file:text-sm" />')).toEqual([]);
    expect(fieldsWithSmallType('<input className="field placeholder:text-xs" />')).toEqual([]);

    expect(fieldsWithSmallType('<input className="field text-sm" />')).toEqual([
      '<input> carries text-sm',
    ]);
    expect(fieldsWithSmallType('<textarea className="sm:text-sm" />')).toEqual([
      '<textarea> carries sm:text-sm',
    ]);
  });

  it('never disables pinch-zoom to stop the zoom', () => {
    /*
      ⚠ The forbidden fix, and it is forbidden because it *works*. Someone
      hitting the zoom bug will reach for `maximum-scale=1` or
      `user-scalable=no`, the page will stop jumping, and the change will look
      like a fix. It fails WCAG 1.4.4 and undoes item 17's accessibility work,
      and nothing about the resulting page says so.

      Scanned across the whole app rather than one file, because the viewport is
      settable from a `metadata`/`viewport` export in any layout or page.
    */
    const files = sourceFiles(join(ROOT, 'app'));

    const offenders = files
      .filter(({ code }) => /maximum-?[Ss]cale|user-?[Ss]calable/.test(code))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});
