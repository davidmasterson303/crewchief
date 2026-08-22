import { timingSafeEqual } from 'node:crypto';

import { logger } from '@crewchief/core/logger';
import type { NextRequest } from 'next/server';

import { getServiceRoleClient } from '@/lib/supabase';
import { sendToAccount } from '@/lib/push-send';
import { normaliseRecalls } from '@crewchief/core/recalls';
import { recallNotification, serviceDueNotification } from '@crewchief/core/notifications';
import {
  evaluateSchedule,
  isWorthNotifying,
  milestoneReason,
  nextMilestone,
  nextService,
} from '@crewchief/core/service-due';
import { historyLookups } from '@crewchief/core/service-history';
import {
  applySendCap,
  digestRecalls,
  headlineService,
  recallsToRaise,
  shouldRaiseService,
  vehiclesToGenerate,
  type GenerationCandidate,
} from '@crewchief/core/notification-sweep';
import { researchVehicleDossier } from '@/lib/vehicle-research';

/**
 * The nightly sweep. Phase 5, C1–C3.
 *
 * Reads every vehicle, decides who needs telling, sends the pushes. All of the
 * *deciding* is in `@crewchief/core/notification-sweep` — this file is the IO
 * around it, deliberately, because the decisions are the part that has to be
 * right and they should be testable without a database.
 *
 * ── Why this is not under /api/v1 ───────────────────────────────────────────
 *
 * `/api/v1` is the mobile client's surface, and every route there is held to
 * accepting a bearer token by `v1-accepts-bearer.test.ts`. This route accepts
 * no user credential of any kind — there is no user. It is infrastructure the
 * scheduler calls, so it lives where that is obvious.
 *
 * ── The authorization, which is the whole risk ──────────────────────────────
 *
 * This endpoint sends push notifications to every account in the product. An
 * unauthenticated one would be the most abusable surface in the app by a wide
 * margin — not a data leak, but a way to make CrewChief spam its own users
 * until they uninstall it.
 *
 * So: a shared secret, compared in constant time, and **it fails closed**. If
 * `CRON_SECRET` is unset the route refuses every request rather than running
 * unprotected. That direction matters more than it looks: the natural failure
 * is a deploy where the variable did not get set, and "unconfigured means open"
 * would turn a missing env var into an open relay.
 *
 * ── Dry run ────────────────────────────────────────────────────────────────
 *
 * `?dryRun=1` runs the entire sweep — every query, every decision — and sends
 * nothing. It is how the first production run should be made, and how a
 * suspected runaway is diagnosed without adding to it.
 */

export const dynamic = 'force-dynamic';

/** Vehicles read per page. Bounded so one enormous account cannot exhaust memory. */
const PAGE_SIZE = 200;

interface SweepSummary {
  vehiclesScanned: number;
  /**
   * What the run **decided** to send, before delivery and regardless of
   * `dryRun`.
   *
   * ⚠ These exist because `recallsSent`/`servicesSent` cannot answer the
   * question a dry run is asked. They only increment inside the delivery loop,
   * which `dryRun` skips — so a dry run reported zeros no matter what it had
   * decided, and the route's own docblock advertises it as the way to make the
   * first production run and to diagnose a suspected runaway.
   *
   * A dry run reporting "0 sent" when it would have sent four hundred is worse
   * than no dry run: it reads as reassurance. Found by running it — the counts
   * were right there in the plans and never reached the summary.
   */
  recallsPlanned: number;
  /**
   * Campaigns covered by those notifications.
   *
   * ⚠ Distinct from `recallsPlanned` since 22 Aug, when one car turned out to
   * carry 24 of them. `recallsPlanned` counts pushes and is what the send cap
   * governs; this counts dedupe rows and is what says how much was actually
   * communicated. One notification covering 24 campaigns is the intended
   * shape, and a summary that reported only "1" would hide it.
   */
  recallCampaignsRaised: number;
  servicesPlanned: number;
  /** What was actually delivered. Always 0 under `dryRun`, by construction. */
  recallsSent: number;
  servicesSent: number;
  /**
   * What the run **decided** to generate, before spending and regardless of
   * `dryRun`.
   *
   * ⚠ Same defect as `recallsPlanned`/`servicesPlanned` above, in the one
   * branch that spends Pro-model calls: `schedulesGenerated` only increments
   * inside the generation loop, which `dryRun` skips, so a dry run reported
   * zero no matter how many cars it had selected. That made the dry run — the
   * documented way to make the first production run safely — unable to answer
   * "how much is this about to spend", which is the only question worth asking
   * before a run that costs money.
   */
  generationPlanned: number;
  /** Dossiers generated this run for cars that had never had one. C4. */
  schedulesGenerated: number;
  /** Eligible cars left for tomorrow because the generation budget ran out. */
  generationBacklog: number;
  capped: boolean;
  dryRun: boolean;
}

