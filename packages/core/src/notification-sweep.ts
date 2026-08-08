/**
 * Who gets woken up, and who does not.
 *
 * Phase 5, C2 and C3. This is the decision half of the scheduled sweep — pure,
 * no IO, no client, no clock. The route reads the rows and sends the pushes;
 * everything about *whether to send at all* is here, because it is the part
 * that has to be right and the part nobody will be watching when it runs.
 *
 * ── What makes this different from every other module in core ───────────────
 *
 * Every other decision in this app is made while somebody is looking at a
 * screen. This one is made at 3am, unattended, to everybody at once, and the
 * output is a push notification — which cannot be recalled, cannot be edited,
 * and on iOS is the one thing a person cannot ignore.
 *
 * So the failure that matters is not "we missed a recall". It is **"we told
 * four thousand people something wrong, or told them the same thing eleven
 * nights running"**, and the second one is how an app gets its notifications
 * permanently disabled. Every rule below is written against that.
 *
 * ── The four rules ─────────────────────────────────────────────────────────
 *
 * 1. **Nothing goes out twice.** Recalls dedupe on NHTSA's own campaign
 *    number; service dedupes on a cooldown, because a service stays due for
 *    weeks and "still due" is not news.
 * 2. **Nothing goes out that we cannot substantiate.** `unknown` is not a
 *    severity to wake someone for, and `isWorthNotifying` already refuses it.
 * 3. **A run is bounded.** A sweep that would notify everybody is a bug, not a
 *    busy day, and the cap turns a runaway into a truncated run plus a loud
 *    log rather than into four thousand pushes.
 * 4. **Deciding is separable from sending.** Every function here returns what
 *    it *would* do, so the route can run the whole sweep and send nothing.
 */

import type { Milestone } from './service-due';
import type { NormalisedRecall } from './recalls';

/**
 * The most notifications one sweep may send, across all accounts.
 *
 * ── Why a cap at all, and why this number ──────────────────────────────────
 *
 * The realistic runaway is not malice, it is a dedupe that silently stops
 * working — a migration that drops a unique constraint, a campaign number that
 * starts arriving null, a cooldown comparing a date to a timestamp. In every
 * one of those the sweep does exactly what it was told and the blast radius is
 * the entire user base.
 *
 * 200 is deliberately far above any plausible real night and far below "an
 * incident". It is a **circuit breaker, not a quota**: hitting it means
 * something is wrong and the run should stop and say so, not queue the rest
 * for tomorrow.
 *
 * `bound-costs-degrade-gracefully` is the same principle applied to spend;
 * this is it applied to attention, which is the scarcer resource.
 */
export const SWEEP_SEND_CAP = 200;

/**
 * How long after a service notification before the same car may get another.
 *
 * A service does not stop being due because it was mentioned. Oil at 7,500
 * miles stays overdue until it is done, so the naive sweep tells the same
 * person about the same oil change every single night — which is not a
 * notification, it is a leak, and the fix people reach for is turning
 * notifications off for good.
 *
 * 30 days is chosen against the shortest interval in a real schedule rather
 * than picked round: oil is ~7,500 miles, which at this product's own average
 * of ~1,200-1,600 miles a month is five to six months. A monthly reminder is
 * therefore well inside "before you would have forgotten" and nowhere near
 * "again?".
 */
export const SERVICE_COOLDOWN_DAYS = 30;

export interface RecallToRaise {
  campaignNumber: string;
  recall: NormalisedRecall;
}

/**
 * Which of a vehicle's recalls this owner has not been told about.
 *
 * `alreadyRaised` is the set of campaign numbers in `recall_notifications` for
 * this vehicle. NHTSA's campaign number is the key rather than anything of
 * ours, because it is stable across re-fetches and it is what makes "have we
 * mentioned this" answerable at all.
 */
