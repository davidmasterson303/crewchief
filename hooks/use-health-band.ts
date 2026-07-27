'use client';

/**
 * The single source of truth for health-score banding.
 *
 * Two components render a health score on the dashboard — `DiagnosticHero`
 * (the large hero display) and `HealthSummary`'s `ScoreRing`. They previously
 * banded independently, with DiagnosticHero missing the ≥40 boundary entirely,
 * so the same score could be styled two different ways on one screen. Both now
 * read from here; changing a threshold changes both.
 *
 * The ramp is deliberately not the chip/badge semantics. Reusing those made a
 * mid-score ring read as "another issue chip" among the real ones — these are
 * the same four bands desaturated ~15% so a score reads as a gauge.
 */

export type HealthBandName = 'good' | 'ok' | 'warn' | 'bad';

export interface HealthBand {
  name: HealthBandName;
  /** CSS custom property reference — resolves through globals.css. */
  color: string;
  /** Bare `r,g,b` channels, for building rgba() shadows and tracks. */
  rgb: string;
  /** Qualitative wording shown beside the score. */
  label: string;
  /**
   * The same band, abbreviated — for the label under the garage card's 56px
   * ring, where "Needs attention" will not fit in a three-up grid.
   *
   * It is an **abbreviation, never a different judgement.** `label` is the
   * canonical wording and was set deliberately conservative (see below);
   * shortening it here must not walk that back. Everywhere with room uses
   * `label`.
   */
  short: string;
  /**
   * The text colour as a **literal** class.
   *
   * Callers used to build this as `text-health-${band.name}`. Tailwind only
   * ever sees literal strings, so three of the four never got generated and
   * the label silently fell back to inherited foreground — HealthSummary
   * printed "Fair" in plain white while DiagnosticHero printed the same score
   * in the band colour, on the same dashboard.
   *
   * Spelling them out is what makes them real. Do not reconstruct this from
   * `name`.
   */
  textClass: string;
}

/*
 * Labels are deliberately conservative. The previous ramp called anything
 * from 60 up "Good", so a 61 — a car with real deferred maintenance — read
 * as reassuring. For a tool whose job is telling you what needs attention,
 * overstating condition is the more costly direction to be wrong in.
 *
 * Thresholds are unchanged; only the words moved down a step.
 */
const BANDS: ReadonlyArray<HealthBand & { min: number }> = [
  { min: 80, name: 'good', color: 'var(--ring-good)', rgb: '127,206,156', label: 'Good', short: 'Good', textClass: 'text-health-good' },
  { min: 60, name: 'ok', color: 'var(--ring-ok)', rgb: '95,174,192', label: 'Fair', short: 'Fair', textClass: 'text-health-ok' },
  { min: 40, name: 'warn', color: 'var(--ring-warn)', rgb: '224,164,104', label: 'Needs attention', short: 'Attention', textClass: 'text-health-warn' },
  { min: -Infinity, name: 'bad', color: 'var(--ring-bad)', rgb: '224,136,130', label: 'Critical', short: 'Critical', textClass: 'text-health-bad' },
];

/**
 * Resolve a score to its band. Pure — safe to call during render, and usable
 * outside React.
 *
 * Always band from the *target* score, never from an animating value, or the
 * colour cycles red → amber → green while a ring draws in.
 */
export function getHealthBand(score: number): HealthBand {
  return BANDS.find((band) => score >= band.min) ?? BANDS[BANDS.length - 1];
}

export function useHealthBand(score: number): HealthBand {
  return getHealthBand(score);
}
