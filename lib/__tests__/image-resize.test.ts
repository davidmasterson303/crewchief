/**
 * The arithmetic behind downscaling an upload.
 *
 * The canvas encode itself needs a browser and is not tested here. What is
 * tested is every decision around it, because those are the ones that fail
 * quietly: an image that gets *bigger*, a portrait that comes back as a
 * 1-pixel sliver, a WebP blob stored under a `.jpg` name that then refuses to
 * render. None of those throw. All of them ship.
 */

import {
  fitWithin,
  isWorthKeeping,
  shouldAcceptEncoding,
  downscaledFileName,
  isDownscalableImage,
  checkStoredPhotoSize,
  MAX_STORED_PHOTO_BYTES,
  MAX_EDGE,
  TARGET_BYTES,
  QUALITY_LADDER,
  DOC_MAX_EDGE,
  DOC_TARGET_BYTES,
} from '@wellkept/core/image-resize';

describe('fitWithin', () => {
  it('scales a landscape phone photo down to the long edge', () => {
    // 4032x3024 is the standard iPhone 4:3 capture.
    expect(fitWithin({ width: 4032, height: 3024 })).toEqual({ width: 1600, height: 1200 });
  });

  it('scales a portrait photo by its own long edge', () => {
    // The common case for a car photo taken in a hurry, and the one a naive
    // `maxEdge / width` gets wrong.
    expect(fitWithin({ width: 3024, height: 4032 })).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges an image that is already small', () => {
    // The naive `scale = maxEdge / longEdge` upscales here, producing a bigger
    // file that looks worse than the input.
    expect(fitWithin({ width: 800, height: 533 })).toEqual({ width: 800, height: 533 });
    expect(fitWithin({ width: 100, height: 100 })).toEqual({ width: 100, height: 100 });
  });

  it('leaves an image exactly at the bound alone', () => {
    expect(fitWithin({ width: MAX_EDGE, height: 900 })).toEqual({ width: MAX_EDGE, height: 900 });
  });

  it('preserves aspect ratio closely enough not to letterbox', () => {
    const { width, height } = fitWithin({ width: 6000, height: 4000 });
    expect(Math.abs(width / height - 6000 / 4000)).toBeLessThan(0.01);
  });

  it('never produces a zero-width or zero-height canvas', () => {
    // A panorama: 20000x1 scales to a height of 0.08px, which floors to 0 and
    // makes the canvas zero-area. drawImage then throws or produces nothing.
    const out = fitWithin({ width: 20000, height: 1 });
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });

  it('refuses to do arithmetic on a degenerate image', () => {
    expect(fitWithin({ width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
    expect(fitWithin({ width: -10, height: 5 })).toEqual({ width: 0, height: 0 });
  });

  it('honours a custom bound', () => {
    expect(fitWithin({ width: 4000, height: 2000 }, 800)).toEqual({ width: 800, height: 400 });
  });
});

describe('isWorthKeeping', () => {
  it('keeps a genuinely smaller re-encode', () => {
    expect(isWorthKeeping(140 * 1024, 4 * 1024 * 1024)).toBe(true);
  });

  it('rejects a re-encode that came back larger', () => {
    // Real and common: an already-optimised export or a screenshot round-trips
    // to something bigger. Uploading it would make the feature harmful.
    expect(isWorthKeeping(220 * 1024, 180 * 1024)).toBe(false);
  });

  it('rejects a saving too small to be worth losing the original for', () => {
    expect(isWorthKeeping(98, 100)).toBe(false);
  });

  it('rejects an empty blob', () => {
    expect(isWorthKeeping(0, 1000)).toBe(false);
  });
});

describe('shouldAcceptEncoding', () => {
  it('stops as soon as the attempt is under target', () => {
    expect(shouldAcceptEncoding(TARGET_BYTES - 1, 0)).toBe(true);
  });

  it('keeps trying while over target and rungs remain', () => {
    expect(shouldAcceptEncoding(TARGET_BYTES * 3, 0)).toBe(false);
    expect(shouldAcceptEncoding(TARGET_BYTES * 3, 1)).toBe(false);
  });

  it('accepts the last rung even when still over target', () => {
    // A photo slightly over budget beats no photo, and beats descending into
    // quality low enough to visibly wreck a car's paint.
    expect(shouldAcceptEncoding(TARGET_BYTES * 3, QUALITY_LADDER.length - 1)).toBe(true);
  });

  it('has a ladder that only ever descends and stops above 0.5', () => {
    for (let i = 1; i < QUALITY_LADDER.length; i++) {
      expect(QUALITY_LADDER[i]).toBeLessThan(QUALITY_LADDER[i - 1]);
    }
    expect(Math.min(...QUALITY_LADDER)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('downscaledFileName', () => {
  it('follows the encoded type, not the original extension', () => {
    // A WebP blob named .jpg is served with the wrong Content-Type by anything
    // sniffing the extension, and then will not render.
    expect(downscaledFileName('IMG_4821.HEIC', 'image/webp')).toBe('IMG_4821.webp');
    expect(downscaledFileName('photo.png', 'image/jpeg')).toBe('photo.jpg');
  });

  it('handles a name with dots in it', () => {
    expect(downscaledFileName('my.car.photo.jpeg', 'image/webp')).toBe('my.car.photo.webp');
  });

  it('handles a name with no extension', () => {
    expect(downscaledFileName('screenshot', 'image/webp')).toBe('screenshot.webp');
  });

  it('never returns a bare extension for a nameless file', () => {
    expect(downscaledFileName('', 'image/webp')).toBe('photo.webp');
    expect(downscaledFileName('.jpg', 'image/webp')).toBe('photo.webp');
  });
});

describe('isDownscalableImage', () => {
  it('accepts the formats a phone camera actually produces', () => {
    expect(isDownscalableImage('image/jpeg')).toBe(true);
    expect(isDownscalableImage('image/png')).toBe(true);
    expect(isDownscalableImage('image/heic')).toBe(true);
    expect(isDownscalableImage('image/webp')).toBe(true);
  });

  it('refuses a PDF', () => {
    // The document path accepts these, and rasterising one would destroy it.
    // `downscaleImage` would also fail to decode it and hand the original back,
    // but that is a failure path holding up a requirement.
    expect(isDownscalableImage('application/pdf')).toBe(false);
  });

  it('refuses SVG, which decodes fine and must still be left alone', () => {
    // The one case that would pass a naive `startsWith('image/')` and be wrong:
    // rasterising a vector discards the property that made it small.
    expect(isDownscalableImage('image/svg+xml')).toBe(false);
  });

  it('refuses an absent or unrecognised type', () => {
    // Browsers hand back '' for a file they cannot type, and a drag-drop from
    // some clients gives 'application/octet-stream' for a perfectly good JPEG.
    // Both are left alone: the cost of skipping a reduction is money, and the
    // cost of feeding an unknown blob to a canvas is the upload.
    expect(isDownscalableImage('')).toBe(false);
    expect(isDownscalableImage('application/octet-stream')).toBe(false);
  });
});

describe('document bounds', () => {
  it('gives a document more pixels than a photograph', () => {
    // This relationship *is* the requirement. A photo is bounded by the box it
    // is displayed in; a document is bounded by the smallest glyph the
    // extractor has to resolve. If someone ever collapses these to one
    // constant, that is the decision being reversed.
    expect(DOC_MAX_EDGE).toBeGreaterThan(MAX_EDGE);
  });

  it('still reduces a standard phone capture substantially', () => {
    // 4032x3024 in, 2048x1536 out — a 4x cut in pixel count, which is what the
    // token bill is charged against.
    expect(fitWithin({ width: 4032, height: 3024 }, DOC_MAX_EDGE)).toEqual({
      width: 2048,
      height: 1536,
    });
  });

  it('lets an ordinary invoice stop on the first quality rung', () => {
    // The point of the larger byte budget: a 2048px invoice at 0.82 lands
    // around 300-450 KB, and must be accepted there rather than walking down
    // the ladder into the range where JPEG starts eating thin strokes.
    expect(shouldAcceptEncoding(450 * 1024, 0, DOC_TARGET_BYTES)).toBe(true);
    expect(DOC_TARGET_BYTES).toBeGreaterThan(TARGET_BYTES);
  });

  it('still descends for a document that genuinely overshoots', () => {
    // The budget is generous, not absent.
    expect(shouldAcceptEncoding(900 * 1024, 0, DOC_TARGET_BYTES)).toBe(false);
  });
});

describe('checkStoredPhotoSize', () => {
  /*
    The bound that did not exist. `uploadVehiclePhoto` read a file and put it in
    the bucket; the only thing keeping stored photos small was `downscaleImage`
    running in the browser, which is explicitly allowed to give up and return
    the original. The sole guarantee lived in code designed not to guarantee.

    Measured against live storage on 2 Aug: the one real stored photo is
    2,328,761 bytes, uploaded sixteen hours before the client downscale landed.
    Every viewer of that car downloads all of it for a card 172 points tall.
  */
  it('accepts a photo the client actually processed', () => {
    // TARGET_BYTES is 150 KB, so a successful downscale lands an order of
    // magnitude inside the ceiling.
    expect(checkStoredPhotoSize(TARGET_BYTES).ok).toBe(true);
    expect(checkStoredPhotoSize(400 * 1024).ok).toBe(true);
  });

  it('refuses the file that is actually in the bucket today', () => {
    const result = checkStoredPhotoSize(2_328_761);

    expect(result.ok).toBe(false);
  });

  it('tells the user the number and what to do about it', () => {
    /*
      "Too large" with no figure produces a support conversation instead of a
      retry. The message has to carry the size, the limit and a next step.
    */
    const result = checkStoredPhotoSize(2_328_761);

    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toContain('2.2 MB');
    expect(result.reason).toContain('1.5 MB');
    expect(result.reason).toMatch(/try a different photo|smaller export/i);
  });

  it('accepts a file whose size is unknown', () => {
    /*
      Fails open on missing information, like every other guard added today. A
      absent `size` is not evidence of the harm this bound exists to stop, and
      refusing on it would break uploads for a reason nobody could diagnose.
    */
    expect(checkStoredPhotoSize(0).ok).toBe(true);
    expect(checkStoredPhotoSize(NaN).ok).toBe(true);
    expect(checkStoredPhotoSize(undefined as unknown as number).ok).toBe(true);
  });

  it('leaves an order of magnitude of headroom over a processed photo', () => {
    // If this ratio ever collapses, the ceiling has stopped being a backstop
    // against a broken downscale and started rejecting ordinary photos.
    expect(MAX_STORED_PHOTO_BYTES / TARGET_BYTES).toBeGreaterThan(5);
  });
});
