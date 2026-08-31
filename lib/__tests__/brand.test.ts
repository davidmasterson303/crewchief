/**
 * The mark in `core/brand.ts` is the mark Design shipped.
 *
 * @jest-environment node
 *
 * ── Why this reads the SVG files ────────────────────────────────────────────
 *
 * `packages/core/src/brand.ts` is a hand-transcription of Design's package, and
 * a hand-transcription is exactly the thing this repo has been burned by:
 * `Icon.tsx` carries the rule *"do not redraw or approximate"* because a copied
 * Lucide glyph drifts, and the old dial mark's path lived in two files that had
 * to be kept in step by eye.
 *
 * So the assertions do not restate the numbers — they read `docs/brand-package`
 * and compare. A drift in either direction fails, which is what makes the
 * constants safe to import instead of the files.
 *
 * ⚠ The package is vendored at `docs/brand-package/` precisely so this test has
 * something durable to read; a zip in `~/Downloads` would have made it pass
 * until somebody emptied a folder.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BRAND_COLOR,
  BRAND_NAME,
  BRAND_TYPE,
  CLEAR_SPACE,
  MIN_WIDTH,
  PLATE,
  RIVETS,
  lockupFor,
} from '@wellkept/core/brand';

const PACKAGE = join(__dirname, '..', '..', 'docs', 'brand-package');
const svg = (name: string) => readFileSync(join(PACKAGE, `${name}.svg`), 'utf8');

describe('the plate is the one Design drew', () => {
  it.each([
    ['lockup-full', PLATE.full],
    ['lockup-short', PLATE.short],
  ])('%s carries the same path and box', (file, plate) => {
    const source = svg(file);

    expect(source).toContain(`d="${plate.path}"`);
    expect(source).toContain(`viewBox="0 0 ${plate.width} ${plate.height}"`);
  });

  it('the favicon has its own drawing, not a scaled icon', () => {
    /*
      ⚠ The one that would have been "simplified" away. At 24px the icon's
      proportions close up and the cut corners stop reading as cuts, so Design
      ships a second path with a wider bevel. Asserting they *differ* is the
      point — a future tidy that reused one path would pass every other case
      here.
    */
    expect(PLATE.favicon.path).not.toBe(PLATE.icon.path);
    expect(svg('favicon-mono')).toContain(`d="${PLATE.favicon.path}"`);
  });

  it('puts the rivets where the package does', () => {
    const source = svg('lockup-short');

    for (const rivet of RIVETS.short) {
      expect(
        `${rivet.x},${rivet.y}: ${source.includes(
          `cx="${rivet.x}" cy="${rivet.y}" r="${RIVETS.radius}"`
        )}`
      ).toBe(`${rivet.x},${rivet.y}: true`);
    }
  });
});

describe('the type is set the way Design set it', () => {
  it('keeps the name at Newsreader 500 and the shipped tracking', () => {
    const source = svg('lockup-full');

    expect(source).toContain(`font-size="${BRAND_TYPE.name.size}"`);
    expect(source).toContain(`letter-spacing="${BRAND_TYPE.name.tracking}"`);
    expect(source).toContain(`font-weight="${BRAND_TYPE.name.weight}"`);
    expect(source).toContain('font-variant="small-caps"');
  });

  it('names the maker in Inter, not the serif', () => {
    const source = svg('lockup-full');

    expect(source).toContain(BRAND_TYPE.maker.text);
    expect(source).toContain(`font-size="${BRAND_TYPE.maker.size}"`);
  });

  it('is two words, both capitalised', () => {
    // Design's rule, and the one the old wordmark's docblock got wrong when the
    // rename made "one word, mixed case" false.
    expect(BRAND_NAME).toBe('Well Kept');
    expect(svg('lockup-short')).toContain(`>${BRAND_NAME}</text>`);
  });
});

describe('the colours are the mark’s own', () => {
  it('matches the package on the plate, the glow and the ink', () => {
    const source = svg('lockup-full');

    expect(source).toContain(BRAND_COLOR.plate);
    expect(source).toContain(BRAND_COLOR.glow);
    expect(source).toContain(BRAND_COLOR.name);
  });

  it('keeps the light-ground substitution to the one Design sanctioned', () => {
    /*
      On light grounds the glow cannot exist, so the plate goes hollow and the
      edge takes cyan-700. That is the *only* permitted change — never a cyan
      fill, never a semantic recolour.
    */
    const light = svg('lockup-light');

    expect(light).toContain(BRAND_COLOR.light.edge);
    expect(light).toContain('fill="none"');
    expect(light).not.toContain(BRAND_COLOR.glow);
  });

  it('does not reach into the app’s tokens', () => {
    /*
      `REBRAND_PROMPT.md`: the rebrand is "a name and a mark. No token moves, no
      palette change." A lockup that changed colour when a surface token moved
      would be a brand asset with a dependency nobody intended.
    */
    const source = readFileSync(
      join(__dirname, '..', '..', 'packages', 'core', 'src', 'brand.ts'),
      'utf8'
    );

    expect(source).not.toMatch(/from '\.\/(tokens|theme)/);
    expect(source).not.toMatch(/var\(--/);
  });
});

describe('the minimum sizes are a rule, not a suggestion', () => {
  it('drops the maker line before the type floor, and the lockup before that', () => {
    expect(lockupFor(MIN_WIDTH.full)).toBe('full');
    expect(lockupFor(MIN_WIDTH.full - 1)).toBe('short');
    expect(lockupFor(MIN_WIDTH.short)).toBe('short');
    expect(lockupFor(MIN_WIDTH.short - 1)).toBe('icon');
  });

  it('never scales the lockup below legibility instead', () => {
    /*
      The failure this prevents is a caller passing 90px and getting a full
      lockup with 4px maker type. `lockupFor` answers with a different drawing,
      which is what Design's reduction rules are: no intermediate drawings, no
      hinting.
    */
    expect(lockupFor(12)).toBe('icon');
    expect(CLEAR_SPACE).toBe(48);
  });
});
