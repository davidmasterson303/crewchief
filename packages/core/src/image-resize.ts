/**
 * The arithmetic behind downscaling an upload. No DOM, no canvas.
 *
 * The encoding itself needs a browser (see `lib/image-downscale.ts`), but the
 * decisions — how far to scale, which quality to try next, whether the result
 * is even worth keeping — are pure, and they are the part that can be wrong in
 * ways nobody notices. So they live here where they can be tested.
 */

/** Long edge, in pixels, that an uploaded photo is reduced to. */
export const MAX_EDGE = 1600;

/** What a re-encoded photo should come in under. */
export const TARGET_BYTES = 150 * 1024;

/**
 * Long edge for a *document* — an invoice photographed to be read, not a car
 * photographed to be looked at.
 *
 * Deliberately larger than `MAX_EDGE`, and the gap is the whole point of having
 * two numbers. The photo bound is set by the ~400px box the result is displayed
 * in; nobody inspects a car's paint at 1:1. A document is read by the vision
 * model, and what it has to resolve is 8-point line-item text, part numbers and
 * prices. Those are exactly the characters that go first, and an extraction
 * reading `$1,180` as `$180` produces a service record that is wrong and
 * well-formed — the failure mode nothing downstream notices.
 */
export const DOC_MAX_EDGE = 2048;

/**
 * What a re-encoded document should come in under.
 *
 * Set high on purpose, so an ordinary invoice clears it on the ladder's *first*
 * rung and never walks down into the range where JPEG starts eating thin
 * strokes. `TARGET_BYTES` is small because a photo is served to a browser over
 * and over; a document is uploaded once, read once, and never sent back down.
 * The bill it drives is tokens, and tokens follow dimensions, not bytes — so
 * spending bytes to keep the glyphs intact costs nothing that matters.
 */
export const DOC_TARGET_BYTES = 500 * 1024;

/**
 * The largest a vehicle photo may be *as stored*.
 *
 * ── The defect this closes ──────────────────────────────────────────────────
 *
 * Nothing server-side bounded this. `uploadVehiclePhoto` read the file and put
 * it in the bucket, and the only thing keeping stored photos small was
 * `downscaleImage` running in the browser — which is explicitly designed to
 * give up and return the original on any failure, because a photo that uploads
 * large is better than a photo that fails to upload.
 *
 * That is the right call in the client and the wrong place for the only copy
 * of the rule. Measured 2 Aug against live storage: the one real stored photo
 * is **2,328,761 bytes**, uploaded sixteen hours before the client downscale
 * landed, and every viewer of that car downloads all of it to fill a card 172
 * points tall. On a phone that is the user's data allowance.
 *
 * ── Why a ceiling and not a server-side resize ──────────────────────────────
 *
 * The roadmap's fix is "sign a resized URL". **That is not available here** —
 * Supabase image transformation returns `FeatureNotEnabled` for this tenant,
 * verified against the live API rather than assumed from the plan page. Nor can
 * the server re-encode: `sharp` is a devDependency whose outputs are committed
 * precisely because Netlify never runs it.
 *
 * So the lever that exists is refusal, at the one chokepoint every upload
 * passes through.
 *
 * ── The number ──────────────────────────────────────────────────────────────
 *
 * `TARGET_BYTES` is 150 KB, so a photo the client processed successfully
 * arrives an order of magnitude under this. A file arriving above it means the
 * downscale did not run — a decode failure, or a caller that is not the dialog
 * — which is exactly the case worth refusing rather than storing forever.
 */
export const MAX_STORED_PHOTO_BYTES = 1_500 * 1024;

/**
 * Whether a file may be stored as a vehicle photo.
 *
 * Returns the reason rather than a boolean, because the caller has to tell the
 * user something they can act on — "too large" with no number is the kind of
 * error message that produces a support conversation instead of a retry.
 */
