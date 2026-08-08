/**
 * The AA contrast floor on body text, held as a rule rather than as a memory.
 *
 * @jest-environment node
 *
 * Roadmap item 17 measured `text-white/30` at 2.71:1 and `text-white/40` at
 * 3.78:1 against the lightest pixel the plate produces — both below WCAG AA's
 * 4.5:1 for normal text — and `1ec6e68` raised **157 text sites** to the `/50`
 * floor, which measures 5.14:1. It also, correctly, left **29 icons alone**: a
 * Lucide glyph takes `text-*` too, and a graphic answers to the 3:1 non-text
 * bar, so a blanket replace would have restyled every icon in the app to fix a
 * text defect.
 *
 * **That pass shipped with no guard, and it decayed in one day.** The anonymous
 * front door (`app/check/page.tsx`, Phase 2.97b, written 3 Aug) arrived with
 * four sub-floor text sites — including the disclaimer, which is the one
 * sentence on the page with a legal reason to be readable. It is the page built
 * for cold traffic arriving from a forum link, so it is the page where an
 * unreadable line is least recoverable.
 *
 * Nothing caught it, because nothing could: a contrast failure passes the
 * typecheck, passes every unit test, and *looks fine* to whoever wrote it on a
 * bright laptop screen. This file is what item 17 should have shipped with.
 *
 * ── Why source analysis and not a rendered probe ─────────────────────────────
 *
 * Item 17 verified its own work by walking rendered leaf text nodes and
 * compositing alpha over the backdrop — the right instrument for *measuring*,
 * and the wrong one for *pinning*. It needs a browser, it only sees routes
 * someone remembered to visit, and it cannot see a state that needs data to
 * reach. The regression here was on a page that probe never ran against.
 *
 * The class name in the source is the whole signal, and it is deterministic.
 *
 * ── The classification, which is the load-bearing part ───────────────────────
 *
 * Item 17's own rule, restated so it can be applied rather than remembered:
 * a site is **text** if its class string carries a text size, and an **icon**
 * if it carries `h-N w-N` and no text size. Anything else is **unclassifiable**
 * and fails — see the note on that below, because that category is not a
 * loophole, it is where the second real defect was found.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SURFACES = ['app', 'components'].map((d) => join(ROOT, d));

/** `/50` measures 5.14:1 over the plate. Below it is the failure item 17 fixed. */
const FLOOR = 50;

/**
 * `text-white/25`, and `placeholder:text-white/35`, and the `hover:` variants.
 *
 * The boundary is a negative lookbehind rather than a leading `[\s:]` class,
 * because the token is just as often the *first* thing in its string —
 * `className="text-white/40 text-xs …"` — and a leading-whitespace rule misses
 * exactly those. It cost two of the four front-door findings on the first run.
 */
const SUB_FLOOR = /(?<![\w-])(?:[a-z-]+:)*text-white\/(\d{1,2})(?![\d])/g;

/**
 * Tailwind's named sizes plus the arbitrary form this codebase uses.
 * No trailing `\b`: `text-[15px]` ends in `]`, which is not a word character,
 * so a word boundary after it never matches and the whole arbitrary form goes
 * unrecognised — which classified the front door's textarea as unclassifiable
 * rather than as the text it is.
 */
const TEXT_SIZE = /\btext-(?:xs|sm|base|lg|xl|\d?xl\b|\[\d+(?:\.\d+)?(?:px|rem)\])/;

/** A Lucide glyph is sized in both axes; `h-4 w-4`, `h-3.5 w-3.5`, `w-8 h-8`. */
const ICON_DIMS = [/\bh-\d+(?:\.\d+)?\b/, /\bw-\d+(?:\.\d+)?\b/];

