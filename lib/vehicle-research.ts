import { getServiceRoleClient } from '@/lib/supabase';
import { genAI, proStructuredConfig } from '@/lib/gemini';
import { recordAiUsageInBackground } from '@/lib/ai-usage';
import { VEHICLE_RESEARCH_PROMPT } from '@crewchief/core/prompts';
import { VehicleDataSchema, extractJSON } from '@crewchief/core/vehicle-utils';
import { withTimeout, TimeoutError } from '@crewchief/core/retry';
import { PRO_MODEL } from '@crewchief/core/ai/models';
import { logger } from '@crewchief/core/logger';
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
  userId: string | null
): Promise<ResearchOutcome> {
  const vehicleId = vehicle.id;

  try {
    const client = getServiceRoleClient();

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
          RESEARCH_TIMEOUT_MS,
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

async function fetchNHTSARecalls(vehicleId: string, year: number, make: string, model: string) {
  try {
    const client = getServiceRoleClient();
    const response = await fetch(
      `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`
    );

    if (response.ok) {
      const data = await response.json();
      const recalls = data.results || [];

      await client.from('nhtsa_data').insert({
        vehicle_id: vehicleId,
        recalls: recalls,
        last_checked: new Date().toISOString(),
        next_check_due: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  } catch (error) {
    logger.warn('RESEARCH:NHTSA_FAILED', 'Could not fetch recalls', {
      vehicleId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
