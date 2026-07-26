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
  { min: 80, name: 'good', color: 'var(--ring-good)', rgb: '127,206,156', label: 'Good' },
  { min: 60, name: 'ok', color: 'var(--ring-ok)', rgb: '95,174,192', label: 'Fair' },
  { min: 40, name: 'warn', color: 'var(--ring-warn)', rgb: '224,164,104', label: 'Needs attention' },
  { min: -Infinity, name: 'bad', color: 'var(--ring-bad)', rgb: '224,136,130', label: 'Critical' },
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