/**
 * Comments are stripped before the scan, and this codebase has been bitten
 * twice by not doing it: `ai-usage.test.ts` found an absence assertion that a
 * comment satisfied, and `funnel-steps.test.ts` found one satisfied by a SQL
 * `COMMENT ON`. `components/MaintenanceHistory.tsx` narrates `text-white/30` in
 * prose explaining a decision — a correct sentence about a class the file no
 * longer applies, and a false positive if this scanner reads it.
 *
 * **A comment opener has to be anchored, and the first draft here was not.**
 * `app/check/page.tsx:146` is `accept="image/*"`. An unanchored `/\*` treats
 * that as the start of a block comment and eats everything up to the next `*​/`
 * — sixty lines, including three of the four defects this file was written to
 * pin. It went green against the file it exists to catch. So an opener must be
 * preceded by start-of-line, whitespace, or one of the characters a comment
 * actually follows in this codebase — never by the tail of a class name — and
 * the "did not eat the markup" case below asserts the outcome rather than
 * trusting the rule.
 *
 * Comment bodies are blanked to spaces rather than removed, and newlines are
 * kept. A stripper that shortens the source silently shifts every line number
 * it later reports — the first run here pointed at `app/check/page.tsx:175` for
 * a defect on line 200, which is a scanner that finds the right bug and then
 * sends you to the wrong place.
 */
function stripComments(source: string): string {
  const blank = (m: string, lead: string) =>
    lead + m.slice(lead.length).replace(/[^\n]/g, ' ');
  return source
    .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s{(,;])\/\/[^\n]*/g, blank);
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

type Kind = 'text' | 'icon' | 'unclassifiable';

interface Site {
  file: string;
  line: number;
  token: string;
  /** The smallest quoted run containing the token — the class string as written. */
  classes: string;
  kind: Kind;
}

/**
 * The smallest string literal containing `index`. A className is written as a
 * quoted run in every form this codebase uses — a plain attribute, a template
 * literal, or a branch of a ternary inside one — and the branch is the right
 * unit: `${done ? 'text-white/45' : 'text-white/25'}` is two independent
 * decisions and each should be judged on what it actually says.
 */
function enclosingString(source: string, index: number): string {
  const before = source.slice(0, index);
  const start = Math.max(
    before.lastIndexOf('"'),
    before.lastIndexOf("'"),
    before.lastIndexOf('`'),
    before.lastIndexOf('{'),
    before.lastIndexOf('}')
  );
  const after = source.slice(index);
  const ends = ['"', "'", '`', '{', '}']
    .map((q) => after.indexOf(q))
    .filter((i) => i !== -1);
  const end = ends.length ? index + Math.min(...ends) : source.length;
  return source.slice(start + 1, end);
}

/**
 * The template literal a ternary branch composes into, when there is one.
 *
 * `'text-white/40'` on its own says nothing about whether it will land on a
 * glyph or a sentence, but `` `h-3.5 w-3.5 ${isActive ? … : 'text-white/40'}` ``
 * says it plainly. Without this, every conditional icon colour in
 * `DashboardLayout` reads as unclassifiable and the guard demands churn on code
 * that is already correct — the way a rule stops being believed.
 *
 * The backward search stops at a `;`, so a bare `const c = '…/40'` does *not*
 * borrow the class string of some unrelated template further up the file. That
 * is the distinction the whole widening rests on: a colour written next to its
 * size can be judged, and a colour written apart from it cannot.
 */
function enclosingTemplate(source: string, index: number): string | null {
  const before = source.slice(0, index);
  const tick = before.lastIndexOf('`');
  if (tick === -1 || before.lastIndexOf(';') > tick) return null;
  const close = source.indexOf('`', index);
  return close === -1 ? null : source.slice(tick + 1, close);
}

function classifyClasses(classes: string): Kind {
  if (TEXT_SIZE.test(classes)) return 'text';
  if (ICON_DIMS.every((re) => re.test(classes))) return 'icon';
  return 'unclassifiable';
}

function classify(source: string, index: number, classes: string): Kind {
  const direct = classifyClasses(classes);
  if (direct !== 'unclassifiable') return direct;
  const wider = enclosingTemplate(source, index);
  return wider ? classifyClasses(wider) : 'unclassifiable';
}