/**
 * Constant-time secret comparison.
 *
 * `===` on a secret leaks its prefix through timing. That is a marginal attack
 * over the public internet and a free one to close, and this is the only thing
 * standing between an unauthenticated caller and every push token in the
 * product.
 *
 * Lengths are compared first because `timingSafeEqual` throws on a mismatch —
 * which would itself be an oracle, and a much louder one.
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  /*
    Fail closed. An unset secret is a misconfigured deploy, not permission to
    run — and this route's output cannot be taken back.
  */
  if (!secret) {
    logger.error('CRON:SWEEP', new Error('CRON_SECRET is not set'), {
      stage: 'Refusing to run an unprotected sweep',
    });
    return Response.json({ success: false, error: 'Not configured' }, { status: 503 });
  }

  if (!secretMatches(request.headers.get('x-cron-secret'), secret)) {
    /*
      Says nothing about *why the supplied secret failed* — absent, short or
      merely wrong all return this, so nothing here narrows a guess.

      ⚠ It does not hide whether the route is configured at all: the 503 above
      is distinguishable from this 401, so an anonymous caller can learn that
      `CRON_SECRET` is unset. That was written as though it were hidden, and it
      is not. **Keeping it that way is deliberate** — the distinction is how a
      silently inert sweep gets diagnosed from outside, which is exactly how it
      was caught on 12 Aug, and it is not worth much to an attacker: "this
      endpoint refuses everything" is a reason to leave, and neither code helps
      guess a secret that is being compared in constant time.
    */
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const today = new Date().toISOString().slice(0, 10);
  const client = getServiceRoleClient();

  const summary: SweepSummary = {
    vehiclesScanned: 0,
    recallsPlanned: 0,
    recallCampaignsRaised: 0,
    servicesPlanned: 0,
    recallsSent: 0,
    servicesSent: 0,
    generationPlanned: 0,
    schedulesGenerated: 0,
    generationBacklog: 0,
    capped: false,
    dryRun,
  };

  /*
    Candidates are collected across every vehicle *before* anything is sent, so
    the cap applies to the run as a whole rather than per page. A per-page cap
    would let a runaway through 200 at a time and never report itself.
  */
  const recallCandidates: Array<{ userId: string; vehicleId: string; name: string; campaignNumber: string; summary: string }> = [];
  const serviceCandidates: Array<{ userId: string; vehicleId: string; name: string; service: string; reason: string }> = [];
  /*
    C4. Cars that reached `collectService` with no schedule to evaluate. They
    are gathered rather than acted on here for the same reason the send
    candidates are: the generation budget applies to the run as a whole, and a
    per-page budget would spend ten on every page.
  */
  const generationCandidates: GenerationCandidate[] = [];
  /** Vehicle rows kept by id, so a generated car can be re-evaluated without re-reading it. */
  const scanned = new Map<string, { row: VehicleRow; name: string }>();

  for (let page = 0; ; page += 1) {
    const { data: vehicles, error } = await client
      .from('vehicles')
      .select('id, user_id, year, make, model, current_mileage, is_demo')
      .order('id')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (error) {
      logger.error('CRON:SWEEP', new Error(error.message), { stage: 'Reading vehicles' });
      await recordSweepRun(client, summary, 'Could not read vehicles');
      return Response.json({ success: false, error: 'Could not read vehicles' }, { status: 500 });
    }

    if (!vehicles || vehicles.length === 0) break;

    for (const vehicle of vehicles) {
      /*
        Demo cars are seeded fixtures nobody owns. A notification about one
        would reach whichever account the seed happens to name — and the demo
        garage is the portfolio surface, so its data changes for reasons that
        have nothing to do with a real owner's car.
      */
      if (vehicle.is_demo || !vehicle.user_id) continue;

      summary.vehiclesScanned += 1;

      const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'your car';
      scanned.set(vehicle.id, { row: vehicle, name });

      await collectRecalls(client, vehicle, name, recallCandidates);
      await collectService(client, vehicle, name, today, serviceCandidates, generationCandidates);
    }

    if (vehicles.length < PAGE_SIZE) break;
  }

  /*
    ── C4: generate the missing schedules, then re-evaluate those cars ────────

    This runs before the cap and the sends, because a car generated tonight
    should be able to produce tonight's notification. The alternative — queue it
    and notify tomorrow — adds a day of latency for no benefit.

    ⚠ **Nothing here runs under `dryRun`.** A dry run is documented as "every
    query, every decision, no sends", and it is how a suspected runaway is
    diagnosed. A dry run that spent money on a Pro-model call for ten cars
    would be a trap sprung by exactly the person being careful. The generation
    is behind the same flag as the send, deliberately.
  */
  await resolveSignInActivity(client, generationCandidates);

  const generationPlan = vehiclesToGenerate(generationCandidates);
  summary.generationPlanned = generationPlan.send.length;
  summary.generationBacklog = generationPlan.considered - generationPlan.send.length;

  if (generationPlan.capped) {
    /*
      Warn, not error — and this is the difference from `SWEEP_SEND_CAP`.
      Hitting the send cap means a dedupe broke. Hitting this one means there
      is a backlog of new cars, which is what success looks like. The budget
      degrades the feature by a day rather than breaking it.
    */
    logger.warn('CRON:SWEEP', 'Generation budget spent; the rest wait for tomorrow', {
      generated: generationPlan.send.length,
      waiting: summary.generationBacklog,
    });
  }

  if (!dryRun) {
    for (const candidate of generationPlan.send) {
      const scan = scanned.get(candidate.vehicleId);
      if (!scan) continue;

      try {
        const outcome = await researchVehicleDossier(
          {
            id: scan.row.id,
            year: scan.row.year,
            make: scan.row.make,
            model: scan.row.model,
          },
          candidate.userId
        );

        if (!outcome.success || outcome.unsupported) continue;

        /*
          ⚠ A short-circuit is not a generation. `researchVehicleDossier`
          returns `alreadyResearched` when the dossier already existed and it
          spent nothing — counting that would report work the night never did,
          in the one number that says whether C4 is earning its budget.

          It should not happen from here, because `vehiclesToGenerate` only
          ever offers `pending` rows. "Should not happen" is why it is checked:
          the alternative is a counter that is right until two sweeps overlap.
        */
        if (outcome.alreadyResearched) continue;

        summary.schedulesGenerated += 1;

        /*
          Re-run the service collection for this car alone, now that it has a
          schedule. `needsGeneration` is deliberately omitted: if it somehow
          still has no schedule, it must not re-enter the queue it just left.
        */
        await collectService(client, scan.row, scan.name, today, serviceCandidates);
      } catch (error) {
        /*
          One car's failure is not the run's. A sweep that aborted here would
          let a single malformed vehicle silence notifications for everybody
          else — the failure mode this module is written against.
        */
        logger.error('CRON:SWEEP', error as Error, {
          stage: 'Generating a missing schedule',
          vehicleId: candidate.vehicleId,
        });
      }
    }
  }

  /*
    ⚠ Digested **before** the cap, not after.

    The cap exists to stop a runaway reaching the user base; it counts
    notifications, and after this call one car is one notification however many
    campaigns it carries. Capping the raw candidates first would let a single
    car with 24 recalls eat an eighth of the run's entire send budget — and,
    worse, would make `capped` fire for a night that was never abnormal.
  */
  const recallPlan = applySendCap(digestRecalls(recallCandidates));
  const servicePlan = applySendCap(serviceCandidates);
  summary.capped = recallPlan.capped || servicePlan.capped;

  /*
    Recorded before the delivery branch, so a dry run reports what it decided
    rather than what it sent. This is the line that makes `?dryRun=1` worth
    running.
  */
  summary.recallsPlanned = recallPlan.send.length;
  summary.recallCampaignsRaised = recallPlan.send.reduce(
    (total, digest) => total + digest.campaignNumbers.length,
    0
  );
  summary.servicesPlanned = servicePlan.send.length;

  if (summary.capped) {
    /*
      Error level, not warn. Hitting the cap means a dedupe stopped working —
      the sweep is doing exactly what it was told and the blast radius is the
      user base. This is the line that should page somebody.
    */
    logger.error('CRON:SWEEP', new Error('Send cap reached'), {
      stage: 'Truncated — a dedupe has probably stopped working',
      recallsConsidered: recallPlan.considered,
      servicesConsidered: servicePlan.considered,
    });
  }

  if (!dryRun) {
    for (const candidate of recallPlan.send) {
      const outcome = await sendToAccount(
        candidate.userId,
        recallNotification({
          vehicleId: candidate.vehicleId,
          vehicleName: candidate.name,
          recallSummary: candidate.headline,
          campaignCount: candidate.campaignNumbers.length,
        })
      );

      /*
        The dedupe row is written whether or not a token was reachable.

        Someone with no registered device still had this recall raised for
        them; leaving the row unwritten would re-raise it every night until
        they install the app, and then send a months-old backlog at once.
      */
      /*
        ⚠ **Every** campaign in the digest gets a row, not just the one named in
        the body. Writing only the headline's row would leave the other
        twenty-three un-raised, so tomorrow night would send a digest of 23,
        then 22 — a countdown, nightly, which is the runaway this module exists
        to prevent wearing its most plausible disguise.
      */
      await client.from('recall_notifications').upsert(
        candidate.campaignNumbers.map((campaignNumber) => ({
          vehicle_id: candidate.vehicleId,
          campaign_number: campaignNumber,
          severity: 'standard',
        })),
        { onConflict: 'vehicle_id,campaign_number' }
      );

      if (outcome.delivered > 0) summary.recallsSent += 1;
    }

    for (const candidate of servicePlan.send) {
      const outcome = await sendToAccount(
        candidate.userId,
        serviceDueNotification({
          vehicleId: candidate.vehicleId,
          vehicleName: candidate.name,
          serviceName: candidate.service,
          reason: candidate.reason,
        })
      );

      await client
        .from('service_notifications')
        .upsert({ vehicle_id: candidate.vehicleId, last_notified_at: new Date().toISOString() });

      if (outcome.delivered > 0) summary.servicesSent += 1;
    }
  }

  logger.info('CRON:SWEEP', 'Sweep complete', { ...summary });

  await recordSweepRun(client, summary);

  return Response.json({ success: true, ...summary });
}

