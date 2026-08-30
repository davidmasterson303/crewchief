import { getServiceRoleClient } from '@/lib/supabase';
import { checkMonthlyBudget } from '@/lib/ai-budget';
import { checkFeatureAccess, featureRefusal } from '@/lib/feature-gate';
import { budgetMessage } from '@wellkept/core/ai/budget';
import {
  nextCheckDue,
  readRecallResponse,
  type NhtsaLookup,
} from '@wellkept/core/nhtsa-lookup';
import { genAI, proStructuredConfig } from '@/lib/gemini';
import { recordAiUsageInBackground } from '@/lib/ai-usage';
import { VEHICLE_RESEARCH_PROMPT } from '@wellkept/core/prompts';
import { VehicleDataSchema, extractJSON } from '@wellkept/core/vehicle-utils';
import { withTimeout, TimeoutError } from '@wellkept/core/retry';
import { PRO_MODEL } from '@wellkept/core/ai/models';
import { logger } from '@wellkept/core/logger';
import { z } from 'zod';

/**
 * Vehicle research — the model call and the write, with **no authorization**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FUNCTION AUTHORIZES NOTHING. EVERY CALLER MUST AUTHORIZE FIRST.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It spends money — a Pro-model call, up to three attempts — and writes to
 * `vehicle_knowledge_base` for whatever vehicle it is handed. There is no
 * session check, no ownership check and no rate limit inside it. Those belong
 * to the caller, and the two legitimate callers authorize in two different ways
 * because they are two different kinds of request:
 *
 *   - `generateVehicleDossier` in `app/actions.ts` — a user is present, so it
 *     checks `authorizeVehicleAccess` and applies the per-vehicle AI rate limit
 *     before delegating here.
 *   - the nightly sweep, `app/api/internal/notify-sweep/route.ts` — **no user
 *     exists by construction.** It is authorized by `CRON_SECRET`, compared in
 *     constant time at the route boundary, and it bounds its own spend with a
 *     per-run generation cap.
 *
 * ── Why this lives here and not in `app/actions.ts` ─────────────────────────
 *
 * `app/actions.ts` carries `'use server'`, which makes **every export in it a
 * publicly invokable POST endpoint.** Exporting an unauthorized variant from
 * that file would therefore not be a refactor — it would publish "generate a
 * dossier for any vehicle, no credential required" to the internet, on the most
 * expensive path in the product, and nothing in the type system or the build
 * would say a word about it.
 *
 * So the split is not tidiness. It is the only shape in which the sweep can
 * reuse this code without the reuse creating an open door, and it is why
 * `vehicle-research-callers.test.ts` keeps the caller list closed.
 *
 * ── Why the sweep is allowed to own this work at all ────────────────────────
 *
 * `enrichVehicle`'s docblock records that research is deliberately *not*
 * fire-and-forget, because work started after a response on a serverless
 * platform "may be frozen along with it" — so the dashboard calls it as a real
 * request with a real lifecycle. **The sweep satisfies that rule rather than
 * bending it:** it is a real request, awaited by a scheduled function, with
 * somewhere for failure to live. A second legitimate owner, not an exception.
 *
 * ── What this deliberately does NOT do: powertrain options ──────────────────
 *
 * `generateVehicleDossier` used to end by kicking off `fetchPowertrainOptions`
 * and writing the result back. That stays in `app/actions.ts` and did **not**
 * move here, because `fetchPowertrainOptions` calls `requireSession()` — it is
 * session-gated on purpose, and the sweep has no session to offer it.
 *
 * The consequence, stated rather than discovered later: **a dossier generated
 * by the sweep has no engine/transmission/drivetrain option lists until someone
 * opens the car.** That is acceptable where a missing schedule is not. The
 * option lists populate a dropdown on a screen a person is looking at, and the
 * existing UI path already fetches them on demand; the maintenance schedule is
 * what a notification is computed from, and nobody is looking at anything when
 * that runs.
 */

/**
 * How long one research attempt may take before it is abandoned.
 *
 * Exported so `app/actions.ts` shares this definition rather than keeping a
 * second copy — the timeout and the retry policy that reads it have to agree,
 * and they cannot agree if they are declared in two files.
 */
export const RESEARCH_TIMEOUT_MS = 30_000;

