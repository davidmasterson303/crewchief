/**
 * The front door's funnel — what an anonymous stranger did, and how far they got.
 *
 * Phase 2.97d. This is the half that has no database in it: the vocabulary, and
 * the rule for turning a set of reached steps into a funnel. The write needs a
 * service-role client and lives in `lib/funnel.ts`.
 *
 * ── Why this is a ship gate rather than a component ─────────────────────────
 *
 * Advisory item P1, scored 7.6 and adopted. Phase 2.97 exists to produce
 * evidence — the roadmap's own justification is that it is the only item that
 * generates demand data before money is spent forming an entity. A front door
 * that ships without this is a nicer landing page that teaches nobody anything,
 * and because it is the smallest line in the phase it is the first thing that
 * would be cut under time pressure. Hence: the door does not open without it.
 *
 * ── No vendor, and that is a decision, not an omission ──────────────────────
 *
 * There is no analytics product in this app and none is being added. A
 * third-party tracker on an anonymous endpoint pulls in a consent banner, which
 * is a conversion tax on the exact surface being measured and a new item in
 * 5.0's legal scope. Four events written to Postgres on the `ai_usage_events`
 * pattern costs less and answers the same question.
 *
 * ── The one open question, flagged rather than assumed ──────────────────────
 *
 * A first-party id set purely to measure your own funnel is a much weaker
 * consent case than a third-party tracker, but it is **not obviously "strictly
 * necessary"** either. That belongs to the same legal review 5.0 already needs.
 * It is cheaper to ask it then than to retrofit, and it does not change the
 * no-vendor recommendation — a vendor has this problem *and* the banner.
 */

/**
 * The four steps, in the order a visitor passes them.
 *
 * Order is load-bearing: `FUNNEL_STEPS.indexOf` is how `deepestStep` decides
 * which of two steps is further along, so this array is the definition of
 * "further" and not merely a list. Mirrors the CHECK constraint in
 * `20260803090000_record_the_front_door_funnel.sql`, held in step by
 * `funnel-steps.test.ts`.
 *
 *   landed    the front door rendered for someone who had not seen it
 *   uploaded  they gave it an estimate — a photograph or pasted text
 *   answered  we returned a range. This is the step that costs money
 *   saved     they clicked through to keep it, which is the conversion moment
 *
 * Adding a step means a migration, the same friction `AI_USAGE_PURPOSES`
 * carries, and for the same reason: a vocabulary that can drift is a funnel
 * that quietly stops being comparable to last week's.
 */
export const FUNNEL_STEPS = ['landed', 'uploaded', 'answered', 'saved'] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * A visitor id that this module is willing to record.
 *
 * The absent case is defined rather than left to each call site, because
 * "defined behaviour when it is absent" is the part of visitor correlation that
 * gets skipped. An event with no visitor is not a bad event — it is *not a
 * funnel event at all*, because a step that cannot be joined to the other three
 * is a counter. Recording it would inflate the top of the funnel and depress
 * every rate computed from it, which is worse than the gap it fills.
 */
export function isRecordableVisitorId(visitorId: unknown): visitorId is string {
  if (typeof visitorId !== 'string') return false;
  const trimmed = visitorId.trim();
  // Bounded on both ends: empty ids collapse every visitor into one row that
  // UNIQUE (visitor_id, step) then dedupes into a single fake visitor, and an
  // unbounded one is a text column an anonymous caller controls.
  return trimmed.length >= 8 && trimmed.length <= 128 && trimmed === visitorId;
}

/**
 * The furthest step a visitor reached, or `null` if they reached none.
 *
 * A funnel is "how far did each visitor get", not "how many events fired" —
 * those differ the moment anyone reloads, and reloads are the common case on a
 * page someone was linked to. Deduping is the database's job (see the UNIQUE
 * constraint); ranking is this function's.
 */
export function deepestStep(steps: readonly FunnelStep[]): FunnelStep | null {
  let deepest: FunnelStep | null = null;
  let deepestIndex = -1;

  for (const step of steps) {
    const index = FUNNEL_STEPS.indexOf(step);
    if (index > deepestIndex) {
      deepestIndex = index;
      deepest = step;
    }
  }

  return deepest;
}

/**
 * Turn per-visitor step sets into the four counts a funnel is read from.
 *
 * Cumulative, not exclusive: a visitor who reached `answered` counts in
 * `landed` and `uploaded` too, whether or not those rows exist. That matters
 * because the events are best-effort — a dropped `uploaded` write must not
 * produce a funnel where more people were answered than uploaded, which reads
 * as a bug in the product rather than in the meter.
 *
 * The counts are what makes this a funnel rather than "four counters nobody can
 * turn into rates" — the failure mode this function exists to prevent.
 */
export function funnelCounts(
  visitors: readonly (readonly FunnelStep[])[]
): Record<FunnelStep, number> {
  const counts = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])) as Record<FunnelStep, number>;

  for (const steps of visitors) {
    const deepest = deepestStep(steps);
    if (!deepest) continue;

    const reached = FUNNEL_STEPS.indexOf(deepest);
    for (let i = 0; i <= reached; i++) {
      counts[FUNNEL_STEPS[i]] += 1;
    }
  }

  return counts;
}
