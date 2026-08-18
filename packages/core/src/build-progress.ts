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

/**
 * ── The paint, as a judgement rather than as colours ────────────────────────
 *
 * `BuildGauge` has always chosen its ramp by branching on `needle` — 70, 40 and
 * 12 — and those three numbers lived in the component next to the CSS variables
 * they select. That was fine while one client drew this dial. It stops being
 * fine now that the phone draws it too: React Native has no `var(--build-far)`,
 * so the mobile gauge has to make the same choice from its own token layer, and
 * a second copy of `needle >= 70` is a second copy.
 *
 * The split is the one `health-band.ts` already argues. **Which region of the
 * continuum a reading falls in is product judgement and lives here.** What that
 * region looks like on a given platform is presentation and stays with the
 * platform — a CSS variable on web, a hex from `theme/` on the phone.
 *
 * ⚠ These are *needle* thresholds, not the point floors `ZONES` uses. They are
 * genuinely different scales and neither is derivable from the other: `ZONES`
 * bands accumulated effort, this bands the rendered position. Aligning them
 * would be a product decision about what the dial's colours mean, not a
 * tidy-up.
 */
export type BuildRamp = 'stock' | 'mild' | 'warm' | 'far';

/**
 * Where the redline starts, on the same 0–100 scale as the needle.
 *
 * One constant drives the painted band and the needle's colour, so the two
 * cannot drift — a redline drawn at 82 with a needle that turns at 85 would show
 * a pointer sitting in the red while still reading as normal, which is worse
 * than having no redline. Now one constant across both clients, for the same
 * reason at a larger scale.
 *
 * **This is not a fault threshold.** A redline means *near the limit of the
 * engine*. `needleFor` clamps at 99 and a complete pass of the WRX's entire
 * known catalogue lands near 63: visible from first launch, very nearly
 * unreachable.
 */
export const REDLINE_FROM = 82;

/**
 * The ramp region for a needle position.
 *
 * Warm as the build climbs, rather than the health palette's red-to-green.
 * **Nothing here is a failure state, so nothing is red** — cool steel for stock,
 * warming through to amber. A low reading is *stock*, not a fault, and colouring
 * it from the health ramp would announce an unmodified car to a screen reader as
 * critical.
 */
export function buildRampFor(needle: number): BuildRamp {
  if (needle >= 70) return 'far';
  if (needle >= 40) return 'warm';
  if (needle >= 12) return 'mild';
  return 'stock';
}

/** Whether the needle has entered the redline — and so takes the redline colour. */
export function isRedlined(needle: number): boolean {
  return needle >= REDLINE_FROM;
}