/**
 * The budget when nobody is waiting — the nightly sweep.
 *
 * ── ⚠ Measured, after a 30s budget lost a car permanently ───────────────────
 *
 * The dossier call takes **23-30 seconds**. `RESEARCH_TIMEOUT_MS` is 30. That
 * is not a timeout, it is a coin flip, and both faces were observed on 22 Aug:
 * a successful run finished in ~30s, and a sweep run an hour later timed out
 * against the same model on the same kind of car.
 *
 * ⚠ **A timeout in the sweep is not recoverable the way an interactive one
 * is.** It writes `research_status = 'failed'`, and `vehiclesToGenerate`
 * filter 1 never offers a `failed` car again — correctly, because retrying a
 * genuine failure nightly is the runaway that module exists to prevent. The
 * user's escape hatch is the retry button, and the sweep's entire purpose is
 * cars whose owner is *not in the app to press it*. So one marginal timeout
 * removes a car from research permanently, silently, and on the population the
 * feature was built for.
 *
 * The interactive budget stays at 30s: its own docblock's reasoning holds —
 * three deadlines plus backoff is 96 seconds of somebody watching a spinner.
 * **That argument does not apply at 3am.** Nobody is watching, so the only
 * cost of waiting is the function's own execution time.
 *
 * ⚠ **This multiplies against `SWEEP_GENERATE_CAP`.** Ten cars at 60s is ten
 * minutes of a Netlify scheduled function that gets fifteen, before NHTSA
 * fetches. Raising either number without the other in mind is how the sweep
 * starts dying halfway through and reporting a partial night as a whole one.
 */
export const SWEEP_RESEARCH_TIMEOUT_MS = 60_000;

export interface VehicleForResearch {
  id: string;
  year: number;
  make: string;
  model: string;
}

export interface ResearchOutcome {
  success: boolean;
  error?: string;
  unsupported?: boolean;
  data?: z.infer<typeof VehicleDataSchema>;
  /**
   * The dossier already existed, so nothing was generated and nothing was
   * billed.
   *
   * Distinct from `success` alone because the two callers need to tell them
   * apart: the sweep counts what it generated, and counting a short-circuit
   * would report a night's work that never happened. It is the same reason
   * `unsupported` is separate — "we did not spend" has more than one cause and
   * they are not interchangeable.
   */
  alreadyResearched?: boolean;
}

/**
 * Generate and store a vehicle's dossier.
 *
 * `userId` is the account the spend is attributed to. It is passed explicitly
 * rather than derived, because the sweep has no session to derive it from and a
 * silently-null attribution would put real spend outside the metering that D2's
 * pricing is decided on. The sweep passes the vehicle's owner, which is the
 * honest answer: it is that person's car and that person's bill.
 */
