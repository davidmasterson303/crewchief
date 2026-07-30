/**
 * The garage-door intro is drawn, and stays drawn.
 *
 * A ratchet, for the same reason `demo-image-budget.test.ts` is one: the
 * regression is invisible in every way that normally catches things. Point the
 * curtain at a photograph of a garage door and it renders *better* — a real
 * door, real metal, real light — costs a megabyte and a half, and no test of
 * behaviour fails. Nothing looks wrong. On a development machine it is not even
 * slow.
 *
 * That is not hypothetical. It is what the previous implementation did:
 * `LandingHero` used a **1,477,589-byte JPEG** as a CSS `background-image`, set
 * in an inline style inside an `ssr: false` chunk — invisible to the preload
 * scanner, unable to start downloading until the JS had parsed, and so able to
 * paint as a black rectangle. Six times the budget the entire three-card demo
 * grid is held to, for one decorative backdrop that covers the screen for two
 * and a half seconds.
 *
 * The likeliest way it comes back is someone deciding the CSS slats look
 * synthetic and reaching for a photo. That is a reasonable instinct with an
 * unreasonable cost, so it fails here and has to be argued for rather than
 * merged.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const GLOBALS_CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');

/** Everything the curtain is made of. */
const DOOR_SOURCES = ['components/GarageDoor.tsx', 'components/LandingHero.tsx'];

/**
 * The `.garage-door` rule body, which is where a backdrop would be reintroduced.
 *
 * Matched from the selector to the first closing brace. The rule contains no
 * nested blocks, so that is sufficient — and the "is the door still drawn"
 * assertion below fails loudly if this ever stops finding the real thing.
 */
function doorRule(): string {
  const match = GLOBALS_CSS.match(/\n\.garage-door\s*\{([^}]*)\}/);
  return match ? match[1] : '';
}

describe('the garage door costs no image payload', () => {
  it('finds the rule it is asserting about', () => {
    // Guards the guard. A renamed class would make every assertion below pass
    // against an empty string, which is the failure mode of every regex-based
    // source check.
    expect(doorRule()).not.toHaveLength(0);
  });

  it('is still drawn — gradients, not a photograph', () => {
    // The positive half. Without it, deleting the door's styling entirely
    // would satisfy "references no image" perfectly.
    expect(doorRule()).toMatch(/repeating-linear-gradient/);
  });

  it('loads nothing over the network', () => {
    expect(doorRule()).not.toMatch(/url\(/);
  });

  it.each(DOOR_SOURCES)('%s references no image asset', (rel) => {
    const source = readFileSync(join(ROOT, rel), 'utf8');

    /*
      Any path into public/, by extension rather than by filename — the point
      is to catch a *new* image, so matching the old one's name would be
      useless. `next/image` is caught too: it is the right tool for a product
      photograph and still the wrong answer for a full-screen curtain, which
      must be painted in the first frame and cannot wait for a fetch.
    */
    expect(source).not.toMatch(/\.(jpe?g|png|gif|webp|avif)\b/i);
    expect(source).not.toMatch(/from\s+['"]next\/image['"]/);
  });
});

describe('the curtain cannot be lazily loaded', () => {
  // Just `/` now — app/demo/page.tsx was merged into it, and /demo redirects.
  it.each(['app/page.tsx'])('%s imports the door eagerly', (rel) => {
    /*
      The door must be in the server's HTML, or it cannot cover the first
      paint. `/demo` previously loaded the hero through
      `dynamic(..., { ssr: false })` and raced its arrival against a 600ms
      auto-open timer — when the chunk lost, the curtain mounted already-open
      and the intro silently never played. No error, no warning, just no intro,
      and only on the slow loads nobody develops against.
    */
    const source = readFileSync(join(ROOT, rel), 'utf8');

    /*
      Matches the default import in any shape — `import GarageDoor from …` and
      `import GarageDoor, { useIntroRevealed } from …` alike. It was pinned to
      the exact former string and failed the moment the module grew a named
      export, which is a guard objecting to something it does not care about.
      What it cares about is the second assertion: that the door is not behind
      `dynamic()`.
    */
    expect(source).toMatch(/^import GarageDoor\b[^;]*from '@\/components\/GarageDoor';$/m);
    expect(source).not.toMatch(/dynamic\([^)]*(?:GarageDoor|LandingHero)/);
  });
});
