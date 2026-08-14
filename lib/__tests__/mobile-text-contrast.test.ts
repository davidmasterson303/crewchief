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
 * ── What this suite structurally cannot see ────────────────────────────────
 *
 * Three things, and `apps/mobile/src/screens/__tests__/contrast.test.tsx`
 * covers them by mounting screens instead:
 *
 *   - **A colour that is not a literal.** `healthBandHex()` returns the health
 *     score's colour, so the largest number on two screens is invisible here.
 *   - **The surface behind the text.** This assumes `#080808`, and the regex
 *     below matches only `rgba(255,255,255,α)` — so the advisor CTA's
 *     near-black ink on a *white* button is not merely mismeasured, it is never
 *     examined. One such run shipped at **4.47:1** against a 4.5 floor, with a
 *     comment confidently claiming 8.6:1, and was caught only once a render
 *     test measured it against its real backdrop.
 *   - **Styles merged at runtime.** React Native flattens arrays and later
 *     entries win; each declaration is read here in isolation.
 *
 * Kept anyway: it covers **every** style in the app, including screens no
 * render test mounts, and it runs on every `npm test` from the repo root.
 * Neither suite is a superset of the other.
 *
 * ── The floor is the same number, deliberately ─────────────────────────────
 *
 * The web guard's `FLOOR = 50` means `text-white/50`. Measured against this
 * app's `surface.page` background, an alpha of **0.50 is 5.34:1** and **0.40 is
 * 3.81:1** — so `/50` is not a round number someone liked, it is the step that
 * clears 4.5:1 with the next one down failing.
 *
 * ⚠ Those figures moved on 14 Aug with the page. On the old `#080808` the pair
 * quoted here was 0.50 = 5.32:1 and 0.45 = 4.48:1; the warm graphite is
 * lighter, so 0.45 now composites to 4.53 and clears the floor. The floor did
 * not move — the backdrop did, and 40% is now the first step below it. The phone uses the same background and therefore the same
 * floor, and a client that quietly ran a laxer rule would be the drift the
 * shared-package work exists to prevent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { surface, text as textTokens } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/**
 * Every screen in this app renders on `surface.page`.
 *
 * ⚠ **Read from the theme, and no longer a single grey channel.** This was the
 * number `8` — the grey of `#080808` — with `contrastAgainstBackground` doing
 * grey-on-grey arithmetic. The v8 page is `#100F0D`, a warm graphite whose
 * three channels differ, so the old shortcut would have quietly reported the
 * wrong ratio for every site on every screen.
 */
const BACKGROUND: [number, number, number] = (() => {
  const [r, g, b] = (surface.page.replace('#', '').match(/../g) ?? []).map((h) => parseInt(h, 16));
  return [r, g, b];
})();

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

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** White text at `alpha`, composited over the page and measured in full RGB. */
function contrastAgainstBackground(alpha: number): number {
  const composited = BACKGROUND.map((c) => alpha * 255 + (1 - alpha) * c) as [
    number,
    number,
    number,
  ];
  const ink = relativeLuminance(composited);
  const background = relativeLuminance(BACKGROUND);
  const [lighter, darker] = ink > background ? [ink, background] : [background, ink];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolve `text.<name>` to the alpha it stands for, or `null`.
 *
 * ── Why this had to be added ────────────────────────────────────────────────
 *
 * This scanner only ever understood literals. The moment the token layer landed
 * and the last `rgba()` left the screens, it matched nothing — and its own
 * anti-vacuous guard caught that, which is the only reason it was noticed. "Has
 * no text below the floor" was still passing, on an empty scan.
 *
 * Only white-alpha tokens are resolvable to an alpha, which is exactly the
 * scope this suite always had: opaque tokens (`text.primary`, `text.disabled`)
 * were never in range, the first because it is far above the floor and the
 * second because WCAG 1.4.3 exempts it.
 */
function alphaOfToken(name: string): number | null {
  const value = (textTokens as Record<string, string>)[name];
  if (!value) return null;
  const match = /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)$/.exec(value);
  return match ? Number(match[1]) : null;
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
    /(\w+)\s*:\s*\{[^}]*?\bcolor:\s*(?:'rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)'|text\.(\w+))/g;

  const found: Site[] = [];
  for (const file of sourceFiles(MOBILE_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of Array.from(source.matchAll(pattern))) {
      const [, style, rawAlpha, token] = match;
      if (EXEMPT[style]) continue;

      const alpha = token ? alphaOfToken(token) : Number(rawAlpha);
      if (alpha === null) continue;
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
      /\bcolor:\s*(?:'rgba\(|text\.)/.test(readFileSync(file, 'utf8'))
    );
    expect(anyColour).toBe(true);

    // And that the resolver actually resolves, rather than returning null for
    // everything and reducing this suite to a very slow no-op.
    expect(alphaOfToken('muted')).toBe(0.5);
    expect(alphaOfToken('primary')).toBeNull();
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
    // 40%, not 45% — `text.nonText`, the hairline token that must never carry
    // a word. On this backdrop 45% clears the floor and is no longer a probe
    // for anything.
    expect(contrastAgainstBackground(0.4)).toBeLessThan(AA_NORMAL);
  });

  it('documents a reason for every exemption', () => {
    // An exemption list without reasons becomes a place to put inconvenient
    // failures. Each entry has to say which rule lets it through.
    for (const reason of Object.values(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});