export async function researchVehicleDossier(
  vehicle: VehicleForResearch,
  userId: string | null,
  options: { timeoutMs?: number } = {}
): Promise<ResearchOutcome> {
  const vehicleId = vehicle.id;
  /*
    Defaults to the interactive budget, so the two existing callers keep the
    behaviour they were written against and only the sweep opts into a longer
    wait. A default of the *longer* value would have quietly made every
    dashboard visit willing to hang for a minute.
  */
  const timeoutMs = options.timeoutMs ?? RESEARCH_TIMEOUT_MS;

  try {
    /*
      ⚠ **PERF-06, and this is the one that mattered most.** This is the single
      most expensive call in the application — the Pro model with
      `maxOutputTokens: 32768` — and it had **no ceiling in front of it at all**.
      A user past their tier limit could keep generating dossiers indefinitely.

      `userId` is `null` for the demo path and for the sweep, and both are
      allowed through deliberately: the demo has its own separate ceiling, and
      the sweep is capped at `SWEEP_GENERATE_CAP` cars a night by construction.
      A monthly per-user budget has no user to charge in either case.
    */
    if (userId) {
      /*
        The dossier is one of the three paid features — the pricing decision of
        24 Aug — and this function is what builds it.

        ⚠ Inside the same `if (userId)` as the budget, and for the same two
        reasons: the demo has its own ceiling, and the nightly sweep is capped
        by construction. Neither has an account to charge or to check, and
        gating the sweep would quietly stop it refreshing dossiers for accounts
        that *are* entitled.

        ⚠ Enforcement is off until there is something to buy. See
        `lib/feature-gate.ts`.
      */
      const gate = featureRefusal(await checkFeatureAccess(userId, 'dossier'));
      if (gate) {
        logger.warn('RESEARCH:NOT_ENTITLED', 'Dossier is a paid feature; not researching', {
          vehicleId,
          userId,
        });
        return { success: false, error: gate };
      }

      const budget = await checkMonthlyBudget(userId);
      if (!budget.allowed) {
        logger.warn('RESEARCH:BUDGET_SPENT', 'Monthly AI budget spent; not researching', {
          vehicleId,
          userId,
        });
        return { success: false, error: budgetMessage(budget) };
      }
    }

    const client = getServiceRoleClient();

    /*
      ── Do not pay twice for a dossier this vehicle already has ──────────────

      ⚠ Added 22 Aug, from a live run that cost the discovery. Research for a
      new Accord **succeeded** — full dossier written, 24 NHTSA recalls stored,
      `research_status = 'completed'` — while the browser was told it had
      failed, because the request outlived its response and `enrichVehicle`
      came back with no body at all. The screen showed the failure state and a
      retry button.

      Pressing it went straight from the authorization check to the prompt.
      Nothing between the two asked whether the work had already been done, so
      a retry on a *successful* dossier spent another Pro call — the most
      expensive one in the product, ~4,900 tokens, measured the same day. The
      only reason it did not happen is that nobody pressed the button.

      ⚠ **The retry button is not wrong and this does not disable it.** Only
      `completed` short-circuits. A `failed` or `pending` row still generates,
      which is exactly what that button is for: its purpose is a dossier that
      is missing, and a missing dossier is not what this guard sees.

      Deliberately no `force` option. There is no caller that wants one today,
      and a flag whose only user is a future maybe is a flag that gets passed
      `true` by the next person in a hurry. Re-research is a real need when it
      arrives — it should arrive with its own reasoning about staleness.
    */
    const { data: existing } = await client
      .from('vehicle_knowledge_base')
      .select('research_status, last_research_date')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    if (existing?.research_status === 'completed') {
      logger.info('RESEARCH:ALREADY_DONE', 'Dossier already generated; not spending again', {
        vehicleId,
        lastResearchDate: existing.last_research_date,
      });
      return { success: true, alreadyResearched: true };
    }

    const prompt = VEHICLE_RESEARCH_PROMPT(vehicle.year, vehicle.make, vehicle.model);

    const researchStartedAt = Date.now();
    let attempt = 0;
    let parsed = null;
    let lastError = null;

    while (attempt < 3 && !parsed) {
      try {
        const waitTime = Math.pow(2, attempt) * 1000;
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        const response = await withTimeout(
          () =>
            genAI.models.generateContent({
              model: PRO_MODEL,
              contents: prompt,
              config: proStructuredConfig,
            }),
          timeoutMs,
          'vehicle research'
        );
        // Recorded per attempt, not per dossier. A retried research call is
        // billed every time it runs, so a per-dossier row would under-report
        // exactly the calls that cost the most — and D6 (eager vs lazy dossier
        // generation) is decided on this number.
        recordAiUsageInBackground(
          { purpose: 'vehicle_dossier', model: PRO_MODEL, userId, vehicleId },
          response.usageMetadata
        );

        const jsonData = extractJSON(response.text || '');
        parsed = VehicleDataSchema.parse(jsonData);

        logger.info('RESEARCH:ATTEMPT_OK', 'Research validated', {
          vehicleId,
          attempt: attempt + 1,
          ms: Date.now() - researchStartedAt,
        });
      } catch (error) {
        lastError = error;
        logger.warn('RESEARCH:ATTEMPT_FAILED', 'Research attempt failed', {
          vehicleId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
          type:
            error instanceof SyntaxError
              ? 'JSON_PARSE'
              : error instanceof z.ZodError
                ? 'VALIDATION'
                : 'OTHER',
        });

        /*
          A timeout ends the loop rather than consuming the remaining attempts.

          Three 30s deadlines plus backoff is 96s of someone watching a
          spinner, and an upstream that did not answer in 30s is unlikely to
          answer in the next 30. Retrying a parse or validation failure is
          worth it — the model may format better on a second pass — but
          retrying silence is just charging the user for the wait.
        */
        if (error instanceof TimeoutError) break;

        attempt++;
      }
    }

    if (!parsed) {
      logger.error('RESEARCH:EXHAUSTED', lastError instanceof Error ? lastError : new Error(String(lastError)), {
        vehicleId,
      });

      /*
        The row goes to 'failed' rather than being left at 'pending', and that
        write is what stops the sweep retrying this car every night forever.
        `vehiclesToGenerate` only ever selects 'pending'.
      */
      await client
        .from('vehicle_knowledge_base')
        .update({ research_status: 'failed' })
        .eq('vehicle_id', vehicleId);

      return { success: false, error: 'Failed to generate vehicle research after 3 attempts' };
    }

    if (parsed.known_issues.length === 0) {
      await client
        .from('vehicle_knowledge_base')
        .update({ research_status: 'unsupported' })
        .eq('vehicle_id', vehicleId);
      return { success: true, unsupported: true };
    }

    const { data: existingKb } = await client
      .from('vehicle_knowledge_base')
      .select('engine_type, transmission_type, drivetrain')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    const updateData: Record<string, unknown> = {
      known_issues: parsed.known_issues,
      maintenance_schedule: parsed.maintenance_schedule,
      fluid_specs: parsed.fluid_specs,
      common_mods: parsed.common_mods,
      reliability_score: parsed.reliability_score,
      interesting_facts: parsed.interesting_facts || [],
      research_status: 'completed',
      last_research_date: new Date().toISOString(),
    };

    if (!existingKb?.engine_type && parsed.powertrain?.engine_type) {
      updateData.engine_type = parsed.powertrain.engine_type;
    }
    if (!existingKb?.transmission_type && parsed.powertrain?.transmission_type) {
      updateData.transmission_type = parsed.powertrain.transmission_type;
    }
    if (!existingKb?.drivetrain && parsed.powertrain?.drivetrain) {
      updateData.drivetrain = parsed.powertrain.drivetrain;
    }

    const { error: updateError } = await client
      .from('vehicle_knowledge_base')
      .update(updateData)
      .eq('vehicle_id', vehicleId);

    if (updateError) {
      logger.error('RESEARCH:SAVE_FAILED', new Error(updateError.message), { vehicleId });
      return { success: false, error: 'Failed to save research data' };
    }

    if (
      parsed.performance_stats &&
      (parsed.performance_stats.horsepower ||
        parsed.performance_stats.torque ||
        parsed.performance_stats.zero_to_sixty)
    ) {
      const { error: vehicleUpdateError } = await client
        .from('vehicles')
        .update({
          stock_hp: parsed.performance_stats.horsepower || null,
          stock_torque: parsed.performance_stats.torque || null,
          stock_zero_to_sixty: parsed.performance_stats.zero_to_sixty || null,
        })
        .eq('id', vehicleId);

      if (vehicleUpdateError) {
        logger.error('RESEARCH:STATS_FAILED', new Error(vehicleUpdateError.message), { vehicleId });
        return { success: false, error: 'Failed to save performance stats' };
      }
    }

    await fetchNHTSARecalls(vehicleId, vehicle.year, vehicle.make, vehicle.model);

    return { success: true, data: parsed };
  } catch (error) {
    logger.error('RESEARCH:UNEXPECTED', error as Error, { vehicleId });
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * Does NHTSA recognise this make for this year?
 *
 * ⚠ Returns `null` for "could not tell", which is **not** `false`. The caller
 * treats `null` as "do not claim a match", so a failure here costs a green tick
 * rather than granting one — see `readRecallResponse`.
 */
async function makeIsKnownToNhtsa(year: number, make: string): Promise<boolean | null> {
  try {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { Count?: unknown; Results?: unknown };
    if (Array.isArray(data.Results)) return data.Results.length > 0;
    if (typeof data.Count === 'number') return data.Count > 0;

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch this vehicle's recalls and record **what the lookup concluded**.
 *
 * ── ⚠ Three defects in six lines, all found on 24 Aug ───────────────────────
 *
 * The version this replaces was:
 *
 *     await client.from('nhtsa_data').insert({ vehicle_id, recalls, … });
 *
 * **1 · `.insert()` against a `UNIQUE NOT NULL` column.** A second call for the
 * same vehicle raises `23505`.
 *
 * **2 · The result was not destructured at all**, so that error was invisible.
 * Between them, recalls were fetched **once per vehicle, ever** — a car
 * researched in February shows a green tick forever, even after NHTSA opens a
 * stall-while-driving campaign against it in April. The nightly sweep reads the
 * same frozen array and raises nothing. There was no second entry point either:
 * `researchVehicleDossier` short-circuits on `research_status === 'completed'`.
 *
 * **3 · `next_check_due` was written and read by nothing.** The "quarterly
 * recheck" the schema header advertises did not exist. It does now — the
 * nightly sweep selects on it.
 *
 * And the fourth, which is the worst of them: a lookup NHTSA did not recognise
 * was stored identically to a clean car. `packages/core/src/nhtsa-lookup.ts`
 * carries that argument in full.
 */
export async function fetchNHTSARecalls(
  vehicleId: string,
  year: number,
  make: string,
  model: string
) {
  try {
    const client = getServiceRoleClient();

    /*
      Both requests together rather than in sequence: the vocabulary check is
      only consulted when zero recalls come back, and waiting for it serially
      would add its latency to every research run for nothing.
    */
    const [response, makeIsKnown] = await Promise.all([
      fetch(
        `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`
      ),
      makeIsKnownToNhtsa(year, make),
    ]);

    const results = response.ok ? ((await response.json()) as { results?: unknown }).results : null;
    const lookup = readRecallResponse({ ok: response.ok, results, makeIsKnown });

    await writeNhtsaRow(client, vehicleId, lookup);

    if (lookup.status !== 'matched') {
      /*
        ⚠ Warned, not swallowed. A `no_match` is the state in which this product
        knows least about a car's safety, and it is invisible on screen by
        design — the tile says "we cannot say" rather than raising an alarm — so
        the log is the only place it is countable.
      */
      logger.warn('RESEARCH:NHTSA_UNMATCHED', 'NHTSA did not recognise this vehicle', {
        vehicleId,
        status: lookup.status,
        make,
        model,
        year,
      });
    }
  } catch (error) {
    logger.warn('RESEARCH:NHTSA_FAILED', 'Could not fetch recalls', {
      vehicleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Write the lookup, tolerating a database that has not had the migration yet.
 *
 * ⚠ **`CLAUDE.md` §2: the database and the migrations folder disagree, both
 * ways, and have done five times.** `lookup_status` arrives in
 * `20260824100000`, and the deploy that carries this code can reach production
 * before somebody runs it in the SQL editor. Sending an unknown column makes
 * PostgREST reject the **whole row** with `42703`, which would take recall
 * fetching down entirely — turning a correctness fix into an outage.
 *
 * So the column is sent, and a `42703` retries once without it and logs at
 * error level naming the migration. The fallback is deliberately loud and
 * deliberately temporary: it should be deleted the day the migration is
 * confirmed applied.
 */
async function writeNhtsaRow(
  client: ReturnType<typeof getServiceRoleClient>,
  vehicleId: string,
  lookup: NhtsaLookup
) {
  const row = {
    vehicle_id: vehicleId,
    recalls: lookup.recalls,
    last_checked: new Date().toISOString(),
    next_check_due: nextCheckDue(lookup.status),
  };

  const { error } = await client
    .from('nhtsa_data')
    .upsert({ ...row, lookup_status: lookup.status }, { onConflict: 'vehicle_id' });

  if (!error) return;

  if (error.code === '42703') {
    logger.error(
      'RESEARCH:NHTSA_SCHEMA_LAG',
      new Error('nhtsa_data.lookup_status is missing — run migration 20260824100000'),
      { vehicleId }
    );

    const { error: retryError } = await client
      .from('nhtsa_data')
      .upsert(row, { onConflict: 'vehicle_id' });

    if (retryError) {
      logger.error('RESEARCH:NHTSA_WRITE_FAILED', new Error(retryError.message), { vehicleId });
    }
    return;
  }

  /*
    ⚠ Checked at all, which it was not before. The `23505` this used to raise
    every time a vehicle was re-researched went into a variable nobody read.
  */
  logger.error('RESEARCH:NHTSA_WRITE_FAILED', new Error(error.message), {
    vehicleId,
    code: error.code,
  });
}
