/**
 * What the health report is allowed to claim, given what was actually checked.
 *
 * ── ⚠ The bug this exists to make impossible ────────────────────────────────
 *
 * Found 21 Aug on the App Store reviewer's account. A 2003 Honda Accord — a car
 * inside the Takata airbag campaigns — displayed a **green tick and the words
 * "No active recalls"**, because its NHTSA record had never been fetched and
 * the tile read an empty status as good news:
 *
 *     if (!status || status.trim() === '') {
 *       if (type === 'recall') return 'No active recalls';
 *
 * Nothing was broken in a way anyone could see. The check had simply never
 * happened, and *absence was rendered as an all-clear* — in the green family,
 * with a tick, on a safety claim.
 *
 * `CLAUDE.md` §6 names this exactly: **"`null` is never `0`. A missing score,
 * odometer or schedule is 'we cannot say', and must never render as a
 * reading."** And §10: recalls match on year/make/model, so the product is
 * already careful not to overclaim what a match *means* — while this overclaimed
 * that a match had been attempted at all.
 *
 * ── Three states, because two is what caused it ─────────────────────────────
 *
 * The tiles were boolean: empty or not. That collapses "we looked and found
 * nothing" into the same cell as "we never looked", and only one of those is
 * reassuring. Every claim here resolves to one of:
 *
 *   `clear`      checked, nothing found — green, a tick, and safe to say
 *   `attention`  checked, something found — the existing warning treatment
 *   `unknown`    not checked — **never green, never a tick**
 *
 * `unknown` is deliberately not styled as a failure either. Nothing has gone
 * wrong for the owner; we simply have not got there yet, and saying so plainly
 * is more useful than either a tick or an alarm.
 */

export type ClaimKind = 'recall' | 'maintenance' | 'issues';
export type ClaimState = 'clear' | 'attention' | 'unknown';

export interface HealthClaim {
  state: ClaimState;
  /** The sentence to render. Never empty. */
  text: string;
}

/**
 * Copy for a check that has not run.
 *
 * Written to be read by somebody who has just added a car and wants to know why
 * a panel is blank. It says what is missing and that it is coming — and, for
 * recalls, explicitly refuses the inference the old copy invited.
 */
const NOT_CHECKED: Record<ClaimKind, string> = {
  recall:
    'We have not checked this vehicle for recalls yet, so we cannot say whether any apply. This is not a clear result.',
  maintenance:
    'We have not built a maintenance schedule for this vehicle yet.',
  issues:
    'We have not researched the known issues for this vehicle yet.',
};

/** Copy for a check that ran and found nothing. */
const NONE_FOUND: Record<ClaimKind, string> = {
  recall: 'No active recalls',
  maintenance: 'No items due',
  issues: 'No known issues',
};

/**
 * Decide what a health tile may say.
 *
 * `checked` is the caller's evidence that the underlying lookup actually
 * happened — for recalls, that an NHTSA record exists for this vehicle at all;
 * for the others, that research reached `completed`. It is passed in rather
 * than inferred from the status string precisely because an empty string cannot
 * distinguish the two cases, which is the whole defect.
 */
export function healthClaim(
  kind: ClaimKind,
  status: string | null | undefined,
  checked: boolean
): HealthClaim {
  const written = typeof status === 'string' ? status.trim() : '';

  /*
    A written status is evidence in itself: something produced it. Treated as
    `attention` regardless of `checked`, because the alternative — suppressing a
    real finding because a flag disagreed — is the failure in the dangerous
    direction.
  */
  if (written !== '' && written.toLowerCase() !== 'null') {
    return { state: 'attention', text: written };
  }

  if (!checked) {
    return { state: 'unknown', text: NOT_CHECKED[kind] };
  }

  return { state: 'clear', text: NONE_FOUND[kind] };
}

/**
 * Whether a claim may be rendered in the reassuring treatment — green ground,
 * tick, the visual language of "you are fine".
 *
 * Exported as its own function so the rule is one thing rather than a condition
 * repeated at three call sites, and so a test can assert it directly.
 */
export function mayReassure(claim: HealthClaim): boolean {
  return claim.state === 'clear';
}

/**
 * The recall evidence a prompt is allowed to state.
 *
 * ── Why this is here and not inline in the prompt ───────────────────────────
 *
 * The tile and the narrative contradicted each other on the same screen,
 * 22 Aug. `healthClaim` above had already made the tile honest — "We have not
 * checked this vehicle for recalls yet… This is not a clear result." — while
 * the health summary's prompt was still handed `nhtsa?.recalls?.length || 0`
 * and duly wrote **"While there are no active recalls…"** underneath it.
 *
 * One fix landed on the component; the generator kept its own copy of the
 * question. So the rule lives in one place now, beside the tile's rule, and
 * both are reached from the same `checked` flag. A safety claim split across
 * two files drifts, and the half that drifts is the half nobody is testing.
 *
 * ⚠ **The prose is the more dangerous half.** It is what a person actually
 * reads, it is phrased with the model's full fluency, and unlike the tile it
 * carries no icon, colour or qualifier to argue with it.
 *
 * ── Why the unchecked branch is an instruction, not a value ─────────────────
 *
 * A prompt that omits the count, or passes `unknown`, still leaves the model
 * free to reassure — models fill silence with the reassuring reading, and the
 * summary's job is to sound confident. So the unchecked branch says what is
 * not known **and forbids the inference explicitly**. The prohibition is the
 * payload; the absence of a number is not enough.
 */
export function recallEvidenceForPrompt(params: {
  checked: boolean;
  count: number;
  /** Up to three recall summaries, already trimmed by the caller. */
  headlines?: string[];
}): string {
  if (!params.checked) {
    return [
      '- NOT CHECKED. No NHTSA lookup has run for this vehicle, so the number of recalls is UNKNOWN — it is not zero.',
      '- You must NOT write that there are no recalls, that none are active, or anything a reader could take as an all-clear.',
      '- Say plainly that recalls have not been checked yet, and let the rest of the assessment stand on the service history.',
    ].join('\n');
  }

  const headlines = (params.headlines ?? []).filter((h) => h.trim() !== '');

  return [
    `- We checked NHTSA for this vehicle. Active Recalls: ${params.count}`,
    ...(headlines.length > 0
      ? headlines.map((h) => `  - ${h}`)
      : ['  (none found)']),
  ].join('\n');
}
