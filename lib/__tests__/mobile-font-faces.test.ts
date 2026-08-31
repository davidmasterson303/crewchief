/**
 * `$rules.fontFaces` — a weight never travels without its face.
 *
 * @jest-environment node
 *
 * ── The failure this exists to prevent, which is specific and ugly ──────────
 *
 * React Native does not synthesise weights for a bundled font. On the web
 * `font-weight: 600` picks the semibold cut out of a family; here **each cut is
 * its own family name**, because Android resolves fonts by filename and has no
 * family table to consult. So `fontWeight: '600'` on its own does not render
 * semibold Inter — it renders the **system** face, San Francisco.
 *
 * Which means a half-applied typeface does not look like a missing font. It
 * looks like a design: some strings in Inter, some in SF, at the same size and
 * weight, on the same card. On 16 Aug there were **~60 such sites** across
 * seventeen files — every one of them a place the app would have silently
 * fallen back after Inter was bundled.
 *
 * ⚠ This is the whole reason the font change could not be "add a fontFamily to
 * the theme". The token layer covers the styles that spread `...type.x`; these
 * sixty did not.
 *
 * ── Why the rule is weight-implies-face, and not "use a type role" ──────────
 *
 * The stricter rule is the right one eventually: every string in the app
 * should take one of the eight roles, and the ~15 off-scale sizes still in the
 * screens (15, 17, 20, 22, 24, 30) are real drift worth closing. But that is a
 * design pass with a designer's eye, and it is not decidable by a scanner —
 * the same argument `mobile-radius-scale` makes about spacing.
 *
 * What *is* decidable is that a named weight must name its face. That is
 * mechanical, it is the rule whose violation is invisible, and it holds
 * whatever happens to the size scale later.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { FONT_FACES, EDITORIAL_FACE, interFace } from '../../apps/mobile/src/theme/fonts';
import { type as typeScale } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/**
 * `theme/` is where the faces are defined and where the roles carry them, so it
 * is the one place a weight and a face can legitimately be written apart.
 */
const ALLOWED = [join('src', 'theme')];

function sourceFiles(dir: string, acc: { rel: string; code: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, acc);
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      acc.push({
        rel: full.slice(full.indexOf(join('apps', 'mobile'))),
        code: readFileSync(full, 'utf8'),
      });
    }
  }
  return acc;
}

/** Comments discuss weights constantly; they must not trip the rule. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * A weight written as a style value or an SVG prop, with no `interFace` in
 * front of it.
 *
 * Both forms are checked because `ClusterGauge` writes `fontWeight="500"` as a
 * prop on `react-native-svg`'s `Text`, which takes the same fallback and would
 * have been missed by a style-only scan.
 */
const NAKED_STYLE = /(?<!interFace\('\d{3}'\), )fontWeight: '(\d{3})'/;
const NAKED_PROP = /(?<!fontFamily=\{interFace\('\d{3}'\)\} )fontWeight="(\d{3})"/;

describe('every named weight names the face that carries it', () => {
  const files = sourceFiles(MOBILE_SRC)
    .filter((f) => !ALLOWED.some((a) => f.rel.includes(a)))
    .map((f) => ({ ...f, code: stripComments(f.code) }));

  it('has sources to scan', () => {
    // A broken walk makes the assertion below pass vacuously — the failure mode
    // this repo's ratchets have shipped with twice.
    expect(files.length).toBeGreaterThan(10);
  });

  it('leaves no weight to fall back to the system face', () => {
    const offenders = files
      .filter((f) => NAKED_STYLE.test(f.code) || NAKED_PROP.test(f.code))
      .map((f) => {
        const line = f.code
          .split('\n')
          .find((l) => NAKED_STYLE.test(l) || NAKED_PROP.test(l))
          ?.trim()
          .slice(0, 80);
        return `${f.rel} — ${line}`;
      });

    expect(offenders).toEqual([]);
  });

  it('asks only for faces it actually bundles', () => {
    /*
      ⚠ The other direction, and the one with no visible symptom. A face named
      in a style but never loaded is not an error at runtime — it silently
      renders in the system font, which is the exact defect this whole rule
      exists to prevent, arriving through the back door.

      This checks the names against `FONT_FACES`; that the *files* match those
      names is checked in `apps/mobile`, where a `.ttf` can actually be loaded.
    */
    /*
      Arrays rather than `Set`s: the web package targets below ES2015 iteration,
      so spreading a `Set` fails the typecheck even though it runs. Same
      constraint that shaped `matchAllOf` in `consultant-estimate.ts`.
    */
    const bundled: readonly string[] = FONT_FACES;
    const requested: string[] = [];

    for (const file of files) {
      const pattern = /interFace\('(\d{3})'\)/g;
      let match: RegExpExecArray | null = pattern.exec(file.code);
      while (match !== null) {
        const face = interFace(match[1] as Parameters<typeof interFace>[0]);
        if (!requested.includes(face)) requested.push(face);
        match = pattern.exec(file.code);
      }
    }

    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter((face) => !bundled.includes(face))).toEqual([]);
  });
});

