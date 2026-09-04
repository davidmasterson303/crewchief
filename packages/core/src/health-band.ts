/**
 * Health-score banding — the judgement, without the styling.
 *
 * ── Why this is in core ─────────────────────────────────────────────────────
 *
 * `hooks/use-health-band.ts` already existed to stop two web components banding
 * a score differently on the same screen. Its own note is the rule: the short
 * form is "an **abbreviation, never a different judgement**".
 *
 * Phase 3.2 puts a third renderer on the same number — the Expo garage — and it
 * cannot import that hook. Not because of `'use client'`, but because every
 * presentational field in it is web-only: `color` is a `var(--ring-good)`
 * reference resolved by globals.css, and `textClass` is a Tailwind class that
 * only exists if Tailwind saw the literal. React Native has neither a CSS custom
 * property nor a Tailwind build.
 *
 * Copying the thresholds into the mobile app is how the two-components bug
 * comes back at two-clients scale, and it would be worse there: the drift would
 * be invisible until someone compared a phone with a laptop side by side.
 *
 * So the split is by *nature*, not by convenience. What a score **means** —
 * where the boundaries fall, what to call it — is product judgement and lives
 * here. How that reads on a given platform is presentation and stays with the
 * platform. `rgb` sits on this side because bare `r,g,b` channels are a colour
 * value rather than a styling mechanism; both clients build their own
 * expression from them (`rgba()` on web, a hex or object on RN).
 *
 * ── Changing a threshold ────────────────────────────────────────────────────
 *
 * Change it here and every client moves together. That is the point, and it is
 * also the hazard: there is no longer a way to adjust the web ramp alone. If a
 * platform ever genuinely needs a different boundary, that is a product
 * decision and belongs in the roadmap, not in a local constant.
 */

export type HealthBandName = 'good' | 'ok' | 'warn' | 'bad';

export interface HealthBandJudgement {
  name: HealthBandName;
  /** Bare `r,g,b` channels. No platform assumption — each client wraps it. */
  rgb: string;
  /** Canonical wording. Used anywhere with room to render it. */
  label: string;
  /**
   * The same band, abbreviated, for tight layouts like the garage card's 56px
   * ring where "Needs attention" will not fit.
   *
   * An abbreviation, never a different judgement. `label` is canonical and was
   * set deliberately conservative — see below — and shortening must not walk
   * that back.
   */
  short: string;
}

/*
 * Labels are deliberately conservative. An earlier ramp called anything from 60
 * up "Good", so a 61 — a car with real deferred maintenance — read as
 * reassuring. For a tool whose job is telling you what needs attention,
 * overstating condition is the more costly direction to be wrong in.
 *
 * Thresholds have not moved; the words moved down a step.
 */
const BANDS: ReadonlyArray<HealthBandJudgement & { min: number }> = [
  { min: 80, name: 'good', rgb: '127,206,156', label: 'Good', short: 'Good' },
  /*
    ⚠ `185,199,126`, not the old `95,174,192`. That was a desaturated cyan, and
    cyan is the product's accent — so "Fair" wore the same hue as every link
    and the active tab, and a 48px cyan score sat under a cyan tab meaning
    something else entirely. The ramp now reads green → yellow-green → orange →
    red without a legend. `app/globals.css` carries the full note at
    `--ring-ok`, and the two must move together.
  */
  { min: 60, name: 'ok', rgb: '185,199,126', label: 'Fair', short: 'Fair' },
  { min: 40, name: 'warn', rgb: '224,164,104', label: 'Needs attention', short: 'Attention' },
  { min: -Infinity, name: 'bad', rgb: '224,136,130', label: 'Critical', short: 'Critical' },
];

/**
 * Resolve a score to its band. Pure — safe during render, and usable outside
 * React on either platform.
 *
 * Always band from the *target* score, never from an animating value, or the
 * colour cycles red → amber → green while a ring draws in.
 */
export function getHealthBandJudgement(score: number): HealthBandJudgement {
  return BANDS.find((band) => score >= band.min) ?? BANDS[BANDS.length - 1];
}

/** `#rrggbb` for callers with no `rgba()` — React Native's StyleSheet, mainly. */
export function healthBandHex(band: HealthBandJudgement): string {
  const hex = band.rgb
    .split(',')
    .map((channel) => Number(channel.trim()).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}