/**
 * The heartbeat. One row per run, including the runs that decide to send
 * nothing.
 *
 * ── Why this is not just the log line above ─────────────────────────────────
 *
 * `recall_notifications` had no row newer than 16 August, and the database
 * could not say whether that was six quiet nights or a sweep that had stopped
 * running. Both states produced identical evidence: no notifications, no rows,
 * no errors. The canary is the precedent — it sat on a branch that could not
 * fire `schedule` and had never run once, and nothing said so.
 *
 * The `logger.info` above does record it, in Netlify's function logs, behind a
 * login this project's tooling does not hold. A heartbeat that needs a
 * dashboard to read is one nobody reads.
 *
 * ── Failure-tolerant, and loudly so ─────────────────────────────────────────
 *
 * ⚠ Awaited rather than fire-and-forget: this is the last thing the run does,
 * and the request must not return before the row is written or the serverless
 * container can be frozen mid-insert. But a throw here must never fail the
 * sweep — the sweep's job is notifications, and a monitor that can take down
 * the thing it monitors is worse than no monitor.
 *
 * ⚠ So a failed write logs at **error**, and the reason is CLAUDE.md §5: an
 * empty table reads as "the sweep is dead", which is a false alarm if the truth
 * is "the insert failed" — and a guard that cries wolf gets made to pass. The
 * table is absent until `20260822120000` is applied, and every run until then
 * takes this path.
 */
