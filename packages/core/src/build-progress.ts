/**
 * How far a build has come — read as a position, never as a percentage.
 *
 * David, 7 Aug 2026: *"I don't like the idea of end states anymore. It's a
 * continuum. There's almost always something more you can do."* And then:
 * *"drop mild/moderate/extreme goals/tiers in favour of a continuum, showing
 * how far you've upgraded on some sort of sport dial."*
 *
 * ── The tension in the brief, and how this resolves it ──────────────────────
 *
 * A dial has a redline; a continuum does not. The resolution is that **a
 * tachometer does not show how much engine is left** — it shows where the
 * needle is now. So this reports a *position*, and deliberately never a
 * completion:
 *
 *   - No denominator. Nothing is "60% modified", because the set of things a
 *     car could have done to it is not a finite list we hold.
 *   - No terminal zone. `Built` is open-ended — the needle keeps climbing past
 *     it, the way a tacho reads past the redline.
 *   - Named regions rather than a number the owner has to interpret, in the
 *     shape `health-band.ts` already established: the band decides the word,
 *     and nothing hand-labels it.
 *
 * ── What the number is, and it is a first cut ───────────────────────────────
 *
 * Accumulated effort of what has actually been *completed*, weighted by the
 * difficulty the vehicle's own knowledge base assigned. Easy 1, Moderate 3,
 * Hard 6 — superlinear, because a built engine is not three air filters.
 *
 * **This is the part most likely to change**, and it is isolated here for that
 * reason. Estimated power gain would be the more meaningful axis and this
 * project does not hold trustworthy data for it; a plain count would make a
 * strut brace equal to a turbo. Weight-by-difficulty is the honest thing
 * available today rather than the best imaginable one.
 */

export type BuildZone = 'stock' | 'lightly-modified' | 'modified' | 'heavily-modified' | 'built';

export interface BuildPosition {
  /** Accumulated effort. Unbounded — there is no maximum by design. */
  points: number;
  zone: BuildZone;
  label: string;
  /**
   * Where to put the needle on a 0–100 dial.
   *
   * A rendering concern, not a score: the arc has to end somewhere even though
   * the build does not. It approaches 100 asymptotically and never reaches it,
   * so the dial always shows headroom — the visual statement of "there is
   * always something more you can do".
   */
  needle: number;
}

const EFFORT: Record<string, number> = { Easy: 1, Moderate: 3, Hard: 6 };

/**
 * Zone floors in points. Open-ended at the top on purpose — see the header.
 *
 * Tuned against the real cars: the WRX's five parts total 14 points, so a
 * complete pass of everything its knowledge base knows lands it in
 * `heavily-modified` with the dial still climbing. A car whose owner has gone
 * beyond what we listed reads `built`, which is the honest description of
 * somebody who has outrun the catalogue.
 */
const ZONES: Array<{ floor: number; zone: BuildZone; label: string }> = [
  { floor: 22, zone: 'built', label: 'Built' },
  { floor: 12, zone: 'heavily-modified', label: 'Heavily modified' },
  { floor: 5, zone: 'modified', label: 'Modified' },
  { floor: 1, zone: 'lightly-modified', label: 'Lightly modified' },
  { floor: 0, zone: 'stock', label: 'Stock' },
];

/**
 * The effort a single completed mod contributes.
 *
 * An unrecognised difficulty counts as `Moderate` rather than zero. A mod the
 * knowledge base described oddly is still work somebody did, and scoring it at
 * nothing would quietly punish the owners with the most unusual builds — the
 * same reasoning `classifyMod` uses for parts it cannot place.
 */
export function effortOf(difficulty: string | null | undefined): number {
  return EFFORT[difficulty ?? ''] ?? EFFORT.Moderate;
}

/**
 * Where this car sits.
 *
 * `completed` is the mods actually marked installed — not the wishlist, and not
 * what the knowledge base merely offers. A dial that moved when someone
 * *considered* a turbo would be measuring intent and calling it a build.
 */
export function buildPosition(
  completed: Array<{ difficulty?: string | null }>
): BuildPosition {
  const points = completed.reduce((sum, mod) => sum + effortOf(mod.difficulty), 0);
  const { zone, label } = ZONES.find((z) => points >= z.floor) ?? ZONES[ZONES.length - 1];

  return { points, zone, label, needle: needleFor(points) };
}

/**
 * Points → a 0–100 needle position that never arrives.
 *
 * `100 * (1 - e^(-points / 14))`. The constant is the WRX's full catalogue, so
 * completing everything that car's knowledge base knows about puts the needle
 * near 63 — visibly a long way along, visibly not finished. Nothing the owner
 * does will peg it, which is the point being made in glass rather than in copy.
 */
export function needleFor(points: number): number {
  if (points <= 0) return 0;

  /*
    Clamped to 99, and that is not belt-and-braces — the asymptote alone is not
    enough. `Math.exp(-points / 14)` underflows to 0 well before the inputs get
    absurd, and `Math.round` then returns exactly 100: a full arc, which is the
    completion this whole module exists to avoid claiming. Caught by the test
    named "never returns 100".
  */
  return Math.min(99, Math.round(100 * (1 - Math.exp(-points / 14))));
}

/** One line under the dial. Lives here so no caller invents its own wording. */
export function buildSummary(position: BuildPosition, remaining: number): string {
  if (position.zone === 'stock') {
    return remaining > 0
      ? 'Nothing recorded yet — the dial moves as you mark work installed.'
      : 'Nothing recorded yet.';
  }

  return remaining > 0
    ? `${position.label}. ${remaining} more ${remaining === 1 ? 'step' : 'steps'} on this car's list.`
    : `${position.label}. You have outrun this car's known list — the dial keeps going.`;
}