function scan(): Site[] {
  const sites: Site[] = [];

  for (const surface of SURFACES) {
    for (const file of tsxFiles(surface)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      SUB_FLOOR.lastIndex = 0;

      // `Array.from` rather than iterating the iterator directly: this repo's
      // tsconfig target predates `--downlevelIteration`, and `npx tsc` rejects
      // the for-of form even though Jest runs it happily.
      for (const match of Array.from(source.matchAll(SUB_FLOOR))) {
        if (Number(match[1]) >= FLOOR) continue;
        const index = match.index ?? 0;
        const classes = enclosingString(source, index);
        sites.push({
          file: file.slice(ROOT.length + 1),
          line: source.slice(0, index).split('\n').length,
          token: match[0].trim(),
          classes,
          kind: classify(source, index, classes),
        });
      }
    }
  }

  return sites;
}

const sites = scan();
const show = (s: Site) => `${s.file}:${s.line}  ${s.token}  in "${s.classes.trim()}"`;

/** Every `text-white/NN`, at any alpha, as written before the stripper runs. */
function rawTokenCount(): number {
  return SURFACES.flatMap(tsxFiles).reduce(
    (n, f) => n + (readFileSync(f, 'utf8').match(/text-white\/\d+/g)?.length ?? 0),
    0
  );
}

function strippedTokenCount(): number {
  return SURFACES.flatMap(tsxFiles).reduce(
    (n, f) => n + (stripComments(readFileSync(f, 'utf8')).match(/text-white\/\d+/g)?.length ?? 0),
    0
  );
}