export function recallsToRaise(params: {
  recalls: NormalisedRecall[];
  alreadyRaised: Iterable<string>;
}): RecallToRaise[] {
  const raised = new Set(params.alreadyRaised);

  return params.recalls
    .map((recall) => {
      const campaignNumber = campaignNumberOf(recall);
      return campaignNumber === null ? null : { campaignNumber, recall };
    })
    .filter((candidate): candidate is RecallToRaise => candidate !== null)
    .filter(({ campaignNumber }) => !raised.has(campaignNumber));
}

/**
 * A recall with no campaign number is **skipped, not raised**.
 *
 * It is the one case where the safe-looking choice is the wrong one. Without a
 * campaign number there is no dedupe key, so sending it means sending it again
 * tomorrow, and every night after that, forever. A recall nobody hears about
 * is a real cost; a nightly recall alert is worse, because it ends with
 * notifications disabled and *every* future recall unheard.
 *
 * NHTSA always supplies one on a genuine campaign, so an absence means the row
 * is malformed rather than that the recall is unnumbered.
 */
function campaignNumberOf(recall: NormalisedRecall): string | null {
  // Read through the typed field rather than an index signature: `campaignNumber`
  // is declared `string | null` on NormalisedRecall, and a cast here would keep
  // compiling — silently returning null for every recall — if it were renamed.
  const value = recall.campaignNumber;
  if (value === null) return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether this car's service milestone is worth a push tonight.
 *
 * Two independent gates, and both must pass:
 *
 *   - the milestone is genuinely due or overdue (`worthNotifying`, which the
 *     caller computes with `isWorthNotifying` so the "unknown is not news"
 *     rule lives in one place)
 *   - nothing was sent about this car inside the cooldown
 */
export function shouldRaiseService(params: {
  worthNotifying: boolean;
  /** ISO date of the last service notification for this vehicle, or null. */
  lastNotifiedOn: string | null;
  /** ISO date. Injected so a sweep is testable without the clock. */
  today: string;
}): boolean {
  if (!params.worthNotifying) return false;
  if (params.lastNotifiedOn === null) return true;

  const days = daysBetween(params.lastNotifiedOn, params.today);

  /*
    `null` — an unparseable stored date — is treated as "inside the cooldown",
    which suppresses the send.

    That is the deliberately quiet direction. The alternative reading, "we
    cannot tell, so send", turns one corrupt row into a nightly notification
    that no dedupe can ever stop, because the same unparseable value is there
    again tomorrow.
  */
  if (days === null) return false;

  return days >= SERVICE_COOLDOWN_DAYS;
}

/** Whole days from `from` to `to`, or `null` if either is not a date. */
export function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return Math.floor((end - start) / 86_400_000);
}

export interface SweepPlan<T> {
  /** What to send, already truncated to the cap. */
  send: T[];
  /** How many candidates there were before the cap. */
  considered: number;
  /** True when the cap truncated the run — an incident, not a busy night. */
  capped: boolean;
}

/**
 * Apply the circuit breaker, and report honestly that it fired.
 *
 * Truncating silently would make a runaway look like an ordinary quiet night
 * in the logs — the sweep would send its 200, report success, and do it again
 * tomorrow. `capped` exists so the route can log at error level and a human
 * finds out on the first night rather than the fortieth.
 */
export function applySendCap<T>(candidates: T[], cap: number = SWEEP_SEND_CAP): SweepPlan<T> {
  return {
    send: candidates.slice(0, cap),
    considered: candidates.length,
    capped: candidates.length > cap,
  };
}

/**
 * A milestone's headline service, for the notification body.
 *
 * The most urgent one rather than the first: `evaluateSchedule` already sorts
 * by urgency, but a caller that re-sorted for display would otherwise change
 * what the notification says.
 */
export function headlineService(milestone: Milestone): string | null {
  const urgent =
    milestone.services.find((service) => service.status === 'overdue') ??
    milestone.services.find((service) => service.status === 'due') ??
    milestone.services[0];

  return urgent?.service ?? null;
}
