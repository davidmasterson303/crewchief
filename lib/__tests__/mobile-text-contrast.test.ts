/**
 * The AA contrast floor applies to the phone too.
 *
 * @jest-environment node
 *
 * `78eba74` made the floor a rule rather than a memory, because item 17 raised
 * 157 web text sites to `/50` on 2 Aug and the front door shipped four
 * sub-floor sites the next day. `text-contrast-floor.test.ts` is the guard that
 * came out of it — and it scans **`app/` and `components/` only**.
 *
 * So the entire Expo client has been outside the rule since Phase 3.1. Not by
 * decision: that suite reads Tailwind class names (`text-white/45`), and React
 * Native has no Tailwind build. The colour is an `rgba()` string in a
 * `StyleSheet`, which its regex cannot see and never claimed to.
 *
 * By 5 Aug that had produced nine sub-floor text styles across four screens,
 * two of them written the same day by the session that added this file.
 *
 * ── The floor is the same number, deliberately ─────────────────────────────
 *
 * The web guard's `FLOOR = 50` means `text-white/50`. Measured against this
 * app's `#080808` background, an alpha of **0.50 is 5.32:1** and **0.45 is
 * 4.48:1** — so `/50` is not a round number someone liked, it is the first step
 * that clears 4.5:1. The phone uses the same background and therefore the same
 * floor, and a client that quietly ran a laxer rule would be the drift the
 * shared-package work exists to prevent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/** Every screen in this app renders on `#080808`. */
const BACKGROUND = 8;

/** WCAG 2.1 AA, normal-size text. */
const AA_NORMAL = 4.5;

/**
 * Text styles exempt from the floor, each with the reason it qualifies.
 *
 * **Only WCAG's own exemption counts here.** 1.4.3 excludes text that is part
 * of an *inactive* user-interface component — a disabled control is meant to
 * read as unavailable, and raising it would make a dead button look live. A
 * style is not exempt for being small, secondary, or aesthetically quiet.
 */
const EXEMPT: Record<string, string> = {
  disabledText:
    'WCAG 1.4.3 exempts inactive components — applied to "Done" only while a ' +
    'deletion is in flight, and raising it would make a disabled control look ' +
    'available.',
};

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Grey-on-grey only, which is every text colour in this app that uses alpha. */
function contrastAgainstBackground(alpha: number): number {
  const composited = alpha * 255 + (1 - alpha) * BACKGROUND;
  const text = channelLuminance(composited);
  const background = channelLuminance(BACKGROUND);
  const [lighter, darker] = text > background ? [text, background] : [background, text];
  return (lighter + 0.05) / (darker + 0.05);
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

interface Site {
  file: string;
  style: string;
  alpha: number;
  ratio: number;
}

/**
 * Find `<styleName>: { color: 'rgba(255,255,255,<alpha>)'` sites.
 *
 * **`color:` specifically, not any rgba.** Borders and backgrounds live at low
 * alpha throughout this app entirely legitimately — `rgba(255,255,255,0.06)` is
 * a card fill, not text — and a guard that flagged them would be turned off
 * within a week, which is how a rule stops being a rule.
 */
function subFloorSites(): Site[] {
  const pattern =
    /(\w+)\s*:\s*\{[^}]*?\bcolor:\s*'rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)'/g;

  const found: Site[] = [];
  for (const file of sourceFiles(MOBILE_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of Array.from(source.matchAll(pattern))) {
      const [, style, rawAlpha] = match;
      if (EXEMPT[style]) continue;

      const alpha = Number(rawAlpha);
      const ratio = contrastAgainstBackground(alpha);
      if (ratio < AA_NORMAL) {
        found.push({ file: file.slice(MOBILE_SRC.length + 1), style, alpha, ratio });
      }
    }
  }
  return found;
}

describe('mobile text contrast', () => {
  it('finds text styles to check at all', () => {
    // Guards the guard. A regex that silently matched nothing would make the
    // assertion below pass vacuously forever — which is precisely how the web
    // suite's blind spot went unnoticed for four days.
    const anyColour = sourceFiles(MOBILE_SRC).some((file) =>
      /\bcolor:\s*'rgba\(/.test(readFileSync(file, 'utf8'))
    );
    expect(anyColour).toBe(true);
  });

  it('has no text below the AA floor', () => {
    expect(
      subFloorSites().map((s) => `${s.file} ${s.style} @${s.alpha} = ${s.ratio.toFixed(2)}:1`)
    ).toEqual([]);
  });

  it('agrees with the web guard about where the floor is', () => {
    // The web suite's FLOOR = 50 and this file's 4.5:1 have to keep meaning the
    // same thing. If either moves, this is the assertion that notices.
    expect(contrastAgainstBackground(0.5)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastAgainstBackground(0.45)).toBeLessThan(AA_NORMAL);
  });

  it('documents a reason for every exemption', () => {
    // An exemption list without reasons becomes a place to put inconvenient
    // failures. Each entry has to say which rule lets it through.
    for (const reason of Object.values(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});