async function recordSweepRun(client: Client, summary: SweepSummary, error?: string) {
  try {
    const { error: writeError } = await client.from('sweep_runs').insert({
      dry_run: summary.dryRun,
      ok: error === undefined,
      error: error ?? null,
      vehicles_scanned: summary.vehiclesScanned,
      recalls_planned: summary.recallsPlanned,
      services_planned: summary.servicesPlanned,
      recalls_sent: summary.recallsSent,
      services_sent: summary.servicesSent,
      schedules_generated: summary.schedulesGenerated,
      generation_backlog: summary.generationBacklog,
      capped: summary.capped,
    });

    if (writeError) throw new Error(writeError.message);
  } catch (heartbeatError) {
    logger.error('CRON:SWEEP', heartbeatError as Error, {
      stage: 'Recording the heartbeat — the sweep itself is unaffected',
    });
  }
}

type Client = ReturnType<typeof getServiceRoleClient>;
type VehicleRow = {
  id: string;
  user_id: string;
  current_mileage: number | null;
  year: number;
  make: string;
  model: string;
};

async function collectRecalls(
  client: Client,
  vehicle: VehicleRow,
  name: string,
  into: Array<{ userId: string; vehicleId: string; name: string; campaignNumber: string; summary: string }>
) {
  const [{ data: nhtsa }, { data: raised }] = await Promise.all([
    client.from('nhtsa_data').select('recalls').eq('vehicle_id', vehicle.id).maybeSingle(),
    client.from('recall_notifications').select('campaign_number').eq('vehicle_id', vehicle.id),
  ]);

  const recalls = normaliseRecalls(nhtsa?.recalls);
  if (recalls.length === 0) return;

  const alreadyRaised = (raised ?? []).map((row) => row.campaign_number as string);

  for (const { campaignNumber, recall } of recallsToRaise({ recalls, alreadyRaised })) {
    into.push({
      userId: vehicle.user_id,
      vehicleId: vehicle.id,
      name,
      campaignNumber,
      summary: recall.summary ?? recall.component ?? 'A safety recall affects this vehicle.',
    });
  }
}