export function checkStoredPhotoSize(bytes: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    // Unknown size is not a reason to refuse. The bound exists to stop a
    // specific, measurable harm, and a missing `size` is not evidence of it.
    return { ok: true };
  }

  if (bytes <= MAX_STORED_PHOTO_BYTES) return { ok: true };

  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const maxMb = (MAX_STORED_PHOTO_BYTES / (1024 * 1024)).toFixed(1);

  return {
    ok: false,
    reason:
      `That photo is ${mb} MB, and the limit is ${maxMb} MB. ` +
      `Photos are normally shrunk in your browser before upload — if this one was not, ` +
      `try a different photo or a smaller export.`,
  };
}

/**
 * Whether an upload is a raster image this pipeline can usefully re-encode.
 *
 * The document path accepts PDFs as well as photographs. `downscaleImage` would
 * fail to decode a PDF and hand the original straight back, so the outcome is
 * the same without this check — but "the same either way" is a property of a
 * failure path, and a failure path is a poor place to keep a requirement that
 * matters. Ask the question where a reader can see it being asked.
 *
 * SVG is excluded for a different reason: it decodes perfectly well, and
 * rasterising it discards the one property that made it small.
 */
export function isDownscalableImage(mimeType: string): boolean {
  if (!mimeType.startsWith('image/')) return false;
  return mimeType !== 'image/svg+xml';
}

/**
 * Quality ladder for the encoder, tried in order.
 *
 * Descending, and it stops at 0.5 rather than continuing down. Below that the
 * artefacts on a photograph of a car — smooth panels, gradients in paint and
 * sky — are worse than the extra kilobytes, and a hero at 400px shows them.
 * If 0.5 still misses the target, the smallest attempt is kept anyway: a photo
 * slightly over budget beats no photo.
 */
export const QUALITY_LADDER = [0.82, 0.72, 0.62, 0.5] as const;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Fit dimensions within a maximum long edge, preserving aspect ratio.
 *
 * **Never enlarges.** An image already inside the bound is returned unchanged,
 * so a small photo is not upscaled into a bigger file that looks worse — which
 * is what a naive `scale = maxEdge / longEdge` does.
 */
export function fitWithin(
  { width, height }: Dimensions,
  maxEdge: number = MAX_EDGE
): Dimensions {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };

  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };

  const scale = maxEdge / longEdge;
  return {
    // Round rather than floor: flooring both axes on a 3:2 source can shift the
    // ratio enough to letterbox by a pixel, and `max(1, …)` keeps a degenerate
    // 1-pixel edge from becoming 0 and producing a zero-area canvas.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether a re-encoded candidate is worth keeping over the original file.
 *
 * Re-encoding does not always win. A photo already small and well compressed
 * can come back *larger* — the decode/encode round trip is not free, and a
 * screenshot or an already-optimised export is the common case. Uploading the
 * bigger one would make the feature actively harmful, so the original wins
 * ties and near-ties.
 *
 * The 5% margin exists because a trivial saving is not worth losing the
 * original's format and metadata for.
 */
export function isWorthKeeping(candidateBytes: number, originalBytes: number): boolean {
  if (candidateBytes <= 0) return false;
  return candidateBytes < originalBytes * 0.95;
}

/**
 * Whether encoding should stop, given what the last attempt produced.
 *
 * Split out from the loop so the stopping rule is visible and testable rather
 * than buried in an `if` inside an async retry.
 */
export function shouldAcceptEncoding(
  bytes: number,
  attemptIndex: number,
  targetBytes: number = TARGET_BYTES
): boolean {
  return bytes <= targetBytes || attemptIndex >= QUALITY_LADDER.length - 1;
}

/**
 * The stored filename for a downscaled upload.
 *
 * The extension has to follow the *encoded* type, not the original's. A WebP
 * blob stored as `.jpg` is served with the wrong `Content-Type` by anything
 * that sniffs the extension, and the browser then refuses to render an image
 * it can perfectly well decode.
 */
export function downscaledFileName(originalName: string, mimeType: string): string {
  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = originalName.replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.${ext}`;
}
