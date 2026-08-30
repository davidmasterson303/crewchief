'use client';

/**
 * Downscale and re-encode a photo in the browser, before it is uploaded.
 *
 * ── Why this is not optional polish ─────────────────────────────────────────
 *
 * Uploads went to storage as the browser received them. A modern phone camera
 * produces 3–6 MB at 4032×3024, and every one of those bytes was stored,
 * signed, and sent back down to fill a 400px box. The garage derivatives fixed
 * that for the three demo cars; this is the same problem for every real user,
 * and it is the larger half.
 *
 * It also removes a bug rather than only a cost. The dialog rejected anything
 * over 5 MB, which is a perfectly ordinary photo off a recent iPhone: the user
 * was told their picture was too big with no way to proceed. Downscaling first
 * means the limit can be a sanity ceiling instead of a wall.
 *
 * ── EXIF orientation, which is where this normally goes wrong ───────────────
 *
 * A phone photo is almost always stored landscape with an orientation flag
 * telling the viewer to rotate it. Drawing it to a canvas *ignores that flag*,
 * so the naive version of this function silently rotates every portrait upload
 * by 90°. `createImageBitmap(..., { imageOrientation: 'from-image' })` applies
 * it; the `<img>` fallback below gets it for free because the browser has
 * already applied orientation by the time the element reports its size.
 *
 * ── It is allowed to give up ────────────────────────────────────────────────
 *
 * Every failure path returns the original file. A photo that uploads at full
 * size is a cost; a photo that fails to upload is a broken feature. Nothing
 * here is worth failing an upload over.
 */

import {
  MAX_EDGE,
  TARGET_BYTES,
  QUALITY_LADDER,
  fitWithin,
  isWorthKeeping,
  shouldAcceptEncoding,
  downscaledFileName,
} from '@wellkept/core/image-resize';

/** WebP where available, JPEG otherwise. Decided once, by asking the canvas. */
function pickEncoding(canvas: HTMLCanvasElement): string {
  // Safari gained canvas WebP export in 14; older builds silently hand back a
  // PNG data URL instead of refusing, so the answer has to be read from the
  // result rather than assumed from the request.
  const probe = canvas.toDataURL('image/webp');
  return probe.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Decode to something drawable, with orientation applied. */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through — some browsers reject the options bag rather than
      // ignoring it, and that must not cost us the upload.
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Returns a downscaled copy, or the original file when downscaling would not
 * help or could not be done.
 */
export async function downscaleImage(
  file: File,
  { maxEdge = MAX_EDGE, targetBytes = TARGET_BYTES }: { maxEdge?: number; targetBytes?: number } = {}
): Promise<File> {
  if (typeof document === 'undefined') return file;

  const decoded = await decode(file);
  if (!decoded || decoded.width <= 0 || decoded.height <= 0) return file;

  const { width, height } = fitWithin(
    { width: decoded.width, height: decoded.height },
    maxEdge
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  // Meaningful on the big reductions this does — the default filter on a 4x
  // downscale aliases badly on grilles, spoke wheels and number plates.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.source, 0, 0, width, height);

  if ('close' in decoded.source && typeof decoded.source.close === 'function') {
    decoded.source.close();
  }

  const mimeType = pickEncoding(canvas);

  let best: Blob | null = null;
  for (let i = 0; i < QUALITY_LADDER.length; i++) {
    const blob = await toBlob(canvas, mimeType, QUALITY_LADDER[i]);
    if (!blob) break;

    best = blob;
    if (shouldAcceptEncoding(blob.size, i, targetBytes)) break;
  }

  if (!best || !isWorthKeeping(best.size, file.size)) return file;

  return new File([best], downscaledFileName(file.name, mimeType), {
    type: mimeType,
    lastModified: Date.now(),
  });
}