/**
 * Fill in `lastSignInAt` for each candidate, one lookup per **account**.
 *
 * ── Why this is a separate pass ─────────────────────────────────────────────
 *
 * The fact belongs to the account, not the car. Resolving it inside the scan
 * would look it up once per vehicle, so an owner with four cars would be
 * queried four times a night for the same answer.
 *
 * ── Why the admin API and not a table read ──────────────────────────────────
 *
 * `last_sign_in_at` lives on `auth.users`, which PostgREST does not expose —
 * CLAUDE.md §2. `auth.admin.getUserById` is the service-role path to it, and
 * this route already holds the service role.
 *
 * ⚠ **A failed lookup leaves `null`, and `null` does not pass the filter.**
 * That direction is deliberate: the failure mode of guessing "active" is a
 * Pro-model call for an account nobody is behind, every night, for every car
 * it owns. The failure mode of guessing "dormant" is a dossier that waits a
 * day. One of those is recoverable by the next sweep and the other compounds.
 */
async function resolveSignInActivity(client: Client, candidates: GenerationCandidate[]) {
  const byUser = new Map<string, string | null>();

  for (const candidate of candidates) {
    if (byUser.has(candidate.userId)) continue;

    try {
      const { data, error } = await client.auth.admin.getUserById(candidate.userId);
      if (error) throw new Error(error.message);
      byUser.set(candidate.userId, data.user?.last_sign_in_at ?? null);
    } catch (error) {
      logger.warn('CRON:SWEEP', 'Could not read sign-in activity; treating as dormant', {
        userId: candidate.userId,
        error: (error as Error)?.message,
      });
      byUser.set(candidate.userId, null);
    }
  }

  for (const candidate of candidates) {
    candidate.lastSignInAt = byUser.get(candidate.userId) ?? null;
  }
}

