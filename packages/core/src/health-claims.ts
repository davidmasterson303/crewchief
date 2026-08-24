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

/**
 * ── Whether a stored health verdict may be presented as a current one ───────
 *
 * **The bug this exists to make impossible, observed 23 Aug.** The M235i's
 * detail screen read:
 *
 *   > a complete lack of documented maintenance … impossible to assess its
 *   > current condition
 *
 * while the service history one tap away listed **5 services and $1,461**,
 * including an oil change, brake pads and rotors, spark plugs and a coolant
 * flush — all read off an invoice the owner had scanned with this app.
 *
 * Nothing was broken. `vehicle_health_summary` was generated on 30 Jul; the
 * invoice was filed on 6 Aug; `generateVehicleHealthSummary` learned to read
 * `maintenance_line_items` on 5 Aug and has not been run for this car since.
 * Every layer rendered exactly what it held.
 *
 * That is the same shape as the Takata tile in this file's opening docblock,
 * one step further on: there, absence was rendered as an all-clear; here, an
 * **out-of-date reading is rendered as a current one.** And this direction is
 * worse than a wrong number, because it tells the owner the app did not read
 * the invoice they just gave it — which is the premise of the product.
 *
 * ── Why the rule is "the verdict must name its inputs" ──────────────────────
 *
 * A summary that cannot say what it read cannot be checked against anything.
 * Both halves of this function come out of that:
 *
 *   `inputs`  what the screen knows it is holding — 5 services, 2 recalls —
 *             for a `ProvenanceRow`. It makes the contradiction *visible at
 *             review time* rather than invisible, which is the only reason the
 *             one above survived three weeks.
 *   `state`   whether the prose may be shown at all.
 *
 * ⚠ **`stale` needs positive evidence, and its absence is not freshness.** If
 * the caller cannot say when records were filed — the count request failed, say
 * — the verdict is left `current` rather than marked stale. Erring the other
 * way would put a "this is out of date" line on every car whose second request
 * timed out, and a warning that fires on healthy data is the one that gets made
 * to go away. §5.
 *
 * ⚠ **This is in `core`, not on the screen.** Web renders the same stored
 * summary from the same table, and the defect above was originally two of them:
 * a capability that lives in one client's component is one the second client
 * silently lacks. That is this codebase's most repeated defect.
 */
export type VerdictState = 'current' | 'stale' | 'absent';

export interface HealthVerdict {
  state: VerdictState;
  /**
   * The prose to render.
   *
   * The stored summary when it may stand; a plain statement of what is out of
   * date when it may not; `null` when there is nothing to say. It is never the
   * stored summary in the `stale` case — the sentence itself is the thing that
   * is wrong, and showing it beside a caveat leaves the owner to decide which
   * half of their screen to believe.
   */
  text: string | null;
  /** What the screen knows was read. For `ProvenanceRow`. Possibly empty. */
  inputs: string[];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function healthVerdict(params: {
  /** `vehicle_health_summary.summary`. */
  summary: string | null | undefined;
  /** `vehicle_health_summary.last_generated`. */
  generatedAt: string | null | undefined;
  /** How many service records the screen is holding. `null` = could not say. */
  serviceCount: number | null;
  /**
   * When the most recent service record was **filed**, not when the work was
   * done.
   *
   * ⚠ Filed, because that is what the verdict could have read. A shop visit
   * dated 2 Aug that was scanned on 6 Aug was invisible to a summary generated
   * on the 4th, and comparing against the service date would call that summary
   * current. `null` = could not say, which leaves the verdict alone.
   */
  newestFiledAt: string | null;
  /** Open recalls — total minus what the owner has marked repaired. */
  openRecalls: number | null;
}): HealthVerdict {
  const inputs: string[] = [];

  if (params.serviceCount !== null) {
    inputs.push(
      params.serviceCount === 0
        ? 'no service records'
        : plural(params.serviceCount, 'recorded service', 'recorded services')
    );
  }

  /*
    Only when there are some. "Based on 0 open recalls" is a sentence that reads
    as an all-clear, and this file exists because that inference was drawn once
    already from an empty value.
  */
  if (params.openRecalls !== null && params.openRecalls > 0) {
    inputs.push(plural(params.openRecalls, 'open recall', 'open recalls'));
  }

  const written = typeof params.summary === 'string' ? params.summary.trim() : '';
  if (written === '') return { state: 'absent', text: null, inputs };

  const filed = timestamp(params.newestFiledAt);
  const generated = timestamp(params.generatedAt);

  /*
    Unknown filing time means no evidence of staleness — see the docblock. An
    unparseable or missing `last_generated` **with** a known filing time is
    treated as stale: a reading that cannot say when it was taken cannot claim
    to postdate anything.
  */
  if (filed !== null && (generated === null || generated < filed)) {
    const missed =
      params.serviceCount !== null && params.serviceCount > 0
        ? plural(params.serviceCount, 'service record', 'service records')
        : 'service records';

    return {
      state: 'stale',
      text: `This reading was taken before your ${missed} were filed, so it does not account for them.`,
      inputs,
    };
  }

  return { state: 'current', text: written, inputs };
}

/** Milliseconds, or `null` for anything that is not a usable date. */
function timestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
