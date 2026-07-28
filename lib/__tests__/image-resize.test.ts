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
  MAX_EDGE,
  TARGET_BYTES,
  QUALITY_LADDER,
} from '@crewchief/core/image-resize';

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
