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

/**
 * The most dossiers one sweep may generate.
 *
 * ── Why this cap is not `SWEEP_SEND_CAP` ────────────────────────────────────
 *
 * A send costs attention. A generation costs **money** — a Pro-model call, up
 * to three attempts, on the most expensive path in the product. They are
 * different resources with different failure modes and they must not share a
 * number: 200 generations in one unattended night is a bill nobody authorised,
 * while 200 sends is merely the circuit breaker doing its job.
 *
 * ── Why 10, and why it is a quota rather than a breaker ─────────────────────
 *
 * `SWEEP_SEND_CAP` is a **circuit breaker** — hitting it means something is
 * broken and the run should say so loudly. This is the opposite: hitting it is
 * *expected* on the first few nights after a backlog appears, and the right
 * response is to do ten tonight and ten tomorrow. Ten a night clears any
 * plausible backlog for a product this size inside a week, and puts a known
 * ceiling on the spend either way.
 *
 * That is `bound-costs-degrade-gracefully` applied literally: **exhausting the
 * budget must degrade the feature, not break it.** A car that misses tonight's
 * ten still gets its schedule tomorrow, and its owner is no worse off than
 * under the behaviour this replaces, where it never got one at all.
 */
export const SWEEP_GENERATE_CAP = 10;

/**
 * How many stale NHTSA lookups one sweep may refresh.
 *
 * ── ⚠ Why there is a cap on a free API (FN-02) ──────────────────────────────
 *
 * NHTSA's recall endpoint costs nothing, so this cap is **not** about money —
 * which makes it different from `SWEEP_GENERATE_CAP`, and the difference is
 * worth stating so nobody "optimises" it away.
 *
 * It is about two things the sweep cannot afford. **Request volume against
 * somebody else's service**: a garage of a thousand cars all crossing 90 days
 * in the same week would fire a thousand requests in one burst from one IP, and
 * there is no published rate limit to reason against. And **the function
 * timeout**: this sweep already has more to do than fits comfortably in a
 * Netlify invocation, and each refresh is two round trips.
 *
 * A car whose lookup is a day past due waits until tomorrow. Recalls arrive on
 * a scale of weeks; a backlog draining over several nights is not a defect.
 *
 * Higher than `SWEEP_GENERATE_CAP` because the unit cost is a free HTTP call
 * rather than a Pro-model generation.
 */
export const SWEEP_RECALL_REFRESH_CAP = 40;

/**
 * Which vehicles' recall data is stale enough to re-fetch tonight.
 *
 * ⚠ **A row that has never recorded an outcome comes first.** `lookup_status`
 * arrived on 24 Aug and every row written before it reads `unknown`, which
 * means we genuinely do not know whether that car's recalls were ever matched.
 * Those are the rows most likely to be hiding a `no_match`, so they are
 * refreshed ahead of ones that are merely old.
 *
 * Then oldest-due first, so a backlog drains in the order it accumulated rather
 * than by whatever order the database happened to return.
 */
export function recallsToRefresh<T extends { nextCheckDue: string | null; lookupStatus: string | null }>(
  candidates: readonly T[],
  now: Date = new Date(),
  cap: number = SWEEP_RECALL_REFRESH_CAP
): SweepPlan<T> {
  const due = candidates.filter((candidate) => {
    if (candidate.lookupStatus !== 'matched') return true;
    if (!candidate.nextCheckDue) return true;

    const at = Date.parse(candidate.nextCheckDue);
    return Number.isNaN(at) ? true : at <= now.getTime();
  });

  const ordered = [...due].sort((a, b) => {
    const unresolved = Number(b.lookupStatus !== 'matched') - Number(a.lookupStatus !== 'matched');
    if (unresolved !== 0) return unresolved;

    return (a.nextCheckDue ?? '').localeCompare(b.nextCheckDue ?? '');
  });

  return applySendCap(ordered, cap);
}

export interface RecallToRaise {
  campaignNumber: string;
  recall: NormalisedRecall;
}