describe('body text holds the AA contrast floor', () => {
  it('scanned the surfaces it claims to scan', () => {
    // A regex that stopped matching would make every assertion below pass
    // silently, which is the failure this whole file exists to prevent one
    // layer up. If the icon sites disappear, the scanner broke — item 17
    // deliberately left 29 of them in place.
    const files = SURFACES.flatMap(tsxFiles);
    expect(files.length).toBeGreaterThan(30);
    expect(sites.filter((s) => s.kind === 'icon').length).toBeGreaterThan(10);
  });

  it('did not eat the markup it was about to read', () => {
    // The stripper's first draft removed 60 lines of `app/check/page.tsx` and
    // turned three real failures into a passing run. Assert what survived, not
    // that the rule looks right: at most a handful of these tokens are ever
    // legitimately inside prose, so anything approaching a whole file's worth
    // means the stripper is eating markup again.
    const raw = rawTokenCount();
    expect(raw).toBeGreaterThan(100);
    expect(strippedTokenCount()).toBeGreaterThanOrEqual(raw - 5);
  });

  it('renders no text below text-white/50', () => {
    // Item 17's measurement: /30 is 2.71:1 and /40 is 3.78:1 against a 4.5:1
    // bar. /50 is 5.14:1 and is the floor. Icons are exempt and answer to the
    // 3:1 non-text bar instead.
    const failures = sites.filter((s) => s.kind === 'text').map(show);
    expect(failures).toEqual([]);
  });

  describe('and nothing hides under an opacity multiplier', () => {
    /*
      ── The gap this closes, and the standard I had wrong ────────────────────

      `d6fbae8` taught the *mobile* helper to composite `opacity` and it
      immediately found two controls at 1.61:1 and ~1.85:1. This guard, on the
      web side, never mentioned opacity at all — so every rule above could be
      satisfied by a perfectly compliant `text-white/50` sitting inside an
      `opacity-60` parent, at an effective 0.30 alpha. That is item 17's own
      2.71:1 defect, reachable without ever writing a sub-floor token.

      **Correction, because I overstated this once.** WCAG 2.1 SC 1.4.3 exempts
      inactive components: *"User Interface Components that are not available
      for user interaction (e.g., a disabled control in HTML) are not required
      to meet contrast requirements."* Verified against the W3C Understanding
      document, not recalled. The two buttons `d6fbae8` fixed were **disabled
      states**, and I described them as failures "against a 4.5 floor" — they
      were not WCAG failures. The fixes stand on product grounds (a primary
      action nobody can read leaves you unable to tell what the control is), but
      the standard did not require them.

      That distinction is the difference between this rule touching 26 sites and
      touching 2. `components/ui/button.tsx` carries `disabled:opacity-50` for
      the whole app; "fixing" that shared primitive would have been the obvious
      move and would have been wrong.

      ── What is in scope ─────────────────────────────────────────────────────

      A **bare** `opacity-N` — no state variant — on an element that is not
      itself an icon. State variants (`disabled:`, `hover:`, `focus:`, `group-`,
      `peer-`, `aria-`, `data-`) are excluded: the first is exempt, and the rest
      describe a transient state rather than how the element reads at rest.
      Responsive variants are *not* excluded — `sm:opacity-60` always applies at
      that width, which makes it an ordinary fade.

      ── ⚠ Known blind spot, stated rather than papered over ──────────────────

      **A source scan cannot see opacity on a distant ancestor.** This rule
      catches the fade at the element that declares it; if a wrapper three
      components up fades a subtree, nothing here knows. Both defects found on
      8 Aug were the shallow form — `ModificationsTab`'s completed-mods
      container and `VehiclePhotoUploadDialog`'s hint pill — and both were found
      by grep before this rule existed, not by it.

      That is the same honesty `mobile-text-contrast.test.ts` applies to its own
      three limits. The rendered probe is the instrument for the deep case, and
      it has its own blind spot (it only sees routes someone visits). Neither is
      complete; recording which is which is what keeps a green run from being
      read as more than it is.
    */

    /** Bare or variant-prefixed, with the variant chain captured. */
    const OPACITY = /(?:^|[\s"'`{])((?:[a-z-]+(?:\[[^\]]*\])?:)*)opacity-(\d{1,3})\b/g;

    /** Transient or formally exempt. See the note above on 1.4.3. */
    const STATE_VARIANT = /\b(disabled|hover|focus|focus-visible|active|group-[a-z-]+|peer-[a-z-]+|aria-[a-z-]+|data-\[)/;

    /**
     * A control disabled by a runtime condition rather than by the `disabled`
     * attribute.
     *
     * `DashboardLayout:475` is the shape: `isDemo ? 'opacity-60
     * cursor-not-allowed' : …`, beside an `onClick` reading `!isDemo && …`. It
     * is exactly as inactive as anything carrying `disabled:opacity-50` and
     * 1.4.3 exempts it identically — but it is written as a ternary, so the
     * variant check above cannot see it.
     *
     * Keying on the cursor is deliberate: `cursor-not-allowed` and
     * `pointer-events-none` are *assertions that the thing cannot be used*, and
     * an author who writes one has said the quiet part in the markup. Keying on
     * the ternary instead would exempt every conditional fade, which is most of
     * them.
     */
    const MARKED_INACTIVE = /\b(cursor-not-allowed|pointer-events-none)\b/;

    /**
     * Elements whose only visible child is a glyph, so the 3:1 non-text bar
     * applies rather than 4.5:1.
     *
     * Both are the shadcn close button: an `<X className="h-4 w-4" />` plus a
     * `<span className="sr-only">Close</span>`. `sr-only` text is visually
     * hidden, and 1.4.3 exempts text "not visible to anyone" in the same
     * sentence it exempts inactive components — so the only thing on screen is
     * the glyph.
     *
     * Named individually rather than matched by a pattern. An allowlist that
     * can be satisfied by accident is not one, and these are vendored
     * primitives nobody edits by hand.
     */
    const ICON_ONLY_CONTROLS = new Set([
      'components/ui/dialog.tsx',
      'components/ui/sheet.tsx',
      /*
        Vendored by shadcn and rendered by nothing — zero importers, checked on
        8 Aug. Its two sites are `day-outside` cells, the greyed leading and
        trailing days of an adjacent month.

        Exempted rather than fixed on the same reasoning that deleted
        `PerformanceGoalSelector` and `TierProgressCard` this week: making an
        unrendered component compliant is work whose only effect is on a file
        nobody sees. Not deleted either, because it is upstream's file and
        `shadcn add` will put it back — a bespoke component that nothing renders
        is dead code, a vendored one is inventory. Worth a separate look.
      */
      'components/ui/calendar.tsx',
    ]);

    const fades = SURFACES.flatMap(tsxFiles).flatMap((file) => {
      const rel = file.slice(ROOT.length + 1);
      const source = stripComments(readFileSync(file, 'utf8'));
      const found: string[] = [];

      for (const match of Array.from(source.matchAll(OPACITY))) {
        const [, variants, value] = match;
        const alpha = Number(value);

        // 0 is hidden and 100 is a no-op; neither fades readable text.
        if (alpha === 0 || alpha >= 100) continue;
        if (STATE_VARIANT.test(variants)) continue;
        if (ICON_ONLY_CONTROLS.has(rel)) continue;

        const index = match.index ?? 0;
        const classes = enclosingString(source, index);

        // An icon answers to 3:1 and is allowed to be quiet.
        if (ICON_DIMS.every((re) => re.test(classes)) && !TEXT_SIZE.test(classes)) continue;

        /*
          Inactive by a runtime condition — 1.4.3 exempts it. See above.

          Widened to the enclosing template for the same reason the `text` rule
          is: inside `` `… ${isDemo ? 'opacity-60 cursor-not-allowed' : …}` ``,
          `enclosingString` returns the *condition* — the literal `"isDemo ?"` —
          because that is the nearest quoted run before the match. The branch
          carrying the cursor is a sibling of it. Testing both is what lets a
          conditional disabled state be recognised as one.
        */
        const context = `${classes} ${enclosingTemplate(source, index) ?? ''}`;
        if (MARKED_INACTIVE.test(context)) continue;

        found.push(
          `${rel}:${source.slice(0, index).split('\n').length}  opacity-${alpha}  in "${classes.trim()}"`
        );
      }

      return found;
    });

    it('found opacity sites to reason about, so this cannot pass vacuously', () => {
      // The exempt sites still have to be *seen*. A regex that matched nothing
      // would make the assertion below trivially green — this file's own
      // "did not eat the markup" case exists for the same reason.
      const anyOpacity = SURFACES.flatMap(tsxFiles).reduce(
        (n, f) => n + (stripComments(readFileSync(f, 'utf8')).match(/opacity-\d/g)?.length ?? 0),
        0
      );
      expect(anyOpacity).toBeGreaterThan(30);
    });

    it('fades nothing readable with a bare opacity', () => {
      /*
        To fix one: express the de-emphasis as a colour. R10 in
        `docs/roadmap.md` already says so — "contrast, not size, makes a label
        recede" — and the reason it matters here is mechanical rather than
        stylistic: an alpha multiplier is the one form of de-emphasis this scan
        structurally cannot measure, and a colour class is the one it can.

        If the fade is on a container, move it onto the text inside, or drop it
        where another signal already carries the meaning. Both 8 Aug fixes took
        the second route and neither lost anything.
      */
      expect(fades).toEqual([]);
    });
  });

  it('leaves nothing unclassifiable', () => {
    // Not pedantry, and not a stricter reading of the rule than item 17's —
    // this category is where the second defect was. `HealthHistoryChart`
    // assigned `text-white/40` to a bare variable that a `text-sm font-medium`
    // div consumed forty lines away, so item 17's pass could not see it was
    // text and left it at 3.78:1. A colour with no size beside it is a site
    // nobody can classify by reading it, which is reason enough to write it
    // differently: put the token where the size is, or state the intent.
    const unknown = sites.filter((s) => s.kind === 'unclassifiable').map(show);
    expect(unknown).toEqual([]);
  });
});
