/**
 * Per-surface image weight, held as a number rather than a habit.
 *
 * @jest-environment node
 *
 * `docs/roadmap.md` item 15: "budgets in CI, not vigilance", so that an
 * F2/F3-class regression can never ship silently again. Those two findings are
 * worth restating, because this file's thresholds are aimed at exactly them:
 *
 *   - **F2** — five auth screens backgrounded a 480 KB JPEG behind a scrim at
 *     0.6–0.85 alpha. Nobody noticed for months, because a heavy background is
 *     invisible on a fast connection and the page looked right.
 *   - **F3** — every photograph shipped as JPEG only, at fixed sizes, with the
 *     Next optimizer switched off.
 *
 * Both are now fixed, and both would be re-introduced by an ordinary-looking
 * edit: one `backgroundImage: url(...)` on a login page, or one new photograph
 * committed without derivatives. Neither shows up in a typecheck, a unit test,
 * or a screenshot.
 *
 * ── Why this is a source/asset check and not Lighthouse ─────────────────────
 *
 * The item asks for LCP and CLS as well. Those need a real browser against a
 * deployed URL, which is a different kind of check with a different failure
 * mode — it is slow, it is flaky on a cold Netlify function, and a red build
 * from a noisy metric teaches people to re-run until green. What is here
 * instead is deterministic: it reads the repo, so it cannot flake, and it
 * catches the specific regressions the audit actually found. LCP/CLS is left
 * as a genuine gap rather than papered over with something unreliable.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_UNPHOTOGRAPHED_VEHICLE_IDS } from '@wellkept/core/demo';
import { cardSlotSource } from '@wellkept/core/photo-slots';
import { VEHICLE_BLUR_DATA } from '@wellkept/core/vehicle-blur';

const ROOT = join(__dirname, '..', '..');
const PUBLIC = join(ROOT, 'public');

/*
  What the garage grid fetches, derived rather than listed.

  `DEMO_IMAGES` was the list and is gone — the database is the only source of
  truth for which photograph a demo car has. `demo-image-budget.test.ts` carries
  the full explanation and the id-keyed parse; this suite only needs the paths,
  so it reads the same migration and applies the same shipped derivation.
*/
function gridCardSources(): string[] {
  const sql = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20260726230000_local_demo_photos_and_focal_points.sql'),
    'utf8'
  );
  const ids = new Map<string, string>();
  const idRe = /(\w+)\s+uuid\s*:=\s*'([0-9a-f-]+)'/gi;
  for (let m = idRe.exec(sql); m; m = idRe.exec(sql)) ids.set(m[1], m[2]);

  const out: string[] = [];
  const rowRe = /image_url\s*=\s*'([^']+)'[\s\S]*?WHERE\s+id\s*=\s*(\w+)/gi;
  for (let m = rowRe.exec(sql); m; m = rowRe.exec(sql)) {
    const uuid = ids.get(m[2]);
    if (uuid && !DEMO_UNPHOTOGRAPHED_VEHICLE_IDS.some((u) => u === uuid)) {
      out.push(cardSlotSource(m[1]) as string);
    }
  }
  return out;
}

/** Every surface that must ship no photograph at all. */
const IMAGE_FREE_PAGES = [
  'app/login/page.tsx',
  'app/signup/page.tsx',
  'app/forgot-password/page.tsx',
  'app/reset-password/page.tsx',
  'app/page.tsx',
];

/** A reference to a raster file in `public/`. */
const RASTER_REFERENCE = /url\(\s*['"]?\/[^)'"]*\.(?:jpe?g|png|webp|avif|gif)/i;

function bytes(rel: string): number {
  const full = join(PUBLIC, rel.replace(/^\//, ''));
  return existsSync(full) ? statSync(full).size : 0;
}

/** What a browser that takes AVIF actually downloads for a given JPEG path. */
function deliveredBytes(jpegPath: string): number {
  const avif = jpegPath.replace(/\.jpe?g$/i, '.avif');
  const n = bytes(avif);
  return n > 0 ? n : bytes(jpegPath);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe('image weight budgets', () => {
  it.each(IMAGE_FREE_PAGES)('%s ships no photograph', (page) => {
    const src = readFileSync(join(ROOT, page), 'utf8');
    const match = src.match(RASTER_REFERENCE);

    /*
      This is F2's guard. The room on these surfaces is `.service-bay`, drawn
      in CSS at zero bytes; the moment someone reaches for a photograph again
      they get a red test naming the file rather than a silent 480 KB.
    */
    expect(match?.[0] ?? null).toBeNull();
  });

  it('the garage grid stays under 250 KB as actually delivered', () => {
    const total = gridCardSources().reduce((sum, p) => sum + deliveredBytes(p), 0);

    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(250 * 1024);
  });

  it('the grid is materially lighter in AVIF than the JPEG fallback', () => {
    const cards = gridCardSources();
    const avif = cards.reduce((s, p) => s + deliveredBytes(p), 0);
    const jpeg = cards.reduce((s, p) => s + bytes(p), 0);

    /*
      Guards the derivatives silently disappearing: `deliveredBytes` falls back
      to the JPEG, so a missing `.avif` would make this ratio exactly 1.

      2x, not the 3.7x the whole set averages. These are the 800px card
      derivatives, and small images compress relatively worse — there is less
      redundancy for AVIF to find, and the container overhead is a larger share
      of a 22 KB file than of a 278 KB one. Measured 2.55x here against 3.7x
      across all twelve, which is why a set-wide figure is the wrong threshold
      for a grid of cards.
    */
    expect(jpeg / avif).toBeGreaterThan(2);
  });

  it('every committed JPEG has both derivatives beside it', () => {
    const jpegs = walk(join(PUBLIC, 'vehicles')).filter((f) => /\.jpe?g$/i.test(f));
    const missing = jpegs
      .flatMap((f) => [f.replace(/\.jpe?g$/i, '.avif'), f.replace(/\.jpe?g$/i, '.webp')])
      .filter((f) => !existsSync(f))
      .map((f) => f.replace(ROOT + '/', ''));

    expect(missing).toEqual([]);
  });

  it('the heaviest single photograph stays under 400 KB delivered', () => {
    const jpegs = walk(join(PUBLIC, 'vehicles')).filter((f) => /\.jpe?g$/i.test(f));
    const worst = jpegs
      .map((f) => ({
        file: f.replace(ROOT + '/', ''),
        delivered: deliveredBytes(f.replace(PUBLIC, '')),
      }))
      .sort((a, b) => b.delivered - a.delivered)[0];

    expect(worst.delivered).toBeLessThan(400 * 1024);
  });

  it('blur-up placeholders stay small enough to inline', () => {
    const total = Object.values(VEHICLE_BLUR_DATA).reduce((s, d) => s + d.length, 0);

    // They ship inside the JS bundle, so this is a byte cost on every page
    // that renders a vehicle. 32px WebP measured ~3 KB for the whole set.
    expect(Object.keys(VEHICLE_BLUR_DATA).length).toBeGreaterThan(0);
    expect(total).toBeLessThan(12 * 1024);
  });
});