/** A vehicle the sweep is considering generating a maintenance schedule for. */
export interface GenerationCandidate {
  vehicleId: string;
  userId: string;
  /** `research_status` from `vehicle_knowledge_base`, or null when no row exists. */
  researchStatus: string | null;
  /**
   * `last_sign_in_at` for the owning account, ISO, or null if never.
   *
   * ⚠ This was `hasPushToken`, and the swap is the point — see filter 3.
   */
  lastSignInAt: string | null;
  /** `current_mileage`. A car with no reading cannot produce a due date. */
  mileage: number | null;
}

/**
 * Which cars should have a maintenance schedule generated tonight.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * A schedule is written by `researchVehicleDossier`, which until now only ever
 * ran from a dashboard visit. So **a car whose owner never opened its dashboard
 * had no schedule, and the sweep skipped it silently — forever.** Reaching
 * somebody who is *not* in the app is the entire purpose of a notification, so
 * the population the feature could not serve was precisely the one it was built
 * for. Every car added on the phone starts in that state.
 *
 * ── Four filters, and the reasoning for each ────────────────────────────────
 *
 * **1. `pending` only.** Never `failed`: that row means the model already ran
 * three times and cost money, and retrying it nightly forever is the exact
 * runaway this module exists to prevent — the user already has a retry button
 * owned by a request that waits for it. Never `unsupported`: the model has said
 * it has nothing for this car. Never `completed`: a completed row with an empty
 * schedule is a car whose research succeeded and produced no schedule, and
 * regenerating *that* nightly is the same runaway wearing a different status.
 *
 * **2. A missing row (`null`) is skipped too, and this is the subtle one.**
 * Generation reports failure by writing `research_status = 'failed'` — an
 * UPDATE, which does nothing when there is no row to update. So a vehicle with
 * no knowledge-base row at all could fail every night and never record that it
 * had, which is a nightly paid call with no brake. Both insert paths create the
 * row with `pending`, so a null here means something else is wrong and the
 * sweep is not the place to repair it.
 *
 * **3. The account has signed in recently.** ⚠ **This filter used to read
 * `hasPushToken`, and it was filtering on the wrong thing.**
 *
 * The reasoning was "spending a Pro call at 3am for an account with no
 * registered device is money for nobody", which is sound about *notifications*
 * and wrong about *dossiers*. A dossier is not notification fuel. It feeds the
 * web dashboard, the health report and the consultant's context — none of
 * which involve a phone. Gating research on device registration conflated who
 * should be *told* something with whose data is worth *building*.
 *
 * The cost of that conflation was visible in production on 22 Aug: the App
 * Store reviewer's account has no device and never will unless Apple registers
 * one, so its 2003 Accord — a car inside the Takata campaigns — sat at
 * `research_status = 'pending'` with no NHTSA record, and the sweep could not
 * reach it by design. Every web-only user is in the same position, and after
 * `health-claims.ts` their recall tile honestly reads "we cannot say" forever.
 *
 * So the brake stays and its subject changes: **research on account activity,
 * notify on device tokens.** An account that signed in within
 * `RESEARCH_ACTIVITY_WINDOW_DAYS` is somebody who might open the dashboard the
 * dossier is for. A dormant account is still money for nobody, which is the
 * part of the old reasoning that was right.
 *
 * ⚠ A null `lastSignInAt` does **not** pass. An account that has never signed
 * in has never seen a dashboard, and "never" must not read as "recently" —
 * `null` is never `0`, in dates as much as in odometers.
 *
 * **4. `mileage > 0`.** `collectService` already refuses these, so generating
 * for one could not produce a notification even if it succeeded.
 */
export function vehiclesToGenerate(
  candidates: GenerationCandidate[],
  cap: number = SWEEP_GENERATE_CAP,
  now: Date = new Date()
): SweepPlan<GenerationCandidate> {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.researchStatus === 'pending' &&
      signedInRecently(candidate.lastSignInAt, now) &&
      typeof candidate.mileage === 'number' &&
      candidate.mileage > 0
  );

  return applySendCap(eligible, cap);
}

/**
 * How recently an account must have signed in for its cars to be worth
 * researching.
 *
 * Ninety days is a judgement, not a measurement, and it is written here rather
 * than inlined so it can be argued with. The question it answers is "is there
 * a person who might look at this?" — a quarter is long enough to cover
 * somebody who checks their car seasonally, and short enough that an abandoned
 * account stops costing Pro calls within one billing quarter.
 *
 * ⚠ It is a **cost** brake, not a correctness one. Widening it spends more and
 * breaks nothing; narrowing it leaves honest `unknown` tiles on real accounts.
 * That asymmetry is why the number errs long.
 */
