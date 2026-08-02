#!/usr/bin/env node
/*
  Emit AVIF and WebP next to every demo JPEG.

  The audit that prompted this recommended adding modern formats to
  `photography/build_assets.py`, "which already regenerates all derivatives from
  masters". No such file exists, and never has — the derivative convention in
  `public/vehicles/CREDITS.md` is a set of hand-run `sips` commands. So this is
  that script, written rather than amended.

  Re-encoding the JPEGs was measured first and is a dead end: they are already
  tight. `sips -s formatOptions 72` on the 861 KB WRX hero produces 878 KB —
  *larger*. There is nothing left in JPEG, which is what makes the format change
  the only real move. Same frame, same crop, same pixels; AVIF q58 takes that
  861 KB to 283 KB.

  Sources are the JPEGs in `public/vehicles/`, which stay exactly as they are:
  they remain the fallback any browser without AVIF or WebP receives, and they
  remain what `public/vehicles/CREDITS.md` documents the provenance of. Nothing
  here re-crops or resizes — geometry is decided by the existing derivative
  sizes (`card-800`, `hero-3x2`, `portrait-3x4`, `detail-4x3`) and this only
  changes the container.

  Idempotent: a derivative newer than its source is left alone, so re-running is
  free. Pass --force to rebuild regardless.

    node scripts/build-image-derivatives.mjs [--force]

  `sharp` is a devDependency and is not needed to build or run the app — the
  outputs are committed, exactly as the JPEG derivatives already are. Netlify
  never runs this.
*/

import { readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'public', 'vehicles');
const FORCE = process.argv.includes('--force');

/*
  Quality settings, chosen by measurement rather than by the encoders' defaults.

  AVIF 58 and WebP 76 are each the point where the file stops shrinking usefully
  before artefacts become visible on these photographs — dark cars, large flat
  panels, and a lot of sky, which is the content AVIF handles best and where
  banding shows first if pushed too far. Measured on the WRX hero, the worst
  case in the set at 861 KB: AVIF 50 gives 204 KB but bands the sky; 58 gives
  283 KB and does not.
*/
const AVIF = { quality: 58, effort: 6 };
const WEBP = { quality: 76, effort: 5 };

/*
  The blur-up placeholder, emitted as base64 into a generated module rather
  than as a file.

  `VehicleIdentity` paints every photograph twice — an over-scanned blurred
  fill under a contained sharp copy — which meant decoding the full-size image
  twice, on mobile, for a layer that is then blurred by 34px. That is F7. The
  fill only ever needed enough pixels to survive a 34px blur, and 32 of them
  across is more than enough: upscaled ten times and blurred, a 32px source and
  a 2400px source are indistinguishable.

  Inlined as a data URI because a placeholder that needs its own request is not
  a placeholder — it would arrive in the same round trip as the photo it exists
  to stand in for. At this size the whole set costs a few KB of JS.
*/
const BLUR_WIDTH = 32;
const BLUR = { quality: 60 };
const BLUR_MODULE = join(ROOT, 'packages', 'core', 'src', 'vehicle-blur.ts');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jpe?g$/i.test(entry)) out.push(full);
  }
  return out;
}

function isStale(source, derivative) {
  if (FORCE || !existsSync(derivative)) return true;
  return statSync(derivative).mtimeMs < statSync(source).mtimeMs;
}

const sources = walk(SOURCE_DIR).sort();
if (sources.length === 0) {
  console.error(`No JPEGs found under ${SOURCE_DIR}`);
  process.exit(1);
}

let totalJpeg = 0;
let totalAvif = 0;
let totalWebp = 0;
let built = 0;
let skipped = 0;
let totalBlur = 0;
const blurData = {};

for (const source of sources) {
  const stem = join(dirname(source), basename(source, extname(source)));
  const rel = source.replace(ROOT + '/', '');
  const jpegBytes = statSync(source).size;
  totalJpeg += jpegBytes;

  for (const [ext, encode] of [
    ['avif', (img) => img.avif(AVIF)],
    ['webp', (img) => img.webp(WEBP)],
  ]) {
    const target = `${stem}.${ext}`;
    if (isStale(source, target)) {
      await encode(sharp(source)).toFile(target);
      built += 1;
    } else {
      skipped += 1;
    }
    const bytes = statSync(target).size;
    if (ext === 'avif') totalAvif += bytes;
    else totalWebp += bytes;
  }

  const lqip = await sharp(source).resize(BLUR_WIDTH).webp(BLUR).toBuffer();
  blurData[`/${rel.replace(/^public\//, '')}`] = `data:image/webp;base64,${lqip.toString('base64')}`;
  totalBlur += lqip.length;

  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(
    `${rel.padEnd(38)} jpeg ${kb(jpegBytes).padStart(7)}` +
      `  avif ${kb(statSync(`${stem}.avif`).size).padStart(7)}` +
      `  webp ${kb(statSync(`${stem}.webp`).size).padStart(7)}`
  );
}

const entries = Object.keys(blurData)
  .sort()
  .map((k) => `  '${k}':\n    '${blurData[k]}',`)
  .join('\n');

writeFileSync(
  BLUR_MODULE,
  `/*
  GENERATED — do not edit. Rebuild with \`npm run build:images\`.

  A 32px WebP of each demo photograph, inlined as a data URI.

  \`VehicleIdentity\` paints its photo twice: an over-scanned blurred fill under
  a contained sharp copy. Before this, both layers decoded the same full-size
  file — the audit's F7, and worst on the phones least able to afford it. The
  fill is blurred by 34px, so it never needed those pixels; 32 across upscales
  and blurs to something the eye cannot tell from the original.

  Keyed by the JPEG's public path, which is what \`planVehiclePhoto\` returns
  for a demo vehicle. Owner uploads arrive as signed URLs and have no entry —
  callers fall back to the identity plate, which is already the design for a
  photograph that has not arrived.
*/

export const VEHICLE_BLUR_DATA: Record<string, string> = {
${entries}
};

/** The placeholder for a photo path, if one was built for it. */
export function vehicleBlurData(src: string | null | undefined): string | null {
  if (!src) return null;
  return VEHICLE_BLUR_DATA[src] ?? null;
}
`,
  'utf8'
);

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const pct = (a, b) => `${Math.round(100 - (100 * a) / b)}%`;
console.log(
  `\n${sources.length} sources — ${built} written, ${skipped} already current\n` +
    `jpeg ${mb(totalJpeg)}  avif ${mb(totalAvif)} (${pct(totalAvif, totalJpeg)} smaller)  ` +
    `webp ${mb(totalWebp)} (${pct(totalWebp, totalJpeg)} smaller)\n` +
    `blur-up placeholders: ${Math.round(totalBlur / 1024)} KB inlined across ${sources.length} images`
);