async function collectService(
  client: Client,
  vehicle: VehicleRow,
  name: string,
  today: string,
  into: Array<{ userId: string; vehicleId: string; name: string; service: string; reason: string }>,
  needsGeneration?: GenerationCandidate[]
) {
  const mileage = typeof vehicle.current_mileage === 'number' ? vehicle.current_mileage : 0;
  if (mileage <= 0) return;

  const [{ data: knowledge }, { data: sent }, { data: history }] = await Promise.all([
    client
      .from('vehicle_knowledge_base')
      .select('maintenance_schedule, research_status')
      .eq('vehicle_id', vehicle.id)
      .maybeSingle(),
    client
      .from('service_notifications')
      .select('last_notified_at')
      .eq('vehicle_id', vehicle.id)
      .maybeSingle(),
    client
      .from('maintenance_line_items')
      .select('item_description, service_date, mileage_at_service, source')
      .eq('vehicle_id', vehicle.id),
  ]);

  const schedule = knowledge?.maintenance_schedule;
  if (!Array.isArray(schedule) || schedule.length === 0) {
    /*
      C4 — the lazy-regeneration gap.

      Until this branch existed, the sweep simply returned here, so a car whose
      owner had never opened its dashboard never became eligible for a service
      notification. Reaching someone who is *not* in the app is the whole point
      of the feature, so the unreachable population was exactly the intended
      one — and every car added on the phone starts in it.

      `needsGeneration` is absent on the second pass (see `regenerate`), which
      is what stops a car that generated and still has no schedule from being
      queued again inside the same run.
    */
    if (needsGeneration) {
      /*
        ⚠ `lastSignInAt` is filled in **after** the scan, not here.

        This ran a `device_push_tokens` count per candidate car, which was one
        query per car for a fact that belongs to the account. The replacement —
        `last_sign_in_at`, see filter 3 in `vehiclesToGenerate` — is an
        admin-API read, and doing that per car would be worse: a person with
        four cars would be looked up four times, every night.

        So the candidate is pushed with `null` and the owning accounts are
        resolved once each, in `resolveSignInActivity`, before the filter runs.
        ⚠ `null` is the safe placeholder: if the resolution step is ever
        skipped or fails, the filter refuses rather than generating for
        everybody.
      */
      needsGeneration.push({
        vehicleId: vehicle.id,
        userId: vehicle.user_id,
        researchStatus: (knowledge?.research_status as string | undefined) ?? null,
        lastSignInAt: null,
        mileage,
      });
    }
    return;
  }

  const services = evaluateSchedule({
    schedule,
    currentMileage: mileage,
    today,
    ...historyLookups(history ?? []),
  });

  /*
    ── The garage row's next service, written back ────────────────────────────

    ⚠ **Before the raise gate below, and that ordering is the whole point.**
    Put this after it and only the cars that earned a notification would ever
    have a stored next service — which is a quiet way of leaving most of the
    garage blank while looking like it works.

    `nextService` rather than `nextMilestone`: the row asks what is next, not
    whether it is worth interrupting someone about. A card that went blank
    because the next service is far away would be hiding the reassuring answer.

    Best-effort. A failed write is not a reason to skip a notification — the
    sweep's actual job — so it is logged and stepped over. The column simply
    keeps yesterday's value, which `next_service_updated_at` makes visible.
  */
  const upcoming = nextService(services);

  const { error: nextServiceError } = await client
    .from('vehicles')
    .update({
      next_service_label: upcoming?.service ?? null,
      // Null when the service is date-driven. Not zero — see the migration.
      next_service_at_miles: upcoming?.dueAtMiles ?? null,
      next_service_updated_at: new Date().toISOString(),
    })
    .eq('id', vehicle.id);

  if (nextServiceError) {
    logger.warn('CRON:SWEEP', 'Could not store the next service', {
      vehicleId: vehicle.id,
      error: nextServiceError.message,
    });
  }

  const milestone = nextMilestone(services, { horizonMiles: 5_000 });

  const raise = shouldRaiseService({
    worthNotifying: isWorthNotifying(milestone),
    lastNotifiedOn: (sent?.last_notified_at as string | undefined) ?? null,
    today,
  });

  if (!raise || !milestone) return;

  const service = headlineService(milestone);
  if (!service) return;

  /*
    `milestoneReason` rather than a sentence composed here — it is the same
    wording `ServiceMilestoneScreen` shows, and it already handles the cases a
    hand-rolled string gets wrong: the *most* overdue service rather than
    whichever sorted last, and months instead of miles when the interval is
    time-driven. A notification whose wording disagrees with the screen it
    opens reads as two different products.
  */
  into.push({
    userId: vehicle.user_id,
    vehicleId: vehicle.id,
    name,
    service,
    reason: milestoneReason(milestone, mileage),
  });
}
