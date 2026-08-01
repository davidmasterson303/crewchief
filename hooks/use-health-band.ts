'use client';

/**
 * Health-score banding, dressed for the web.
 *
 * Two components render a health score on the dashboard — `DiagnosticHero`
 * (the large hero display) and `HealthSummary`'s `ScoreRing`. They previously
 * banded independently, with DiagnosticHero missing the ≥40 boundary entirely,
 * so the same score could be styled two different ways on one screen.
 *
 * **The thresholds and wording now live in `@crewchief/core/health-band`**, so
 * the Expo garage bands a score the same way this does. Neither of the two
 * fields added here can cross that boundary: `color` is a CSS custom property
 * resolved by globals.css, and `textClass` is a Tailwind class. This module is
 * the web's presentation of a shared judgement — it must not redefine the
 * judgement.
 *
 * The ramp is deliberately not the chip/badge semantics. Reusing those made a
 * mid-score ring read as "another issue chip" among the real ones — these are
 * the same four bands desaturated ~15% so a score reads as a gauge.
 */

import {
  getHealthBandJudgement,
  type HealthBandJudgement,
  type HealthBandName,
} from '@crewchief/core/health-band';

export type { HealthBandName };

export interface HealthBand extends HealthBandJudgement {
  /** CSS custom property reference — resolves through globals.css. */
  color: string;
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
   * `name`, and note that the same trap is why this map is keyed by an
   * exhaustive `Record` rather than built with a template string.
   */
  textClass: string;
}

/*
 * Web dressing per band. Keyed by name so adding a band to core fails the
 * typecheck here rather than silently rendering unstyled — the Record is
 * exhaustive over HealthBandName.
 */
const WEB_STYLING: Record<HealthBandName, { color: string; textClass: string }> = {
  good: { color: 'var(--ring-good)', textClass: 'text-health-good' },
  ok: { color: 'var(--ring-ok)', textClass: 'text-health-ok' },
  warn: { color: 'var(--ring-warn)', textClass: 'text-health-warn' },
  bad: { color: 'var(--ring-bad)', textClass: 'text-health-bad' },
};

/**
 * Resolve a score to its band. Pure — safe to call during render, and usable
 * outside React.
 *
 * Always band from the *target* score, never from an animating value, or the
 * colour cycles red → amber → green while a ring draws in.
 */
export function getHealthBand(score: number): HealthBand {
  const judgement = getHealthBandJudgement(score);
  return { ...judgement, ...WEB_STYLING[judgement.name] };
}

export function useHealthBand(score: number): HealthBand {
  return getHealthBand(score);
}