describe('the faces the roles are built from', () => {
  it('gives every type role a face', () => {
    /*
      The half a file-scanner cannot state: an app with no naked weights and no
      faces on its roles is not compliant, it is rendering in San Francisco.
      This imports the shipped scale, so the suite exercises real code rather
      than only reading it.
    */
    const roles = Object.entries(typeScale) as [string, { fontFamily?: string }][];

    expect(roles.length).toBeGreaterThan(4);
    expect(roles.filter(([, style]) => !style.fontFamily).map(([name]) => name)).toEqual([]);
  });

  it('keeps the serif to one cut in the type scale, because it is one role', () => {
    /*
      "Newsreader for one serif role per screen" — one per screen, never two. A
      second cut in the *scale* is a second editorial role arriving by the back
      door, and that is what this refuses.

      ⚠ Narrowed 30 Aug, and the narrowing is the interesting part. It used to
      assert `FONT_FACES` held exactly one Newsreader, which is a different
      claim and was only accidentally the same one. The brand lockup needs
      Newsreader **500** — Design sets the engraved name at that weight — and it
      is not a text role at all: it is a mark, drawn in SVG, that no screen sets
      body copy in.

      So the rule is enforced where it actually lives: **the type scale** may
      contain one serif cut. A second face may exist in the bundle only if
      nothing in the scale uses it. That is stricter than the old assertion in
      the direction that matters — it would still fail if somebody wired the
      brand face into a text role.
    */
    const serifs = FONT_FACES.filter((face) => face.startsWith('Newsreader'));
    const inScale = Object.values(typeScale)
      .map((style) => (style as { fontFamily?: string }).fontFamily)
      .filter((face): face is string => Boolean(face?.startsWith('Newsreader')));

    expect(Array.from(new Set(inScale))).toEqual([EDITORIAL_FACE]);
    expect(typeScale.editorial.fontFamily).toBe(EDITORIAL_FACE);

    // Any extra serif cut is the brand's, and it is used by the mark alone.
    const extras = serifs.filter((face) => face !== EDITORIAL_FACE);
    expect(extras).toEqual(['Newsreader_500Medium']);

    const lockup = readFileSync(
      join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'components', 'BrandLockup.tsx'),
      'utf8'
    );
    expect(lockup).toContain('Newsreader_500Medium');
  });

  it('spends a bundled file on each weight it offers, and no more', () => {
    // Every entry here is a file in the shipped bundle. A scale with nine
    // weights is one nobody can hold in their head — the same argument the
    // radius scale makes about 9, 10 and 16.
    expect(FONT_FACES.filter((f) => f.startsWith('Inter')).slice().sort()).toEqual([
      'Inter_400Regular',
      'Inter_500Medium',
      'Inter_600SemiBold',
      'Inter_700Bold',
      'Inter_800ExtraBold',
    ]);
  });

  it('can still detect a naked weight, so this is not vacuous', () => {
    // Guards the guard. A regex that stopped matching would report a clean app
    // forever, which is indistinguishable from success.
    expect(NAKED_STYLE.test("title: { fontSize: 22, fontWeight: '700' },")).toBe(true);
    expect(NAKED_PROP.test('<SvgText fontWeight="500" />')).toBe(true);

    expect(
      NAKED_STYLE.test("title: { fontFamily: interFace('700'), fontWeight: '700' },")
    ).toBe(false);
    expect(NAKED_PROP.test("<SvgText fontFamily={interFace('500')} fontWeight=\"500\" />")).toBe(
      false
    );
  });
});