export const RESEARCH_ACTIVITY_WINDOW_DAYS = 90;

/**
 * Whether an account counts as active.
 *
 * ⚠ Exported so the rule is one thing rather than a date comparison repeated
 * at a call site, and so a test can hold it to the boundary directly. An
 * unparseable or absent timestamp is **not** recent: absence is not evidence
 * of activity, and this is the direction that spends nothing rather than the
 * one that guesses.
 */
export function signedInRecently(lastSignInAt: string | null | undefined, now: Date): boolean {
  if (!lastSignInAt) return false;

  const seen = new Date(lastSignInAt).getTime();
  if (Number.isNaN(seen)) return false;

  const ageMs = now.getTime() - seen;

  // A future timestamp is clock skew, not activity — but it is also not a
  // reason to refuse, since the account plainly exists and signed in.
  if (ageMs < 0) return true;

  return ageMs <= RESEARCH_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
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

/** One night's recall notification for one car, covering every campaign on it. */
export interface RecallDigest {
  userId: string;
  vehicleId: string;
  name: string;
  /**
   * Every campaign this one notification covers.
   *
   * ⚠ All of them get a dedupe row, not just the one in the body. Writing only
   * the headline's row would re-raise the other twenty-three tomorrow night,
   * and the night after — the runaway `recallsToRaise` refuses to start,
   * arriving instead through the send path.
   */
  campaignNumbers: string[];
  /** The campaign the body leads with. The first un-raised one for this car. */
  headline: string;
}

/**
 * One car, one recall notification — however many campaigns it has.
 *
 * ── The night this was written for ──────────────────────────────────────────
 *
 * 22 Aug, a dry run against production: `recallsPlanned: 24`. A 2003 Accord
 * had just had its NHTSA record fetched for the first time, and every one of
 * its twenty-four un-raised campaigns was a separate push. `SWEEP_SEND_CAP` is
 * 200 for the whole run and there was no per-vehicle limit, so all 24 would
 * have gone out that evening, to one phone, about one car.
 *
 * ⚠ **That is the failure `recallsToRaise` already refuses in its own
 * docblock** — "it ends with notifications disabled and every future recall
 * unheard" — arriving from the other direction. That paragraph is about the
 * same recall repeating nightly; this is twenty-four different ones arriving
 * at once. The user-visible event is identical, and so is the ending.
 *
 * It only appears on the *first* sweep after a car's recalls are fetched,
 * because every campaign is deduped afterwards. That makes it rare, and it
 * makes it land on new users — the population least willing to spend goodwill
 * on a product that has just buzzed twenty-four times.
 *
 * ── Why a digest rather than a cap ──────────────────────────────────────────
 *
 * A per-vehicle cap of, say, three would send three and silently drop
 * twenty-one safety notices, or defer them to later nights and buzz for a
 * week. The count is the honest headline: an owner who learns their car has 24
 * open campaigns has been told the important thing, and the screen behind the
 * tap has all of them.
 *
 * ⚠ **Grouping is by vehicle, not by account.** Two cars with recalls produce
 * two notifications, because they are two different actions the owner has to
 * take and the destination screen is per-vehicle. Collapsing across cars would
 * make the notification unactionable to save a buzz.
 */
export function digestRecalls(
  candidates: Array<{
    userId: string;
    vehicleId: string;
    name: string;
    campaignNumber: string;
    summary: string;
  }>
): RecallDigest[] {
  const byVehicle = new Map<string, RecallDigest>();

  for (const candidate of candidates) {
    const existing = byVehicle.get(candidate.vehicleId);

    if (existing) {
      existing.campaignNumbers.push(candidate.campaignNumber);
      continue;
    }

    byVehicle.set(candidate.vehicleId, {
      userId: candidate.userId,
      vehicleId: candidate.vehicleId,
      name: candidate.name,
      campaignNumbers: [candidate.campaignNumber],
      headline: candidate.summary,
    });
  }

  // Insertion order — the scan's order, which is the vehicle table's order.
  // Stable, so a capped run truncates the same way twice.
  return Array.from(byVehicle.values());
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
