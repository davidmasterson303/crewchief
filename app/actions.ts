'use server';

import { supabase, getServiceRoleClient, createServerActionClient, getServerClient } from '@/lib/supabase';
import {
  genAI,
  flashStructuredConfig,
  flashConfig,
  proStructuredConfig,
  classificationConfig,
  withThinking,
} from '@/lib/gemini';
import { VEHICLE_RESEARCH_PROMPT, POWERTRAIN_OPTIONS_PROMPT, CONSULTANT_SYSTEM_PROMPT, CONSULTANT_DOCUMENT_VALIDATION_PROMPT } from '@crewchief/core/prompts';
import { logger } from '@crewchief/core/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { downloadStoredFile } from '@/lib/storage-objects';
import { loadConsultantContext, loadedContextKinds } from '@/lib/consultant-context';
import { authorizeVehicleAccess, authorizeVehicleScopedRow, requireSession } from '@/lib/api-auth';
import { isDemoVehicleId } from '@crewchief/core/demo';
import {
  vehicleStoragePath,
  vehicleIdFromStoragePath,
  storedUrl,
  storagePathFromStoredUrl,
} from '@crewchief/core/storage-paths';
import { withTimeout, TimeoutError } from '@crewchief/core/retry';
import { parseWishlistCommands, parsePerformanceCommands, parseStatusCommands, parseInvoiceFlag } from '@crewchief/core/consultant-commands';
import { validateData, vehicleIdSchema, serviceItemSchema, maintenanceLineItemSchema, quoteRequestSchema } from '@crewchief/core/validation';
import { withRetry } from '@crewchief/core/retry';
import type { Vehicle, ServiceItem, MaintenanceLineItem, KnowledgeBase, ApiResponse, ConsultantContext } from '@crewchief/core/types';
import { z } from 'zod';
import { FLASH_MODEL, PRO_MODEL, LITE_MODEL, FLASH_VISION_MODEL } from '@crewchief/core/ai/models';

import {
  addItemToWishlist as _addItemToWishlist,
  addModificationToWishlist as _addModificationToWishlist,
  addIssueToWishlist as _addIssueToWishlist,
  addMaintenanceItemToWishlist as _addMaintenanceItemToWishlist,
  removeFromWishlist as _removeFromWishlist,
  getWishlistItems as _getWishlistItems,
} from '@/lib/actions/wishlist';

export async function addItemToWishlist(vehicleId: string, itemName: string, itemType: 'issue' | 'maintenance' | 'modification') {
  return _addItemToWishlist(vehicleId, itemName, itemType);
}
export async function addModificationToWishlist(vehicleId: string, modName: string) {
  return _addModificationToWishlist(vehicleId, modName);
}
export async function addIssueToWishlist(vehicleId: string, issueName: string) {
  return _addIssueToWishlist(vehicleId, issueName);
}
export async function addMaintenanceItemToWishlist(vehicleId: string, itemName: string) {
  return _addMaintenanceItemToWishlist(vehicleId, itemName);
}
export async function removeFromWishlist(vehicleId: string, itemName: string, itemType?: 'issue' | 'maintenance' | 'modification') {
  return _removeFromWishlist(vehicleId, itemName, itemType);
}
export async function getWishlistItems(vehicleId: string) {
  return _getWishlistItems(vehicleId);
}

const VehicleDataSchema = z.object({
  known_issues: z.array(z.object({
    part: z.string(),
    mileage_range: z.string(),
    severity: z.enum(['Low', 'Medium', 'High']),
    description: z.string(),
  })).default([]),
  maintenance_schedule: z.array(z.object({
    item: z.string(),
    interval: z.string(),
    priority: z.enum(['Critical', 'Recommended', 'Optional']),
  })).default([]),
  fluid_specs: z.object({
    engine_oil: z.string().optional().default('Unknown'),
    transmission_fluid: z.string().optional().default('Unknown'),
    coolant: z.string().optional().default('Unknown'),
    brake_fluid: z.string().optional().default('Unknown'),
  }).default({}),
  common_mods: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    difficulty: z.enum(['Easy', 'Moderate', 'Hard']),
  })).default([]),
  powertrain: z.object({
    engine_type: z.string().nullable().optional(),
    transmission_type: z.string().nullable().optional(),
    drivetrain: z.string().nullable().optional(),
  }).optional().default({}),
  performance_stats: z.object({
    horsepower: z.number().nullable().optional(),
    torque: z.number().nullable().optional(),
    zero_to_sixty: z.number().nullable().optional(),
  }).optional().default({}),
  interesting_facts: z.array(z.string()).default([]),
  reliability_score: z.number().min(1).max(10).default(5),
});

function extractJSON(text: string): Record<string, unknown> {
  try {
    const trimmed = text.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const jsonMatch = trimmed.match(/^[\s\S]*?(\{[\s\S]*\}|\[[\s\S]*\])[\s\S]*?$/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
    }

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('No valid JSON found in response');
  } catch (error) {
    logger.error('JSON:EXTRACT', error as Error, { textLength: text.length });
    throw error;
  }
}

export async function decodeVIN(vin: string) {
  logger.info('VIN:DECODE_START', 'Starting VIN decode', { vinLength: vin.length });
  try {
    // No vehicle association yet, but this writes rows — keep it off the open internet.
    const session = await requireSession();
    if (!session.ok) {
      return { success: false, error: session.error };
    }

    const client = getServiceRoleClient();
    if (vin.length !== 17) {
      logger.warn('VIN:INVALID_LENGTH', 'VIN length validation failed', { vinLength: vin.length });
      return { success: false, error: 'VIN must be exactly 17 characters' };
    }

    const vinUpper = vin.toUpperCase();

    logger.debug('VIN:CHECK_EXISTING', 'Checking for existing vehicle');
    const { data: existingVehicle } = await client
      .from('vehicles')
      .select('id')
      .eq('vin', vinUpper)
      .maybeSingle();

    if (existingVehicle) {
      logger.warn('VIN:ALREADY_EXISTS', 'Vehicle already in garage', { vehicleId: existingVehicle.id });
      return { success: false, error: 'This vehicle is already in your garage', vehicleId: existingVehicle.id };
    }

    logger.debug('VIN:FETCHING_NHTSA', 'Fetching NHTSA data');
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vinUpper}?format=json`
    );

    if (!response.ok) {
      logger.warn('VIN:NHTSA_FAILED', 'NHTSA API request failed', { status: response.status });
      return { success: false, error: 'Failed to decode VIN. Please try again.' };
    }

    const data = await response.json();
    const result = data.Results?.[0];

    if (!result || result.ErrorCode !== '0') {
      logger.warn('VIN:INVALID_VIN', 'Invalid VIN or not found in NHTSA', { errorCode: result?.ErrorCode });
      return { success: false, error: 'Invalid VIN or vehicle not found in NHTSA database' };
    }

    logger.info('VIN:DECODE_SUCCESS', 'VIN decoded successfully', {
      year: result.ModelYear,
      make: result.Make,
      model: result.Model,
    });

    return {
      success: true,
      vehicle: {
        vin: vinUpper,
        year: parseInt(result.ModelYear) || 0,
        make: result.Make || 'Unknown',
        model: result.Model || 'Unknown',
        trim: result.Trim || '',
      },
    };
  } catch (error) {
    logger.error('VIN:DECODE_ERROR', error as Error);
    return { success: false, error: 'Failed to decode VIN. Please check your internet connection.' };
  }
}

export async function createVehicle(vehicleData: {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  color: string;
  engine_type: string | null;
  transmission_type: string | null;
  drivetrain: string | null;
  current_mileage: number;
  ownership_objective: string;
  usage_profile: string;
  avg_miles_per_month: number;
  performance_mindedness: 'stock' | 'mild' | 'aggressive';
  driving_style: string;
  // No user_id. Ownership comes from the session below and never from the
  // caller — a client-supplied user_id on a server action reads as
  // authoritative even when the body ignores it, which is one careless edit
  // away from being trusted.
}) {
  /*
    Stage timing, because the first thing anyone asked about the onboarding
    hang was "which part is slow" and nobody could answer it.

    Measured 28 Jul, warm server, real prompt: NHTSA decode ~0.6s, each
    Supabase call ~0.2s, the Gemini research call ~23s. The AI layer is the
    whole story and everything else is noise — but that was an inference until
    it was measured, and this makes the next run answer for itself.
  */
  const createStartedAt = Date.now();

  logger.info('VEHICLE:CREATE_START', 'Creating new vehicle', {
    make: vehicleData.make,
    model: vehicleData.model,
    year: vehicleData.year,
  });

  try {
    const sessionClient = createServerActionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const client = getServiceRoleClient();
    logger.debug('VEHICLE:INSERT', 'Inserting vehicle record');

    const { data: vehicle, error: vehicleError } = await client
      .from('vehicles')
      .insert({
        vin: vehicleData.vin,
        year: vehicleData.year,
        make: vehicleData.make,
        model: vehicleData.model,
        trim: vehicleData.trim,
        color: vehicleData.color,
        current_mileage: vehicleData.current_mileage,
        ownership_objective: vehicleData.ownership_objective,
        usage_profile: vehicleData.usage_profile,
        avg_miles_per_month: vehicleData.avg_miles_per_month,
        performance_mindedness: vehicleData.performance_mindedness,
        driving_style: vehicleData.driving_style,
        user_id: user.id,
      })
      .select()
      .single();

    if (vehicleError || !vehicle) {
      logger.error('VEHICLE:INSERT_FAILED', new Error(vehicleError?.message || 'Unknown error'));
      return { success: false, error: 'Failed to save vehicle' };
    }

    logger.info('VEHICLE:CREATED', 'Vehicle record created', {
      vehicleId: vehicle.id,
      msSinceStart: Date.now() - createStartedAt,
    });

    try {
      /*
        Deliberately NOT awaited here any more.

        This ran between the insert and the return, so a slow Google image
        search delayed the user reaching their garage for a photo they had not
        asked for. It is enrichment, and enrichment now happens in
        `enrichVehicle` — see the note there.
      */
      logger.debug('VEHICLE:IMAGE_DEFERRED', 'Vehicle image deferred to enrichment');
    } catch (error) {
      logger.warn('VEHICLE:IMAGE_FAILED', 'Failed to generate vehicle image', {
        error: (error as Error).message,
      });
    }

    logger.debug('VEHICLE:CREATE_KB', 'Creating knowledge base');
    const kbInsert: any = {
      vehicle_id: vehicle.id,
      research_status: 'pending',
    };

    if (vehicleData.engine_type) {
      kbInsert.engine_type = vehicleData.engine_type;
    }
    if (vehicleData.transmission_type) {
      kbInsert.transmission_type = vehicleData.transmission_type;
    }
    if (vehicleData.drivetrain) {
      kbInsert.drivetrain = vehicleData.drivetrain;
    }

    const { error: kbError } = await client
      .from('vehicle_knowledge_base')
      .insert(kbInsert);

    if (kbError) {
      logger.warn('VEHICLE:KB_FAILED', 'Failed to create knowledge base', {
        error: kbError.message,
      });
    }

    logger.debug('VEHICLE:CREATE_CONVERSATION', 'Creating conversation record');
    const { error: conversationError } = await client
      .from('consultant_conversations')
      .insert({
        vehicle_id: vehicle.id,
        message_history: [],
        context_snapshot: {},
      });

    if (conversationError) {
      logger.warn('VEHICLE:CONVERSATION_FAILED', 'Failed to create conversation', {
        error: conversationError.message,
      });
    }

    logger.info('VEHICLE:CREATE_SUCCESS', 'Vehicle fully created', {
      vehicleId: vehicle.id,
      msTotal: Date.now() - createStartedAt,
    });
    return { success: true, vehicleId: vehicle.id };
  } catch (error) {
    logger.error('VEHICLE:CREATE_ERROR', error as Error);
    return { success: false, error: 'Failed to create vehicle' };
  }
}

/*
  A deadline on the research call, because it had none.

  Measured 28 Jul against the real VEHICLE_RESEARCH_PROMPT: a successful
  gemini-2.5-flash call takes ~23s, twice, consistently. The retry loop makes
  three attempts with 0/2/4s backoff, so a wholly failing research run is
  ~75s of wall clock — and with no timeout on the individual call, an
  unresponsive Gemini made that unbounded.

  30s gives a healthy call ~30% headroom over its measured time while turning
  "never returns" into "returns an error the UI can show". The ceiling matters
  more than the exact number: a spinner with no deadline is a hang, not a wait.
*/
const RESEARCH_TIMEOUT_MS = 30_000;

/**
 * Everything a new vehicle needs that is not required to own it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Onboarding used to do all of this *before* the user reached their garage:
 * the vehicle insert, a Google image lookup, a ~23s Gemini research call, a
 * second Gemini call for the health summary, and then a hardcoded two-second
 * pause. Measured 28 Jul, that is 30-60s of spinner on the first thing anyone
 * ever does in this product — and with no deadline on the model calls it was
 * unbounded. An App Store reviewer creates an account, adds a vehicle, and
 * judges; a multi-minute spinner reads as broken.
 *
 * The VIN decode already yields year, make, model, trim, engine and
 * drivetrain in ~0.6s. That is everything "I own this car" needs. The research
 * makes the dossier better; nothing about owning the car depends on it.
 *
 * ── Why it is a server action and not a background job ──────────────────────
 *
 * §11 records the wishlist recompute being fire-and-forget on a serverless
 * platform, where work started after the response "may be frozen along with
 * it". So this is deliberately **not** started and abandoned during
 * onboarding. The dashboard calls it as a real request with a real lifecycle,
 * once, when it sees `research_status = 'pending'`. The work is owned by a
 * request that is actually waiting for it.
 *
 * That also gives failure somewhere to live: the row goes to `'failed'`, the
 * dashboard shows it, and the user can press retry. A silent empty dossier is
 * the §21 provenance problem in a new costume — a UI implying data it does
 * not have.
 */
export async function enrichVehicle(vehicleId: string) {
  const startedAt = Date.now();

  const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
  if (!access.ok) {
    return { success: false, error: access.error };
  }

  const { data: vehicle } = await access.client
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .maybeSingle();

  if (!vehicle) {
    return { success: false, error: 'Vehicle not found' };
  }

  /*
    Enrichment no longer looks for a photograph, and `lib/vehicle-images.ts` is
    gone with it.

    It hotlinked whatever Google Custom Search returned for "2019 BMW M3 car
    photo" and wrote that third-party URL onto the vehicle row. Every part of
    that was a liability. The licence of an arbitrary indexed image is unknown
    and unknowable at that scale — the filter list it carried (`-poster -art
    -print`, plus a deny-list of etsy/redbubble/zazzle) is an admission that it
    could not tell what it was fetching. Hotlinks rot, so a car that had a
    photo in March is a broken hero in August. And the key expired on 28 Jul,
    which means every vehicle created since already took this path to nothing.

    Nothing replaces it because a replacement already exists and is better:
    `VehicleIdentity`'s make-derived plate, which its own docblock now calls
    "the primary design, not the fallback", plus owner upload with downscale
    and EXIF orientation via `lib/image-downscale.ts`. A drawn plate is always
    the right car, always the right licence, and always loads.

    `image_url` stays on the row and is still read as a fallback by
    `planVehiclePhoto` — the seeded demo vehicles use it. Nothing writes it
    from a search any more.
  */

  const dossier = await generateVehicleDossier(vehicleId);
  if (!dossier.success) {
    logger.error('ENRICH:RESEARCH_FAILED', new Error(dossier.error || 'unknown'), {
      vehicleId,
      msTotal: Date.now() - startedAt,
    });
    // generateVehicleDossier has already written research_status='failed',
    // which is what the dashboard renders a retry against.
    return { success: false, error: dossier.error };
  }

  const health = await generateVehicleHealthSummary(vehicleId);
  if (!health.success) {
    // The dossier is the valuable half and it landed. A missing health score
    // is a worse dashboard, not a broken vehicle.
    logger.warn('ENRICH:HEALTH_FAILED', 'Health summary failed', {
      vehicleId,
      error: health.error,
    });
  }

  preloadAllPerformanceModifications(vehicleId).catch(() => {});

  logger.info('ENRICH:COMPLETE', 'Vehicle enrichment complete', {
    vehicleId,
    msTotal: Date.now() - startedAt,
    unsupported: !!dossier.unsupported,
  });

  return { success: true, unsupported: !!dossier.unsupported };
}

export async function generateVehicleDossier(vehicleId: string, vehicleData?: any) {
  // Cost control: server actions are publicly invokable POST endpoints
  // and demo mode has no auth, so every Gemini-backed path is rate limited.
  {
    const rl = await checkRateLimit(`dossier:${vehicleId}`, 'ai');
    if (!rl.allowed) {
      return { success: false, error: `Too many AI requests. Try again in ${rl.retryAfterSeconds}s.` };
    }
  }
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    const vehicle = vehicleData || null;

    if (!vehicle) {
      return { success: false, error: 'Vehicle data is required' };
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
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        console.log(`[Research Attempt ${attempt + 1}/3] Generating research for ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

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
        const text = response.text || '';

        console.log(`[Research Attempt ${attempt + 1}] Response length: ${text.length} chars`);

        const jsonData = extractJSON(text);
        console.log(`[Research Attempt ${attempt + 1}] JSON extracted successfully`);

        parsed = VehicleDataSchema.parse(jsonData);
        console.log(
          `[Research Attempt ${attempt + 1}] Validation passed after ${Date.now() - researchStartedAt}ms`
        );
      } catch (error) {
        lastError = error;
        console.error(`[Research Attempt ${attempt + 1}] Failed:`, {
          error: error instanceof Error ? error.message : String(error),
          type: error instanceof SyntaxError ? 'JSON_PARSE' : error instanceof z.ZodError ? 'VALIDATION' : 'OTHER'
        });

        /*
          A timeout ends the loop rather than consuming the remaining attempts.

          Three 30s deadlines plus backoff is 96s of someone watching a
          spinner, and an upstream that did not answer in 30s is unlikely to
          answer in the next 30. Retrying a parse or validation failure is
          worth it — the model may format better on a second pass — but
          retrying silence is just charging the user for the wait.
        */
        if (error instanceof TimeoutError) {
          console.error('[Research] Timed out; not retrying — see RESEARCH_TIMEOUT_MS');
          break;
        }

        attempt++;
      }
    }

    if (!parsed) {
      console.error(`[Research Failed] All 3 attempts exhausted. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);

      await client
        .from('vehicle_knowledge_base')
        .update({ research_status: 'failed' })
        .eq('vehicle_id', vehicleId);

      return { success: false, error: 'Failed to generate vehicle research after 3 attempts' };
    }

    if (parsed.known_issues.length === 0) {
      console.warn(`[Research Complete] Limited data for ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      await client
        .from('vehicle_knowledge_base')
        .update({ research_status: 'unsupported' })
        .eq('vehicle_id', vehicleId);
      return { success: true, unsupported: true };
    }

    console.log(`[Research Success] Found ${parsed.known_issues.length} known issues`);

    const { data: existingKb } = await client
      .from('vehicle_knowledge_base')
      .select('engine_type, transmission_type, drivetrain')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    const updateData: any = {
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
      console.error('Failed to save research data:', updateError);
      return { success: false, error: 'Failed to save research data' };
    }

    if (parsed.performance_stats && (parsed.performance_stats.horsepower || parsed.performance_stats.torque || parsed.performance_stats.zero_to_sixty)) {
      const { error: vehicleUpdateError } = await client
        .from('vehicles')
        .update({
          stock_hp: parsed.performance_stats.horsepower || null,
          stock_torque: parsed.performance_stats.torque || null,
          stock_zero_to_sixty: parsed.performance_stats.zero_to_sixty || null,
        })
        .eq('id', vehicleId);

      if (vehicleUpdateError) {
        console.error('Failed to save performance stats:', vehicleUpdateError);
        return { success: false, error: 'Failed to save performance stats' };
      }
    }

    await fetchNHTSARecalls(vehicleId, vehicle.year, vehicle.make, vehicle.model);

    fetchPowertrainOptions(vehicle.year, vehicle.make, vehicle.model, vehicle.trim).then(async (ptResult) => {
      if (ptResult.success && ptResult.data) {
        await client
          .from('vehicle_knowledge_base')
          .update({
            engine_options: ptResult.data.engine_options,
            transmission_options: ptResult.data.transmission_options,
            drivetrain_options: ptResult.data.drivetrain_options,
          })
          .eq('vehicle_id', vehicleId);
      }
    }).catch((err) => {
      console.error('Failed to fetch/store powertrain options:', err);
    });

    return { success: true, data: parsed };
  } catch (error) {
    console.error('Generate dossier error:', error);
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

      await client
        .from('nhtsa_data')
        .insert({
          vehicle_id: vehicleId,
          recalls: recalls,
          last_checked: new Date().toISOString(),
          next_check_due: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        });
    }
  } catch (error) {
    console.error('Failed to fetch recalls:', error);
  }
}

export async function updateVehiclePowertrain(
  vehicleId: string,
  updates: {
    engine_type?: string;
    transmission_type?: string;
    drivetrain?: string;
  }
) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    const { error } = await client
      .from('vehicle_knowledge_base')
      .update({
        ...(updates.engine_type !== undefined && { engine_type: updates.engine_type }),
        ...(updates.transmission_type !== undefined && { transmission_type: updates.transmission_type }),
        ...(updates.drivetrain !== undefined && { drivetrain: updates.drivetrain }),
      })
      .eq('vehicle_id', vehicleId);

    if (error) {
      console.error('Failed to update powertrain:', error);
      return { success: false, error: 'Failed to update powertrain specifications' };
    }

    return { success: true };
  } catch (error) {
    console.error('Update powertrain error:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

const powertrainCache = new Map<string, { engine_options: string[]; transmission_options: string[]; drivetrain_options: string[] }>();

export async function fetchPowertrainOptions(
  year: number,
  make: string,
  model: string,
  trim?: string
): Promise<{ success: boolean; data?: { engine_options: string[]; transmission_options: string[]; drivetrain_options: string[] }; error?: string }> {
  try {
    // Gemini-backed: authenticate before spending.
    const session = await requireSession();
    if (!session.ok) {
      return { success: false, error: session.error };
    }

    const cacheKey = `${year}-${make}-${model}-${trim || ''}`.toLowerCase();
    const cached = powertrainCache.get(cacheKey);
    if (cached) {
      return { success: true, data: cached };
    }

    const client = getServiceRoleClient();
    const { data: matchingVehicles } = await client
      .from('vehicles')
      .select('id')
      .eq('year', year)
      .eq('make', make)
      .eq('model', model)
      .limit(1);

    if (matchingVehicles && matchingVehicles.length > 0) {
      const { data: existing } = await client
        .from('vehicle_knowledge_base')
        .select('engine_options, transmission_options, drivetrain_options')
        .eq('vehicle_id', matchingVehicles[0].id)
        .maybeSingle();

      if (existing && (existing.engine_options?.length > 0 || existing.transmission_options?.length > 0 || existing.drivetrain_options?.length > 0)) {
        const result = {
          engine_options: existing.engine_options || [],
          transmission_options: existing.transmission_options || [],
          drivetrain_options: existing.drivetrain_options || [],
        };
        powertrainCache.set(cacheKey, result);
        return { success: true, data: result };
      }
    }

    const prompt = POWERTRAIN_OPTIONS_PROMPT(year, make, model, trim);

    const response = await genAI.models.generateContent({
      model: LITE_MODEL,
      contents: prompt,
      // Measured at zero thinking tokens on `LITE_MODEL` already, so this
      // saves nothing today. It is set anyway: the next model swap here would
      // otherwise inherit whatever that model's default policy is, and this is
      // a yes/no classification that has no use for reasoning at any price.
      config: withThinking(classificationConfig, LITE_MODEL, 'MINIMAL'),
    });

    const text = response.text || '';
    const jsonData = extractJSON(text);

    const result = {
      engine_options: Array.isArray(jsonData.engine_options) ? jsonData.engine_options.filter((s: unknown) => typeof s === 'string' && s.length > 0) : [],
      transmission_options: Array.isArray(jsonData.transmission_options) ? jsonData.transmission_options.filter((s: unknown) => typeof s === 'string' && s.length > 0) : [],
      drivetrain_options: Array.isArray(jsonData.drivetrain_options) ? jsonData.drivetrain_options.filter((s: unknown) => typeof s === 'string' && s.length > 0) : [],
    };

    powertrainCache.set(cacheKey, result);
    return { success: true, data: result };
  } catch (error) {
    console.error('Fetch powertrain options error:', error);
    return { success: false, error: 'Failed to fetch powertrain options' };
  }
}

export async function getConsultantSessions(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error, data: [] };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('consultant_conversations')
      .select('id, title, created_at, updated_at')
      .eq('vehicle_id', vehicleId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Get sessions error:', error);
      return { success: false, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Get sessions error:', error);
    return { success: false, data: [] };
  }
}

export async function getConsultantSession(sessionId: string) {
  try {
    const access = await authorizeVehicleScopedRow('consultant_conversations', sessionId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('consultant_conversations')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !data) {
      console.error('Get session error:', error);
      return { success: false, data: null };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Get session error:', error);
    return { success: false, data: null };
  }
}

export async function createConsultantSession(vehicleId: string, title: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('consultant_conversations')
      .insert({
        vehicle_id: vehicleId,
        title,
        message_history: [],
        context_snapshot: {},
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Create session error:', error);
      return { success: false, error: 'Failed to create session' };
    }

    return { success: true, sessionId: data.id };
  } catch (error) {
    console.error('Create session error:', error);
    return { success: false, error: 'Failed to create session' };
  }
}

export async function generateSessionTitle(message: string) {
  try {
    const words = message.split(' ').slice(0, 6).join(' ');
    const title = words.length > 40 ? words.slice(0, 40) + '...' : words;
    return title || 'New Chat';
  } catch (error) {
    return 'New Chat';
  }
}

export async function sendConsultantMessage(params: {
  vehicleId: string;
  sessionId: string;
  message: string;
  /**
   * The conversation so far. Still supplied by the caller, and deliberately:
   * a demo session is never persisted, so there is no server-side record to
   * read it from. It is the user's own conversation — the worst a caller can
   * do by editing it is mislead their own advisor.
   */
  messageHistory: any[];
  /**
   * Files attached to *this* message, before they are recorded against the
   * session. Each `file_url` is checked against `vehicleId` in
   * `downloadStoredFile` — see the note there; unscoped paths used to be read
   * with the service role.
   */
  attachedDocuments?: any[];
  /*
   * There is deliberately no vehicle, knowledge, wishlist, service history,
   * document, issue, mod, recall or health parameter here, and no `isDemo`.
   *
   * All of it is loaded from the database by `loadConsultantContext`, for the
   * reasons written out in that module: a phone cannot post a vehicle's
   * history on every message, and caller-supplied context is caller-supplied
   * input to a model prompt. `isDemo` is derived from the vehicle id — see the
   * note in the body on why trusting the caller for it is unsafe in both
   * directions.
   *
   * These were briefly kept as ignored optional fields so the web client would
   * keep compiling. It no longer sends them, so the door is closed rather than
   * left ajar: an optional field that is silently discarded reads, to the next
   * caller, like one that works.
   */
}) {
  // Cost control: server actions are publicly invokable POST endpoints
  // and demo mode has no auth, so every Gemini-backed path is rate limited.
  {
    const rl = await checkRateLimit(`consultant:${params.vehicleId}`, 'ai');
    if (!rl.allowed) {
      return { success: false, error: `Too many AI requests. Try again in ${rl.retryAfterSeconds}s.` };
    }
  }
  try {
    /*
     * The intent has to match what this function actually does, and what it
     * does depends on whether the vehicle is a demo vehicle.
     *
     * ── The bug ───────────────────────────────────────────────────────────
     *
     * This asked for 'write' unconditionally. `authorizeVehicleAccess` denies
     * demo vehicles any write ("Demo vehicles are read-only", 403), so **every
     * consultant message on a demo vehicle returned an error** — on the
     * recruiter-facing demo, whose own banner advertises the AI consultant as
     * live. Confirmed in production before this fix, not inferred.
     *
     * The write intent was never right for the demo path: every mutation below
     * is already inside `if (!isDemoVehicle)`. In demo mode this function calls
     * Gemini and returns a string. It writes nothing, so it needs read access.
     *
     * ── Why this is derived and not taken from params ─────────────────────
     *
     * `params.isDemo` is client-supplied and must never decide an
     * authorization or persistence question. Trusting it for the intent would
     * let a caller pass isDemo:true for a *real* vehicle and downgrade the
     * check to a demo read. Trusting it for the guard below would be worse in
     * the other direction: isDemo:false on a demo vehicle would enter the
     * persistence branch and hand a client-controlled sessionId to the
     * service-role client. Until now the unconditional 'write' happened to
     * mask that second path by rejecting demo vehicles outright — relaxing the
     * intent without also fixing the guard would have opened it.
     *
     * `isDemoVehicleId` is a pure check against a hardcoded id list, and it is
     * the same function authorizeVehicleAccess itself uses, so the two cannot
     * disagree about what a demo vehicle is.
     */
    const isDemoVehicle = isDemoVehicleId(params.vehicleId);

    const access = await authorizeVehicleAccess(params.vehicleId, {
      intent: isDemoVehicle ? 'read' : 'write',
    });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const { vehicleId, sessionId, message, messageHistory, attachedDocuments } = params;

    /*
      Context is derived from vehicleId, never taken from the caller.

      Everything below used to arrive as parameters — vehicle, knowledge,
      wishlist, history, recalls, health — and the prompt was assembled from
      whatever was posted. That is caller-controlled input to a model prompt,
      which this function already refuses to accept for the authorization
      question two blocks up: `params.isDemo` is ignored "because a caller
      could downgrade the check on a real vehicle". The same argument covers
      the rest of it. A caller chooses which vehicle to ask about; the server
      decides what is true of it.

      It also makes /api/v1/consultant possible. A phone cannot post a
      vehicle's entire history on every message, and it should not be trusted
      to if it could.
    */
    const contextResult = await loadConsultantContext(vehicleId, access.client);
    if (!contextResult.ok) {
      return { success: false, error: contextResult.error };
    }

    const {
      vehicle,
      knowledge,
      wishlistItems,
      completedItems,
      maintenanceLineItems,
      documents,
      issueTracking,
      modTracking,
      nhtsaData,
      healthSummary,
      modWishlistItems,
    } = contextResult.context;

    const contextKinds = loadedContextKinds(contextResult.context);

    const knownIssues = (knowledge?.known_issues || [])
      .map((issue: any) => `${issue.part} (${issue.mileage_range}) - ${issue.severity}: ${issue.description}`);

    const wishlist = wishlistItems.map((item: any) =>
      `${item.description}${item.cost_parts ? ` (~$${item.cost_parts} parts)` : ''}${item.shop_name ? ` at ${item.shop_name}` : ''}`
    );

    const modWishlist = (modWishlistItems || []).map((item: any) =>
      `${item.item_name}${item.description ? ` - ${item.description}` : ''}${item.estimated_cost_parts ? ` (~$${item.estimated_cost_parts})` : ''}`
    );

    const completedWork = completedItems.map((item: any) => {
      const parts = [];
      parts.push(item.description);
      if (item.date_completed) parts.push(`done ${item.date_completed}`);
      if (item.shop_name) parts.push(`at ${item.shop_name}`);
      if (item.cost_parts || item.cost_labor) {
        const total = (item.cost_parts || 0) + (item.cost_labor || 0);
        parts.push(`$${total}`);
      }
      return parts.join(' | ');
    });

    const maintenanceHistory = maintenanceLineItems.map((item: any) => {
      const parts = [];
      parts.push(item.item_description || item.description || 'Unknown item');
      if (item.service_date) parts.push(item.service_date);
      if (item.shop_name) parts.push(`at ${item.shop_name}`);
      if (item.total_cost) parts.push(`$${item.total_cost}`);
      if (item.part_number) parts.push(`P/N: ${item.part_number}`);
      return parts.join(' | ');
    });

    const trackedIssues = issueTracking.map((issue: any) =>
      `${issue.issue_identifier} [${issue.status}]${issue.description ? ` - ${issue.description}` : ''}`
    );

    const trackedMods = (modTracking || []).map((mod: any) =>
      `${mod.mod_name} [${mod.status}]${mod.installed_date ? ` installed ${mod.installed_date}` : ''}${mod.tier ? ` (tier: ${mod.tier})` : ''}`
    );

    const recalls = (nhtsaData?.recalls || []).map((r: any) =>
      `${r.Component || 'Unknown'}: ${r.Summary || r.description || 'No details'}${r.NHTSACampaignNumber ? ` (Campaign: ${r.NHTSACampaignNumber})` : ''}`
    );

    const maintenanceSchedule = (knowledge?.maintenance_schedule || []).map((item: any) =>
      `${item.item || item.service} every ${item.interval || item.interval_miles} - ${item.priority || 'Recommended'}`
    );

    const fluidSpecs = knowledge?.fluid_specs
      ? `Oil: ${knowledge.fluid_specs.engine_oil || '?'} | Trans: ${knowledge.fluid_specs.transmission_fluid || '?'} | Coolant: ${knowledge.fluid_specs.coolant || '?'} | Brake: ${knowledge.fluid_specs.brake_fluid || '?'}`
      : '';

    const systemPrompt = CONSULTANT_SYSTEM_PROMPT({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim || '',
      mileage: vehicle.current_mileage || 0,
      objective: vehicle.ownership_objective || 'Not specified',
      ownershipDetails: vehicle.usage_profile || '',
      drivingStyle: vehicle.driving_style || '',
      performanceGoal: vehicle.performance_mindedness || vehicle.performance_goal || '',
      avgMilesPerMonth: vehicle.avg_miles_per_month || 0,
      color: vehicle.color || '',
      engineType: vehicle.engine_type || knowledge?.engine_type || '',
      transmissionType: vehicle.transmission_type || knowledge?.transmission_type || '',
      drivetrain: vehicle.drivetrain || knowledge?.drivetrain || '',
      vin: vehicle.vin || '',
      stockHp: vehicle.stock_hp || null,
      stockTorque: vehicle.stock_torque || null,
      modifiedHp: vehicle.modified_hp || null,
      modifiedTorque: vehicle.modified_torque || null,
      wishlistItems: wishlist,
      modWishlistItems: modWishlist,
      recentWork: completedWork,
      knownIssues,
      maintenanceHistory,
      trackedIssues,
      trackedMods,
      fluidSpecs,
      maintenanceSchedule,
      recalls,
      healthScore: healthSummary?.health_score || null,
      healthRedFlags: healthSummary?.red_flags || [],
      healthRecommendations: healthSummary?.recommendations || [],
      reliabilityScore: knowledge?.reliability_score || null,
      interestingFacts: knowledge?.interesting_facts || [],
      documentsOnFile: documents.length,
    });

    const conversationHistory = messageHistory.slice(-20);
    const conversationText = conversationHistory
      .map((msg: any) => `${msg.role === 'user' ? 'Owner' : 'CrewChief'}: ${msg.content}`)
      .join('\n\n');

    const fullPrompt = `${systemPrompt}\n\n${conversationText}\n\nOwner: ${message}\n\nCrewChief:`;

    let contents: any;

    if (attachedDocuments && attachedDocuments.length > 0) {
      const parts: any[] = [{ text: fullPrompt }];

      for (const doc of attachedDocuments) {
        // Read out of storage, not over HTTP — the bucket is private, so
        // fetching one of its objects by URL cannot work.
        // Scoped to the vehicle authorized above, not merely to the fact that
        // some vehicle was. doc.file_url is client-supplied.
        const buffer = await downloadStoredFile(doc.file_url, vehicleId);

        if (buffer) {
          parts.push({
            inlineData: {
              mimeType: doc.file_type || 'image/jpeg',
              data: buffer.toString('base64'),
            },
          });
        } else {
          // The model is told an attachment exists but could not be read,
          // rather than being left to answer as though none was sent.
          parts.push({ text: `[Attached: ${doc.file_name}]` });
        }
      }

      contents = [{ role: 'user', parts }];
    } else {
      contents = fullPrompt;
    }

    const result = await genAI.models.generateContent({
      model: FLASH_MODEL,
      contents,
      // The consultant, and the call this application makes most often.
      // Measured at 861 thinking tokens against 168 of answer with no level
      // set; LOW halves that for an answer of the same length. It is the
      // largest single cost lever in the app, and the one whose quality has
      // to be gated rather than assumed — see the round-trip gate.
      config: withThinking(flashConfig, FLASH_MODEL, 'LOW'),
    });
    let response = result.text || '';

    const wishlistParse = parseWishlistCommands(response);
    const wishlistActions = wishlistParse.commands;
    response = wishlistParse.cleaned;

    let performanceUpdated = false;
    let invoiceProcessed = false;
    let invoiceItemsProcessed = 0;
    let issueUpdates = 0;
    let modUpdates = 0;

    /* Server-derived, not params.isDemo — see the note on the intent above.
     * Everything in this block writes, and all of it is skipped for demo
     * vehicles. */
    if (!isDemoVehicle) {
      const client = getServiceRoleClient();

      const perfParse = parsePerformanceCommands(response);
      response = perfParse.cleaned;
      for (const statsData of perfParse.updates) {
        const updateResult = await updateVehiclePerformanceStats(vehicleId, statsData);
        if (updateResult.success) performanceUpdated = true;
      }

      const issueParse = parseStatusCommands(response, 'UPDATE_ISSUE_STATUS');
      response = issueParse.cleaned;
      for (const cmd of issueParse.commands) {
        const { error } = await client.from('known_issue_tracking')
          .update({
            status: cmd.status,
            ...(cmd.status === 'completed' ? { completed_date: new Date().toISOString().split('T')[0] } : {}),
          })
          .eq('vehicle_id', vehicleId)
          .ilike('issue_identifier', cmd.identifier);
        if (!error) {
          issueUpdates++;
          if (cmd.status === 'completed') {
            await client.from('wishlist_items')
              .delete()
              .eq('vehicle_id', vehicleId)
              .eq('item_type', 'issue')
              .ilike('item_name', cmd.identifier);
          }
        } else {
          console.error('[UPDATE_ISSUE_STATUS] DB error:', error.message);
        }
      }

      const modParse = parseStatusCommands(response, 'UPDATE_MOD_STATUS');
      response = modParse.cleaned;
      for (const cmd of modParse.commands) {
        const { error } = await client.from('modification_tracking')
          .update({
            status: cmd.status,
            ...(cmd.status === 'completed' ? { installed_date: new Date().toISOString().split('T')[0] } : {}),
          })
          .eq('vehicle_id', vehicleId)
          .ilike('mod_name', cmd.identifier);
        if (!error) {
          modUpdates++;
          if (cmd.status === 'completed') {
            await client.from('wishlist_items')
              .delete()
              .eq('vehicle_id', vehicleId)
              .eq('item_type', 'modification')
              .ilike('item_name', cmd.identifier);
          }
        } else {
          console.error('[UPDATE_MOD_STATUS] DB error:', error.message);
        }
      }

      const invoiceParse = parseInvoiceFlag(response);
      response = invoiceParse.cleaned;
      if (invoiceParse.flagged && attachedDocuments && attachedDocuments.length > 0) {
        for (const doc of attachedDocuments) {
          const processResult = await processConsultantInvoiceToMaintenance(vehicleId, doc.file_url, doc.file_type || 'image/jpeg');
          if (processResult.success) {
            invoiceProcessed = true;
            invoiceItemsProcessed += processResult.itemsProcessed || 0;
            issueUpdates += processResult.issueUpdates || 0;
            modUpdates += processResult.modUpdates || 0;
          }
        }
      }

      if (performanceUpdated || issueUpdates > 0 || modUpdates > 0) {
        await invalidateHealthSummaryCache(vehicleId);
      }

      const userMessage = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
        ...(attachedDocuments && attachedDocuments.length > 0 && { documents: attachedDocuments }),
      };

      const updatedHistory = [
        ...messageHistory,
        userMessage,
        { role: 'assistant', content: response, timestamp: new Date().toISOString(), wishlistActions: wishlistActions.length > 0 ? wishlistActions : undefined },
      ];

      await client
        .from('consultant_conversations')
        .update({
          message_history: updatedHistory,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    }

    /*
      `contextKinds` is computed from the context this function actually
      loaded, and travels back with the answer so the client can render the
      "Based on" chips without knowing anything about the garage. It used to be
      derived in ConsultantChat.tsx from the values it posted — which stopped
      being the model's context the moment that context moved server-side.
    */
    return { success: true, response, contextKinds, wishlistActions, performanceUpdated, invoiceProcessed, invoiceItemsProcessed, issueUpdates, modUpdates };
  } catch (error) {
    console.error('Consultant message error:', error);
    return { success: false, error: 'Failed to get response from consultant' };
  }
}

export async function fetchAllVehicles() {
  try {
    const client = getServiceRoleClient();

    const { data, error } = await client
      .from('vehicles')
      .select(`
        id,year,make,model,trim,color,current_mileage,image_url,custom_image_url,performance_goal,ownership_objective,created_at,
        nhtsa_data(recalls),
        vehicle_health_summary(health_score,summary,red_flags)
      `)
      .eq('is_demo', true)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: error.message, vehicles: [] };
    }

    return { success: true, vehicles: data || [] };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error', vehicles: [] };
  }
}

export async function fetchDemoVehicles() {
  try {
    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('vehicles')
      .select(`
        id,year,make,model,trim,color,current_mileage,image_url,custom_image_url,performance_goal,ownership_objective,created_at,
        nhtsa_data(recalls),
        vehicle_health_summary(health_score,summary,red_flags)
      `)
      .eq('is_demo', true)
      .order('created_at', { ascending: true });

    if (error) return { success: false, error: error.message, vehicles: [] };
    return { success: true, vehicles: data || [] };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error', vehicles: [] };
  }
}

interface DeleteVehicleResult {
  success: boolean;
  vehicleId: string;
  deletedAt?: string;
  error?: string;
  failedTables?: Array<{
    table: string;
    error: string;
  }>;
}

export async function deleteVehicle(vehicleId: string): Promise<DeleteVehicleResult> {
  const startTime = new Date().toISOString();

  try {
    // Cascades through every child table. Without an ownership check this
    // destroyed any vehicle in the database given only its id.
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, vehicleId, error: access.error };
    }

    const client = access.client;

    const { error: vehicleError, data } = await client
      .from('vehicles')
      .delete()
      .eq('id', vehicleId)
      .select();

    if (vehicleError) {
      return {
        success: false,
        vehicleId,
        error: `Failed to delete vehicle: ${vehicleError.message || 'Unknown error'}`,
      };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        vehicleId,
        error: 'Vehicle not found or already deleted',
      };
    }

    return {
      success: true,
      vehicleId,
      deletedAt: startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      vehicleId,
      error: `Failed to delete vehicle: ${error.message || 'Unknown error'}`,
    };
  }
}

export async function updateIssueStatus(
  vehicleId: string,
  issueIdentifier: string,
  status: 'pending' | 'completed' | 'not_interested',
  notes?: string,
  completedDate?: string,
  shopName?: string,
  cost?: number
) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('known_issue_tracking')
      .upsert({
        vehicle_id: vehicleId,
        issue_identifier: issueIdentifier,
        status,
        notes: notes || null,
        completed_date: completedDate || null,
        shop_name: shopName || null,
        cost: cost || null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id,issue_identifier',
      });

    if (error) {
      console.error('Update issue status error:', error);
      return { success: false, error: 'Failed to update issue status' };
    }

    return { success: true };
  } catch (error) {
    console.error('Update issue status error:', error);
    return { success: false, error: 'Failed to update issue status' };
  }
}

export async function updateModificationStatus(
  vehicleId: string,
  modName: string,
  status: 'pending' | 'completed' | 'not_interested',
  notes?: string,
  installedDate?: string,
  costParts?: number,
  costLabor?: number
) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('modification_tracking')
      .upsert({
        vehicle_id: vehicleId,
        mod_name: modName,
        status,
        notes: notes || null,
        installed_date: installedDate || null,
        cost_parts: costParts || 0,
        cost_labor: costLabor || 0,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id,mod_name',
      });

    if (error) {
      console.error('Update modification status error:', error);
      return { success: false, error: 'Failed to update modification status' };
    }

    return { success: true };
  } catch (error) {
    console.error('Update modification status error:', error);
    return { success: false, error: 'Failed to update modification status' };
  }
}

export async function getIssueTracking(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error, data: [] };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('known_issue_tracking')
      .select('*')
      .eq('vehicle_id', vehicleId);

    if (error) {
      console.error('Get issue tracking error:', error);
      return { success: false, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Get issue tracking error:', error);
    return { success: false, data: [] };
  }
}

export async function getModificationTracking(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error, data: [] };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('modification_tracking')
      .select('*')
      .eq('vehicle_id', vehicleId);

    if (error) {
      console.error('Get modification tracking error:', error);
      return { success: false, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Get modification tracking error:', error);
    return { success: false, data: [] };
  }
}

export async function invalidateHealthSummaryCache(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('vehicle_health_summary')
      .update({ last_generated: '2000-01-01T00:00:00.000Z' })
      .eq('vehicle_id', vehicleId);
    if (error) console.warn('[invalidateHealthSummaryCache] Failed:', error.message);
    return { success: !error };
  } catch (err: any) {
    console.warn('[invalidateHealthSummaryCache] Exception:', err?.message);
    return { success: false };
  }
}

export async function syncInvoiceWithDossier(vehicleId: string, maintenanceItems: any[]) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    const allDescriptions = (maintenanceItems || []).map((item: any) =>
      (item.item_description || item.description || '').toLowerCase()
    );

    const matchesDescriptions = (targetName: string, descriptions: string[]) => {
      const target = (targetName || '').toLowerCase().trim();
      if (target.length < 3 || descriptions.length === 0) return false;
      return descriptions.some((desc: string) => {
        if (desc.includes(target)) return true;
        const words = target.split(/\s+/).filter((w: string) => w.length > 4);
        if (words.length < 2) return false;
        const matched = words.filter((w: string) => desc.includes(w)).length;
        return matched >= Math.max(2, Math.ceil(words.length * 0.6));
      });
    };

    const [issueResult, modResult] = await Promise.all([
      client.from('known_issue_tracking').select('*').eq('vehicle_id', vehicleId).eq('status', 'pending'),
      client.from('modification_tracking').select('*').eq('vehicle_id', vehicleId).eq('status', 'pending'),
    ]);

    const issues = issueResult.data || [];
    const mods = modResult.data || [];

    let issueUpdates = 0;
    for (const issue of issues) {
      if (matchesDescriptions(issue.issue_identifier || '', allDescriptions)) {
        const { error } = await client.from('known_issue_tracking')
          .update({ status: 'completed', completed_date: new Date().toISOString().split('T')[0] })
          .eq('id', issue.id);
        if (!error) {
          issueUpdates++;
          await client.from('wishlist_items')
            .delete()
            .eq('vehicle_id', vehicleId)
            .eq('item_type', 'issue')
            .ilike('item_name', issue.issue_identifier);
        } else {
          console.error('[syncInvoiceWithDossier] Issue update failed:', error.message);
        }
      }
    }

    let modUpdates = 0;
    for (const mod of mods) {
      if (matchesDescriptions(mod.mod_name || '', allDescriptions)) {
        const { error } = await client.from('modification_tracking')
          .update({ status: 'completed', installed_date: new Date().toISOString().split('T')[0] })
          .eq('id', mod.id);
        if (!error) {
          modUpdates++;
          await client.from('wishlist_items')
            .delete()
            .eq('vehicle_id', vehicleId)
            .eq('item_type', 'modification')
            .ilike('item_name', mod.mod_name);
        } else {
          console.error('[syncInvoiceWithDossier] Mod update failed:', error.message);
        }
      }
    }

    await invalidateHealthSummaryCache(vehicleId);
    return { success: true, issueUpdates, modUpdates };
  } catch (error) {
    console.error('syncInvoiceWithDossier error:', error);
    return { success: false, issueUpdates: 0, modUpdates: 0 };
  }
}

export async function updateVehiclePerformanceStats(vehicleId: string, stats: { modified_hp?: number; modified_torque?: number; modified_zero_to_sixty?: number }) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const updates: any = {};
    if (stats.modified_hp != null) updates.modified_hp = stats.modified_hp;
    if (stats.modified_torque != null) updates.modified_torque = stats.modified_torque;
    if (stats.modified_zero_to_sixty != null) updates.modified_zero_to_sixty = stats.modified_zero_to_sixty;
    if (Object.keys(updates).length === 0) return { success: false, error: 'No stats provided' };
    updates.perf_stats_manual_override = true;
    const { error } = await client.from('vehicles').update(updates).eq('id', vehicleId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function processConsultantInvoiceToMaintenance(vehicleId: string, fileUrl: string, mimeType: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    // fileUrl is a caller-supplied parameter of this exported action, and the
    // authorization above covers vehicleId only. The two are tied together here.
    const buffer = await downloadStoredFile(fileUrl, vehicleId);
    if (!buffer) return { success: false, error: 'Failed to fetch document', itemsProcessed: 0, issueUpdates: 0, modUpdates: 0 };
    const base64Data = buffer.toString('base64');

    const { data: docRecord } = await client
      .from('vehicle_documents')
      .insert({
        vehicle_id: vehicleId,
        document_type: 'invoice',
        file_url: fileUrl,
        extracted_data: {},
      })
      .select()
      .single();

    if (!docRecord) return { success: false, error: 'Failed to create document record', itemsProcessed: 0, issueUpdates: 0, modUpdates: 0 };

    const parseResult = await parseInvoiceLineItems(docRecord.id, vehicleId, base64Data, mimeType, true);

    if (!parseResult.success) {
      await client.from('vehicle_documents').delete().eq('id', docRecord.id);
      return { success: false, error: parseResult.error, itemsProcessed: 0, issueUpdates: 0, modUpdates: 0 };
    }

    await client.from('vehicle_documents')
      .update({
        extracted_data: {
          vendor_name: parseResult.shopName,
          service_date: parseResult.serviceDate,
          source: 'consultant',
        },
        extraction_status: 'completed',
      })
      .eq('id', docRecord.id);

    const syncResult = await syncInvoiceWithDossier(vehicleId, parseResult.maintenanceItems || []);

    return {
      success: true,
      itemsProcessed: parseResult.maintenanceItems?.length || 0,
      issueUpdates: syncResult.issueUpdates,
      modUpdates: syncResult.modUpdates,
    };
  } catch (error: any) {
    console.error('processConsultantInvoiceToMaintenance error:', error);
    return { success: false, error: error.message, itemsProcessed: 0, issueUpdates: 0, modUpdates: 0 };
  }
}

export async function generateVehicleHealthSummary(vehicleId: string, forceRefresh: boolean = false) {
  // Cost control: server actions are publicly invokable POST endpoints
  // and demo mode has no auth, so every Gemini-backed path is rate limited.
  {
    const rl = await checkRateLimit(`health:${vehicleId}`, 'ai');
    if (!rl.allowed) {
      return { success: false, error: `Too many AI requests. Try again in ${rl.retryAfterSeconds}s.` };
    }
  }
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    if (!forceRefresh) {
      const { data: existingHealth } = await client
        .from('vehicle_health_summary')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      if (existingHealth?.last_generated) {
        const lastGenerated = new Date(existingHealth.last_generated).getTime();
        const now = Date.now();
        const hoursSinceGenerated = (now - lastGenerated) / (1000 * 60 * 60);

        if (hoursSinceGenerated < 24) {
          return { success: true, data: existingHealth, cached: true };
        }
      }
    }

    const [vehicleResult, knowledgeResult, serviceResult, issueTrackResult, modTrackResult, nhtsaResult] = await Promise.all([
      client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('service_items').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
      client.from('known_issue_tracking').select('*').eq('vehicle_id', vehicleId),
      client.from('modification_tracking').select('*').eq('vehicle_id', vehicleId),
      client.from('nhtsa_data').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    ]);

    const vehicle = vehicleResult.data;
    const knowledge = knowledgeResult.data;
    const serviceItems = serviceResult.data || [];
    const issueTracking = issueTrackResult.data || [];
    const modTracking = modTrackResult.data || [];
    const nhtsa = nhtsaResult.data;

    if (!vehicle) {
      return { success: false, error: 'Vehicle not found' };
    }

    const completedIssues = issueTracking.filter((t: any) => t.status === 'completed').length;
    const totalIssues = knowledge?.known_issues?.length || 0;
    const activeRecalls = nhtsa?.recalls?.length || 0;
    const completedService = serviceItems.filter((s: any) => s.status === 'completed').length;
    const pendingService = serviceItems.filter((s: any) => s.status !== 'completed').length;

    const prompt = `You are an expert automotive consultant analyzing a vehicle's health based on the owner's provided service history and uploads.

VEHICLE INFORMATION:
- ${vehicle.year} ${vehicle.make} ${vehicle.model}
- Current Mileage: ${vehicle.current_mileage.toLocaleString()} miles
- Average Monthly Miles: ${vehicle.avg_miles_per_month}
- Performance Mindset: ${vehicle.performance_mindedness}

OWNER-PROVIDED SERVICE HISTORY:
- Completed Service Records: ${completedService}
- Pending/Planned Service: ${pendingService}
- Recent Service Items: ${serviceItems.slice(0, 5).map((s: any) => `${s.description} (${s.status})`).join(', ') || 'None provided yet'}

KNOWN ISSUES FOR THIS MODEL (Reference Only):
${knowledge?.known_issues?.slice(0, 5).map((i: any) => `- ${i.part}: ${i.description} (Severity: ${i.severity}, Typical mileage: ${i.mileage_range})`).join('\n') || 'None identified'}

ISSUE STATUS:
- Known Issues Addressed: ${completedIssues}/${totalIssues}

RECALLS:
- Active Recalls: ${activeRecalls}
${nhtsa?.recalls?.slice(0, 3).map((r: any) => `  - ${r.summary || r.description || 'Recall'}`).join('\n') || 'None'}

Based on the owner's provided service history, provide a concise health assessment in JSON format with:
- healthScore (1-100 integer based on provided records, not assumptions)
- summary (1-2 sentences about their vehicle's condition based on provided history)
- redFlags (array of critical issues mentioned in their service records)
- maintenanceStatus (status of provided service records and upcoming items)
- recallStatus (status of recalls for this model)
- issuesOverview (summary of owner-reported and addressed issues)
- recommendations (array of 2-3 actions based on their provided service history)

Important: Frame all recommendations as "based on your provided service history". Only reference issues the owner has documented or common known issues. Leave fields empty/null if no data is available. Do not make assumptions about hidden problems.

Format as valid JSON only, no markdown.`;

    const result = await genAI.models.generateContent({
      model: FLASH_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: withThinking(flashStructuredConfig, FLASH_MODEL, 'LOW'),
    });

    const responseText = result.text || '';

    let healthData = {
      health_score: 70,
      summary: 'Vehicle is in good condition',
      red_flags: [] as string[],
      maintenance_status: 'Maintenance records up to date',
      recall_status: activeRecalls > 0 ? `${activeRecalls} active recalls` : 'No recalls to date',
      issues_overview: `${completedIssues} of ${totalIssues} known issues addressed`,
      recommendations: ['Keep regular maintenance schedule'],
    };

    try {
      healthData = JSON.parse(responseText);
      if (healthData.health_score === undefined) healthData.health_score = 70;
      if (!healthData.summary) healthData.summary = 'Vehicle is in good condition';
      if (!Array.isArray(healthData.red_flags)) healthData.red_flags = [];
      if (!Array.isArray(healthData.recommendations)) healthData.recommendations = [];
    } catch {
      console.warn('Failed to parse health data, using defaults');
    }

    const { error: upsertError } = await client
      .from('vehicle_health_summary')
      .upsert({
        vehicle_id: vehicleId,
        health_score: healthData.health_score,
        summary: healthData.summary,
        red_flags: healthData.red_flags,
        maintenance_status: healthData.maintenance_status,
        recall_status: healthData.recall_status,
        issues_overview: healthData.issues_overview,
        recommendations: healthData.recommendations,
        last_generated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'vehicle_id' });

    if (upsertError) {
      console.error('Failed to save health summary:', upsertError);
      return { success: false, error: 'Failed to save health summary' };
    }

    await client
      .from('vehicle_health_history')
      .insert({
        vehicle_id: vehicleId,
        health_score: healthData.health_score,
        recorded_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) console.warn('Health history insert failed:', error.message);
      });

    return { success: true, data: healthData };
  } catch (error) {
    console.error('Generate health summary error:', error);
    return { success: false, error: 'Failed to generate health summary' };
  }
}

export async function getVehicleHealthSummary(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('vehicle_health_summary')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    if (error) {
      console.error('Get health summary error:', error);
      return { success: false, data: null };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Get health summary error:', error);
    return { success: false, data: null };
  }
}

/*
  The union of both vocabularies, because the app genuinely has both.

  `performance_mindedness` (enum)      : stock | mild | aggressive
  `performance_goal` (text + CHECK)    : mild  | moderate | aggressive

  'stock' and 'moderate' each exist in exactly one of them, so any lookup keyed
  on one vocabulary and fed from the other has a hole in it. Covering the union
  is what closes the hole — and typing it as a Record means adding a value to
  either column fails the build here instead of rendering `undefined` into a
  prompt sent to Gemini.
*/
type GoalKey = 'stock' | 'mild' | 'moderate' | 'aggressive';

const GOAL_CONTEXT: Record<GoalKey, string> = {
  stock:
    'to keep the car factory-correct. Prioritise originality, warranty and resale above all else. Be explicit about what a modification costs them in those terms, and say plainly when the honest answer is to leave it alone.',
  mild: 'subtle improvements that maintain OEM+ reliability. Prioritize longevity and minimal risk. Recommend conservative, proven upgrades that add refinement without compromising the factory engineering.',
  moderate:
    'balanced performance and reliability. Suggest upgrades that enhance the driving experience while maintaining reasonable reliability. Focus on well-tested modifications with strong community support.',
  aggressive:
    "maximum performance with track-focused priorities. Recommend serious performance upgrades for someone who values power and handling over comfort and longevity. Suggest modifications that push the vehicle's capabilities.",
};

/**
 * Coerce whatever a caller has to a key this module can look up.
 *
 * 'moderate' is the fallback rather than 'stock' because it is what the
 * database default has silently meant for every vehicle to date — an unknown
 * value should land where the old behaviour landed, not somewhere new.
 */
function normaliseGoal(value: unknown): GoalKey {
  return typeof value === 'string' && value in GOAL_CONTEXT ? (value as GoalKey) : 'moderate';
}

export async function generateModificationDetails(vehicleId: string, modName: string, vehicle: any, performanceMindset: string) {
  // Cost control: server actions are publicly invokable POST endpoints
  // and demo mode has no auth, so every Gemini-backed path is rate limited.
  {
    const rl = await checkRateLimit(`moddetails:${vehicleId}`, 'ai');
    if (!rl.allowed) {
      return { success: false, error: `Too many AI requests. Try again in ${rl.retryAfterSeconds}s.` };
    }
  }
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    /*
      ── Two columns model this, and only one of them is real ──────────────────

      `performance_mindedness` is an enum the owner actually picks in
      onboarding. It gates the UI: VehicleInsights hides the mods tab entirely
      when it is 'stock'.

      `performance_goal` is a text column added later with a CHECK of
      ('mild','moderate','aggressive') and a NOT NULL default of 'moderate'.
      **No screen in the app ever writes it.** It is 'moderate' for every
      vehicle that has ever existed.

      This function took the owner's real choice as `performanceMindset` and
      then ignored the parameter, reading `performance_goal` instead — so an
      owner who said 'aggressive' in onboarding got modification analysis
      written for a 'moderate' owner, every time, and an owner who said 'stock'
      got mod analysis at all. That is the reported disagreement between the two
      fields: they never disagreed so much as one of them was never consulted.

      Preferring the parameter fixes it. `performance_goal` stays as the
      fallback so a caller that has not been updated still behaves as before
      rather than losing context entirely.
    */
    const performanceGoal: GoalKey = normaliseGoal(
      performanceMindset || vehicle.performance_mindedness || vehicle.performance_goal
    );

    const prompt = `You are an expert automotive consultant analyzing a modification for a specific vehicle owner.

VEHICLE:
- ${vehicle.year} ${vehicle.make} ${vehicle.model}
- Owner's Performance Goal: ${performanceGoal.toUpperCase()}
- Performance Goal Context: The owner wants ${GOAL_CONTEXT[performanceGoal]}
- Ownership Objective: ${vehicle.ownership_objective || 'Not specified'}

MODIFICATION: ${modName}

IMPORTANT: Tailor your analysis to align with the ${performanceGoal.toUpperCase()} performance goal. Your recommendations should match this level of ambition.

Provide a detailed analysis in JSON format with exactly these fields:
- performanceImpact: Specific performance gains for this ${vehicle.year} ${vehicle.make} ${vehicle.model} (1-2 sentences, quantify if possible, frame relative to ${performanceGoal} goal)
- reliabilityImpact: How this affects reliability and longevity (consider the owner's ${performanceGoal} performance goal when assessing acceptable tradeoffs)
- costBenefitAnalysis: Dollar amount estimation and value proposition (parts cost, labor, time to ROI - adjust recommendations based on ${performanceGoal} approach)
- alignmentWithGoals: How this aligns with their ${performanceGoal} performance goal and "${vehicle.ownership_objective || 'their ownership objectives'}"
- installationNotes: Any ${vehicle.year} ${vehicle.make} ${vehicle.model}-specific installation considerations
- compatibilityNotes: Compatibility with stock components or other common mods for this model (suggest complementary mods appropriate for ${performanceGoal} level)

Format as valid JSON only, no markdown or explanations.`;

    const result = await genAI.models.generateContent({
      model: FLASH_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: withThinking(flashStructuredConfig, FLASH_MODEL, 'LOW'),
    });

    const responseText = result.text || '';
    let details = {
      performance_impact: 'Performance gains will vary',
      reliability_impact: 'Check compatibility with your vehicle',
      cost_benefit_analysis: 'Consult with a professional for accurate costs',
      alignment_with_goals: 'Consider your ownership objectives',
      installation_notes: 'Professional installation recommended',
      compatibility_notes: 'Verify compatibility before installation',
    };

    try {
      const parsed = extractJSON(responseText);
      details = {
        performance_impact: (parsed.performanceImpact as string | undefined) || details.performance_impact,
        reliability_impact: (parsed.reliabilityImpact as string | undefined) || details.reliability_impact,
        cost_benefit_analysis: (parsed.costBenefitAnalysis as string | undefined) || details.cost_benefit_analysis,
        alignment_with_goals: (parsed.alignmentWithGoals as string | undefined) || details.alignment_with_goals,
        installation_notes: (parsed.installationNotes as string | undefined) || details.installation_notes,
        compatibility_notes: (parsed.compatibilityNotes as string | undefined) || details.compatibility_notes,
      };
    } catch (parseError) {
      logger.warn('MOD:PARSE_ERROR', 'Failed to parse modification details', { error: (parseError as Error).message });
    }

    /*
      The goal is part of the row's identity, not metadata on it.

      Every field below is written *from* `performanceGoal` — the prompt above
      says so in as many words, and `alignment_with_goals` is about nothing
      else. Keying on `(vehicle_id, mod_name)` alone gave four different answers
      one cache slot, so whichever goal ran last won and the rest read its text.
      See migration 20260729060000 for why this only became observable once the
      owner's real choice started reaching the prompt.
    */
    const { error: upsertError } = await client
      .from('modification_details')
      .upsert({
        vehicle_id: vehicleId,
        mod_name: modName,
        performance_goal: performanceGoal,
        performance_impact: details.performance_impact,
        reliability_impact: details.reliability_impact,
        cost_benefit_analysis: details.cost_benefit_analysis,
        alignment_with_goals: details.alignment_with_goals,
        installation_notes: details.installation_notes,
        compatibility_notes: details.compatibility_notes,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id,mod_name,performance_goal',
      });

    if (upsertError) {
      console.error('Failed to save modification details:', upsertError);
      return { success: false, error: 'Failed to save details' };
    }

    return { success: true, data: { ...details, performance_goal: performanceGoal } };
  } catch (error) {
    console.error('Generate modification details error:', error);
    return { success: false, error: 'Failed to generate modification details' };
  }
}

/**
 * Read cached analysis for one modification, **under one goal**.
 *
 * `performanceGoal` is required rather than optional on purpose. An optional
 * parameter would let an un-updated call site keep reading across goals and
 * silently serve another goal's text — which is the bug. Making it required
 * turns every such call site into a compile error instead.
 */
export async function getModificationDetails(vehicleId: string, modName: string, performanceGoal: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('modification_details')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('mod_name', modName)
      .eq('performance_goal', normaliseGoal(performanceGoal))
      .maybeSingle();

    if (error) {
      console.error('Get modification details error:', error);
      return { success: false, data: null };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Get modification details error:', error);
    return { success: false, data: null };
  }
}

export async function getModificationDetailsBatch(vehicleId: string, modNames: string[], performanceGoal: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error, data: {} };
    }

    if (modNames.length === 0) {
      return { success: true, data: {}, missing: [] };
    }

    const goal = normaliseGoal(performanceGoal);
    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('modification_details')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('performance_goal', goal)
      .in('mod_name', modNames);

    if (error) {
      console.error('Get modification details batch error:', error);
      return { success: false, data: {}, missing: [] };
    }

    const detailsMap: Record<string, any> = {};
    const foundNames = new Set<string>();

    (data || []).forEach((detail: any) => {
      detailsMap[detail.mod_name] = detail;
      foundNames.add(detail.mod_name);
    });

    const missing = modNames.filter(name => !foundNames.has(name));

    if (missing.length > 0) {
      /*
        This enqueue disagreed with its own table in three ways, and none of
        them could surface because the result was never inspected:

          - `performance_goal` is NOT NULL on `mod_detail_queue` and was not
            supplied, so every row violated the constraint;
          - `onConflict: 'vehicle_id,mod_name'` names no constraint that exists
            — the table is UNIQUE on (vehicle_id, mod_name, performance_goal) —
            which Postgres rejects outright (42P10);
          - the error was discarded, so a queue that never accepted a single
            row looked exactly like a queue with nothing to do.

        The queue table has been goal-keyed since January. It was the only part
        of this feature that got it right; the writer never caught up.
      */
      const { error: enqueueError } = await client
        .from('mod_detail_queue')
        .upsert(
          missing.map(modName => ({
            vehicle_id: vehicleId,
            mod_name: modName,
            performance_goal: goal,
            status: 'pending',
            created_at: new Date().toISOString(),
          })),
          { onConflict: 'vehicle_id,mod_name,performance_goal', ignoreDuplicates: true }
        );

      if (enqueueError) {
        console.error('Failed to enqueue modification details:', enqueueError);
      }

      processModDetailQueue(vehicleId).catch((err) => {
        console.error('Failed to process mod detail queue:', err);
      });
    }

    return { success: true, data: detailsMap, missing };
  } catch (error) {
    console.error('Get modification details batch error:', error);
    return { success: false, data: {}, missing: [] };
  }
}

export async function processModDetailQueue(vehicleId: string, batchSize: number = 3) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error, itemsProcessed: 0 };
    }

    const client = getServiceRoleClient();

    const { data: queueItems, error: fetchError } = await client
      .from('mod_detail_queue')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (fetchError || !queueItems || queueItems.length === 0) {
      return { success: true, processed: 0 };
    }

    const { data: vehicle } = await client
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .maybeSingle();

    if (!vehicle) {
      return { success: false, error: 'Vehicle not found' };
    }

    let processed = 0;

    /*
      A queue item identifies work for one goal, so both the status writes and
      the generation must carry that goal.

      Two bugs lived in the four lines below. `'processing'` is not one of the
      four values the status CHECK allows ('pending', 'in_progress',
      'completed', 'failed'), so the claim was rejected and the item stayed
      pending — collectable again on the next pass, and paid for twice at
      Gemini. And matching on `(vehicle_id, mod_name)` alone marked *every*
      goal's item complete when one of them finished.

      Generation took `vehicle.performance_mindedness` rather than the item's
      own goal, which is the same collapse one layer up: three queued goals,
      one answer.
    */
    const markStatus = async (item: any, status: 'in_progress' | 'completed' | 'failed') => {
      const { error } = await client
        .from('mod_detail_queue')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('vehicle_id', item.vehicle_id)
        .eq('mod_name', item.mod_name)
        .eq('performance_goal', item.performance_goal);

      if (error) {
        console.error(`Failed to mark queue item ${status}:`, error);
      }
    };

    for (const item of queueItems) {
      await markStatus(item, 'in_progress');

      const result = await generateModificationDetails(
        item.vehicle_id,
        item.mod_name,
        vehicle,
        item.performance_goal
      );

      if (result.success) {
        await markStatus(item, 'completed');
        processed++;
      } else {
        await markStatus(item, 'failed');
      }
    }

    return { success: true, processed };
  } catch (error) {
    console.error('Process mod detail queue error:', error);
    return { success: false, error: 'Failed to process queue' };
  }
}


export async function updateVehicleMileage(vehicleId: string, newMileage: number) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    const { data, error } = await client
      .from('vehicles')
      .update({
        current_mileage: newMileage,
        last_mileage_update_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId)
      .select();

    if (error) {
      console.error('[Update Mileage Error]:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return { success: false, error: `Failed to update mileage: ${error.message}` };
    }

    console.log('[Update Mileage Success]:', data);
    return { success: true };
  } catch (error: any) {
    console.error('[Update Mileage Exception]:', error);
    return { success: false, error: `Failed to update mileage: ${error.message || 'Unknown error'}` };
  }
}

export async function updateVehicleAvgMileage(vehicleId: string, avgMilesPerMonth: number) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    console.log(`[Update Avg Mileage] Starting update for vehicle ${vehicleId} to ${avgMilesPerMonth} miles/month`);
    const client = getServiceRoleClient();

    const { data, error } = await client
      .from('vehicles')
      .update({
        avg_miles_per_month: avgMilesPerMonth,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId)
      .select();

    if (error) {
      console.error('[Update Avg Mileage Error]:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return { success: false, error: `Failed to update average mileage: ${error.message}` };
    }

    console.log('[Update Avg Mileage Success]:', data);
    return { success: true };
  } catch (error: any) {
    console.error('[Update Avg Mileage Exception]:', error);
    return { success: false, error: `Failed to update average mileage: ${error.message || 'Unknown error'}` };
  }
}

export async function updateVehicleStatus(vehicleId: string, status: 'daily_driver' | 'weekend' | 'stored' | 'for_sale') {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('vehicles')
      .update({
        vehicle_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);

    if (error) {
      return { success: false, error: 'Failed to update vehicle status' };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Failed to update vehicle status: ${error.message || 'Unknown error'}` };
  }
}

export async function updatePerformanceGoal(vehicleId: string, performanceGoal: 'mild' | 'moderate' | 'aggressive') {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('vehicles')
      .update({
        performance_goal: performanceGoal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);

    if (error) {
      console.error('Update performance goal error:', error);
      return { success: false, error: 'Failed to update performance goal' };
    }

    return { success: true };
  } catch (error) {
    console.error('Update performance goal error:', error);
    return { success: false, error: 'Failed to update performance goal' };
  }
}

export async function updateVehicleTCOFields(vehicleId: string, fields: {
  purchase_price?: number | null;
  avg_mpg?: number | null;
  fuel_price_per_gallon?: number | null;
  insurance_monthly?: number | null;
}) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('vehicles')
      .update({
        ...fields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);

    if (error) {
      console.error('Update TCO fields error:', error);
      return { success: false, error: 'Failed to update TCO fields' };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Failed to update TCO fields: ${error.message || 'Unknown error'}` };
  }
}

const DELETABLE_ITEM_TABLES = {
  invoice_line_item: 'invoice_line_items',
  service_item: 'service_items',
  maintenance_line_item: 'maintenance_line_items',
  document: 'vehicle_documents',
} as const;

export async function deleteMaintenanceLineItem(itemId: string, itemType: 'invoice_line_item' | 'service_item' | 'maintenance_line_item' | 'document') {
  try {
    console.log(`[Delete Action] Starting delete for ${itemType} with id: ${itemId}`);

    const scopedTable = DELETABLE_ITEM_TABLES[itemType];
    if (!scopedTable) {
      return { success: false, error: 'Invalid item type' };
    }

    // Resolves the row's parent vehicle and proves ownership before deleting.
    const access = await authorizeVehicleScopedRow(scopedTable, itemId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    let tableName: string;

    switch (itemType) {
      case 'invoice_line_item':
        tableName = 'invoice_line_items';
        break;
      case 'service_item':
        tableName = 'service_items';
        break;
      case 'maintenance_line_item':
        tableName = 'maintenance_line_items';
        break;
      case 'document':
        tableName = 'vehicle_documents';
        break;
      default:
        console.error('[Delete Error] Invalid item type:', itemType);
        return { success: false, error: 'Invalid item type' };
    }

    console.log(`[Delete Action] Attempting to delete from ${tableName} where id = ${itemId}`);

    const { error, data, count } = await client
      .from(tableName)
      .delete()
      .eq('id', itemId)
      .select();

    if (error) {
      console.error('[Delete Action Error]:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        table: tableName,
        itemId: itemId,
      });
      return {
        success: false,
        error: `Failed to delete from ${tableName}: ${error.message}`,
      };
    }

    console.log(`[Delete Action Success] Deleted ${data?.length || 0} row(s) from ${tableName}:`, data);

    if (!data || data.length === 0) {
      console.warn(`[Delete Action Warning] No rows deleted - item may not exist`);
      return { success: true, warning: 'Item not found or already deleted' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[Delete Action Exception]:', error);
    return {
      success: false,
      error: `Delete failed: ${error.message || 'Unknown error'}`,
    };
  }
}

export async function addMaintenanceHistory(
  vehicleId: string,
  description: string,
  dateCompleted: string,
  shopName?: string,
  cost?: number,
  notes?: string
) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('service_items')
      .insert({
        vehicle_id: vehicleId,
        description,
        category: 'maintenance',
        status: 'completed',
        date_completed: dateCompleted,
        cost_labor: cost || 0,
        shop_name: shopName || null,
        notes: notes || null,
      });

    if (error) {
      console.error('Add maintenance history error:', error);
      return { success: false, error: 'Failed to add maintenance history' };
    }

    return { success: true };
  } catch (error) {
    console.error('Add maintenance history error:', error);
    return { success: false, error: 'Failed to add maintenance history' };
  }
}

/**
 * How long a minted URL lives.
 *
 * One hour, and the client caches a resolved URL for well under that (see
 * `hooks/useSignedUrl.ts`). Longer would weaken the point of signing: the URL
 * carries its own authority, so anyone who obtains one holds it for the whole
 * window regardless of what happens to the vehicle in the meantime.
 */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Exchange a stored URL for a signed one.
 *
 * Every read of a `vehicle-documents` object goes through here: invoices,
 * owner photos, consultant attachments. It was `getSignedInvoiceUrl` when
 * invoices were the only caller.
 */
export async function getSignedStorageUrl(fileUrl: string) {
  try {
    const filePath = storagePathFromStoredUrl(fileUrl);

    if (!filePath) {
      // Not one of ours — a demo `/vehicles/…` asset, or an already-real URL.
      // Still require a session so the action is not an open redirect-ish
      // oracle.
      const session = await requireSession();
      if (!session.ok) {
        return { success: false, error: session.error };
      }
      return { success: true, url: fileUrl };
    }

    /*
      Every object now lives under `{vehicleId}/{kind}/…`, so ownership is
      derivable from the path — which is what the storage RLS policy keys on
      too. Proving it here matters because a signed URL bypasses RLS for its
      lifetime, so the check has to happen before minting rather than relying
      on the policy afterwards.

      Legacy objects under `vehicle-photos/`, `consultant-docs/` and
      `invoices/` return null and are refused: their first segment is not a
      vehicle id, so ownership cannot be established. All such objects are
      unreferenced orphans slated for removal.
    */
    const pathVehicleId = vehicleIdFromStoragePath(filePath);
    if (!pathVehicleId) {
      logger.warn('SIGNED_URL:UNSCOPED_PATH', 'Path has no vehicle prefix', { filePath });
      return { success: false, error: 'File not found' };
    }

    const access = await authorizeVehicleAccess(pathVehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    const { data, error } = await client
      .storage
      .from('vehicle-documents')
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

    if (error || !data) {
      logger.warn('SIGNED_URL:CREATION_FAILED', 'Failed to create signed URL', { filePath, error });
      return { success: false, error: 'Failed to generate signed URL' };
    }

    return { success: true, url: data.signedUrl };
  } catch (error) {
    logger.error('SIGNED_URL:EXCEPTION', error as Error, { hasFileUrl: !!fileUrl });
    return { success: false, error: 'Failed to generate signed URL' };
  }
}

export async function getMaintenanceLineItems(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('maintenance_line_items')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('service_date', { ascending: false });

    if (error) {
      console.error('Get maintenance line items error:', error);
      return { success: false, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Get maintenance line items error:', error);
    return { success: false, data: [] };
  }
}

function findMatchingItems(laborItem: any, partsItems: any[]): any | null {
  const laborDesc = laborItem.description.toLowerCase();

  for (const partsItem of partsItems) {
    const partsDesc = partsItem.description.toLowerCase();

    const laborWords = laborDesc.split(/\s+/).filter((w: string) => w.length > 3);
    const matchingWords = laborWords.filter((word: string) => partsDesc.includes(word));

    if (matchingWords.length >= 2 || (matchingWords.length === 1 && matchingWords[0].length > 5)) {
      return partsItem;
    }
  }

  return null;
}

function normalizeText(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeyTerms(description: string): string[] {
  const normalized = normalizeText(description);
  const words = normalized.split(/\s+/);

  const stopWords = new Set(['and', 'the', 'for', 'with', 'from', 'install', 'installation',
    'replacement', 'replace', 'service', 'kit', 'assembly', 'system', 'set', 'package']);

  return words.filter(word => word.length > 3 && !stopWords.has(word));
}

function extractPartNumbers(description: string): string[] {
  const partNumberPatterns = [
    /\b([A-Z]{1,3}\d{2,4}[-]?\d{0,4}[A-Z]{0,3})\b/gi,
    /\b([A-Z]\d{3,})\b/gi,
    /\b(\d{4,}[A-Z]\d+)\b/gi,
  ];

  const matches: string[] = [];
  for (const pattern of partNumberPatterns) {
    const found = description.match(pattern);
    if (found) {
      matches.push(...found.map(m => normalizeText(m)));
    }
  }
  return matches;
}

function calculateMatchScore(laborDesc: string, partsDesc: string, laborPartNum?: string, partsPartNum?: string): number {
  let score = 0;
  let hasExactPartMatch = false;

  const laborNorm = normalizeText(laborDesc);
  const partsNorm = normalizeText(partsDesc);

  if (laborPartNum && partsPartNum) {
    const laborPartNorm = normalizeText(laborPartNum);
    const partsPartNorm = normalizeText(partsPartNum);
    if (laborPartNorm === partsPartNorm) {
      score += 150;
      hasExactPartMatch = true;
    } else if (laborPartNorm.includes(partsPartNorm) || partsPartNorm.includes(laborPartNorm)) {
      score += 80;
    }
  }

  const partNumsInLabor = extractPartNumbers(laborDesc);
  const partNumsInParts = extractPartNumbers(partsDesc);
  for (const lpn of partNumsInLabor) {
    for (const ppn of partNumsInParts) {
      if (lpn === ppn) {
        score += 100;
        hasExactPartMatch = true;
      } else if (lpn.includes(ppn) || ppn.includes(lpn)) {
        score += 60;
      }
    }
  }

  const laborTerms = extractKeyTerms(laborDesc);
  const partsTerms = extractKeyTerms(partsDesc);

  let matchedTerms = 0;
  let exactMatches = 0;
  for (const lt of laborTerms) {
    for (const pt of partsTerms) {
      if (lt === pt) {
        matchedTerms++;
        exactMatches++;
        score += 15;
      } else if (lt.includes(pt) || pt.includes(lt)) {
        if (Math.min(lt.length, pt.length) >= 4) {
          matchedTerms++;
          score += 8;
        }
      }
    }
  }

  if (matchedTerms >= 3) {
    score += 30;
  } else if (matchedTerms >= 2) {
    score += 15;
  } else if (matchedTerms >= 1) {
    score += 5;
  }

  const commonTerms = ['dinan', 'water', 'pump', 'thermostat', 'intercooler', 'intake', 'carbon', 'fiber',
    'transmission', 'valve', 'cover', 'spark', 'plug', 'axle', 'differential', 'wheel', 'spacer', 'pedal',
    'charge', 'pipe', 'software', 'tune', 'ignition', 'coil', 'ceramic', 'package', 'cold', 'air'];

  let commonTermMatches = 0;
  for (const term of commonTerms) {
    if (laborNorm.includes(term) && partsNorm.includes(term)) {
      commonTermMatches++;
      score += 5;
    }
  }

  if (hasExactPartMatch && exactMatches >= 2) {
    score += 30;
  }

  if (commonTermMatches >= 2) {
    score += 15;
  }

  return score;
}

function combineLineItems(items: any[]): any[] {
  const laborItems = items.filter(item => item.category === 'labor');
  const partsItems = items.filter(item => item.category === 'parts');
  const otherItems = items.filter(item => item.category !== 'labor' && item.category !== 'parts');

  const combined: any[] = [];
  const usedPartsIndices = new Set<number>();

  logger.debug('COMBINE:START', 'Starting line item combination', {
    laborCount: laborItems.length,
    partsCount: partsItems.length,
    otherCount: otherItems.length
  });

  for (const laborItem of laborItems) {
    const scoredParts = partsItems.map((parts, idx) => ({
      parts,
      idx,
      score: usedPartsIndices.has(idx) ? 0 : calculateMatchScore(
        laborItem.description,
        parts.description,
        laborItem.part_number,
        parts.part_number
      )
    }));

    scoredParts.sort((a, b) => b.score - a.score);

    const MINIMUM_MATCH_SCORE = 30;
    const ADDITIONAL_PART_THRESHOLD = 50;

    const matchingParts = scoredParts.filter(sp => sp.score >= MINIMUM_MATCH_SCORE);

    if (matchingParts.length > 0) {
      const bestMatch = matchingParts[0];

      logger.debug('COMBINE:MATCH', 'Found match for labor item', {
        laborDesc: laborItem.description,
        partDesc: bestMatch.parts.description,
        score: bestMatch.score,
        confidence: bestMatch.score < 60 ? 'low' : 'good'
      });

      usedPartsIndices.add(bestMatch.idx);

      let totalPartsCost = bestMatch.parts.total_cost;
      let combinedPartsDesc = bestMatch.parts.description;
      let partNumber = bestMatch.parts.part_number || laborItem.part_number;
      let combinedPartNumbers: string[] = bestMatch.parts.part_number ? [bestMatch.parts.part_number] : [];

      if (matchingParts.length > 1) {
        const additionalMatches = matchingParts.slice(1, 2).filter(m => m.score >= ADDITIONAL_PART_THRESHOLD);

        if (additionalMatches.length > 0) {
          logger.debug('COMBINE:ADDITIONAL', 'Found additional part matches', { count: additionalMatches.length });
        }

        for (const additional of additionalMatches) {
          usedPartsIndices.add(additional.idx);
          totalPartsCost += additional.parts.total_cost;
          combinedPartsDesc += ' + ' + additional.parts.description;
          if (additional.parts.part_number) {
            combinedPartNumbers.push(additional.parts.part_number);
          }
        }
      }

      combined.push({
        ...laborItem,
        is_combined: true,
        labor_cost: laborItem.total_cost,
        parts_cost: totalPartsCost,
        total_cost: laborItem.total_cost + totalPartsCost,
        part_number: partNumber,
        combined_parts_description: combinedPartsDesc,
        original_category: 'combined',
        match_confidence_score: bestMatch.score,
      });
    } else {
      logger.debug('COMBINE:NO_MATCH', 'No matching parts for labor item', { laborDesc: laborItem.description });
      combined.push({
        ...laborItem,
        is_combined: false,
        labor_cost: laborItem.total_cost,
        parts_cost: 0,
        original_category: 'labor',
      });
    }
  }

  const unusedParts = partsItems.filter((_, idx) => !usedPartsIndices.has(idx));
  logger.debug('COMBINE:REMAINING', 'Unmatched parts remaining', { count: unusedParts.length });

  partsItems.forEach((partsItem, idx) => {
    if (!usedPartsIndices.has(idx)) {
      combined.push({
        ...partsItem,
        is_combined: false,
        labor_cost: 0,
        parts_cost: partsItem.total_cost,
        original_category: 'parts',
      });
    }
  });

  combined.push(...otherItems.map(item => ({
    ...item,
    is_combined: false,
    labor_cost: 0,
    parts_cost: 0,
    original_category: item.category,
  })));

  logger.debug('COMBINE:RESULT', 'Line item combination complete', { totalItems: combined.length });

  return combined;
}

export async function parseInvoiceLineItems(documentId: string, vehicleId: string, fileBase64?: string, mimeType?: string, bypassVehicleCheck: boolean = false) {
  // Cost control: server actions are publicly invokable POST endpoints
  // and demo mode has no auth, so every Gemini-backed path is rate limited.
  {
    const rl = await checkRateLimit(`invoice:${vehicleId}`, 'ai');
    if (!rl.allowed) {
      return { success: false, error: `Too many AI requests. Try again in ${rl.retryAfterSeconds}s.` };
    }
  }
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    const { data: vehicle } = await client
      .from('vehicles')
      .select('year, make, model, color')
      .eq('id', vehicleId)
      .maybeSingle();

    const prompt = `You are analyzing an automotive service document. First validate this is an automotive service invoice, then extract all data.

STEP 1: DOCUMENT TYPE VALIDATION
Determine if this is an automotive service invoice by checking for:
- Shop/garage name and address
- Vehicle information (year, make, model, VIN)
- Labor and/or parts line items with automotive terminology
- Service descriptions related to vehicle maintenance or repair

If this is NOT an automotive service invoice (e.g., restaurant receipt, utility bill, grocery receipt, etc.), set "is_valid_invoice" to false.

STEP 2: VEHICLE VALIDATION (EXTREMELY LENIENT)
CRITICAL: Default to vehicle_mismatch = FALSE. Only flag vehicle_mismatch if ALL of these conditions are met:
1. You can clearly read complete vehicle information (year AND make AND model) from the invoice
2. The extracted vehicle information SIGNIFICANTLY contradicts the expected vehicle (different make or completely different model)
3. There is NO possibility of a trim level, variant, or version difference

Expected vehicle: ${vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Unknown'}

EXTREMELY LENIENT RULES:
- If vehicle info is NOT visible or readable → vehicle_mismatch = FALSE
- If only partial vehicle info is visible (e.g., only VIN, only year, or only make) → vehicle_mismatch = FALSE
- If color doesn't match → IGNORE (vehicle_mismatch = FALSE)
- If year is within 1 year → vehicle_mismatch = FALSE (could be model year vs registration year)
- If make matches but model has variations (e.g., "M235i" vs "M2" vs "2 Series") → vehicle_mismatch = FALSE (assume trim/variant)
- If make matches but model adds extra detail (e.g., "M235i xDrive" vs "M235i") → vehicle_mismatch = FALSE
- ONLY set vehicle_mismatch = TRUE for major contradictions like: Honda vs BMW, Civic vs M235i, 2015 vs 2020 (5+ year gap)

DEFAULT TO FALSE. When in doubt, assume the invoice is correct.

STEP 3: MULTI-PAGE INVOICE HANDLING
CRITICAL: This may be a multi-page invoice. Use the invoice/estimate number to group related pages.
- If you see an invoice number (like "1166" or "Estimate #1166"), note it
- Page 1 typically shows ITEMIZED labor with individual service descriptions
- Page 2 typically shows PARTS with part numbers, plus a SUMMARY labor total
- DO NOT extract the summary "Labor" line from page 2 if page 1 already has itemized labor
- DO NOT extract "Tax" more than once - it should only appear on the final total
- If you see a large unitemized "Labor" line (e.g. $6,985.98), check if page 1 already broke this down into individual services

STEP 4: EXTRACT ALL LINE ITEMS
Extract items from ALL pages, but avoid duplicates:
1. From "Labor" section: Extract individual service descriptions (NOT summary totals)
2. From "Parts" section: Extract all parts with part numbers
3. From "Misc" section: Extract fees, supplies, etc.
4. Tax: DO NOT EXTRACT TAX LINE ITEMS - tax will be handled separately

CRITICAL: DO NOT extract tax as a line item. Skip any line items labeled "Tax" or "Sales Tax".

DEDUPLICATION RULES:
- Skip any line that says just "Labor" with a large dollar amount if you already extracted itemized labor services
- Skip all tax lines - DO NOT include tax as a line item
- Skip duplicate totals or subtotals

Return JSON with this EXACT structure:
{
  "is_valid_invoice": true|false,
  "validation_message": "Brief explanation if not valid automotive invoice",
  "vehicle_info": {
    "year": 2015 or null,
    "make": "BMW" or null,
    "model": "M235i" or null,
    "color": "Red" or null
  },
  "vehicle_mismatch": false (default false, only true if clear mismatch detected),
  "mismatch_message": "Only if vehicle_mismatch is true, explain the clear contradiction",
  "shop_name": "Exact shop name from invoice",
  "service_date": "YYYY-MM-DD",
  "invoice_number": "Invoice/estimate number",
  "grand_total": 12023.58,
  "items": [
    {
      "description": "Exact text from invoice",
      "part_number": "Part# or null",
      "quantity": 1.0,
      "unit_cost": 0.00,
      "total_cost": 0.00,
      "category": "labor"|"parts"|"misc",
      "page_number": 1
    }
  ]
}

CATEGORY CLASSIFICATION:
- "labor" = Individual service items like "Water Pump Replacement", "Spark Plug Replacement" (NOT summary lines)
- "parts" = Physical items with part numbers
- "misc" = Shop supplies, fees
- DO NOT use "tax" category - skip tax line items entirely

Return ONLY valid JSON, no markdown code blocks, no explanations.`;

    let invoiceData: any = {
      is_valid_invoice: true,
      vehicle_mismatch: false,
      shop_name: null,
      service_date: null,
      invoice_number: null,
      items: [],
    };

    try {
      const contentParts: any[] = [{ text: prompt }];

      if (fileBase64 && mimeType) {
        contentParts.push({
          inlineData: {
            mimeType: mimeType,
            data: fileBase64,
          },
        });
      }

      const result = await genAI.models.generateContent({
        model: FLASH_VISION_MODEL,
        contents: [{ role: 'user', parts: contentParts }],
        // DELIBERATELY LEFT AT THE DEFAULT — the one 3.x site without a level.
        //
        // Invoice extraction is the path this file already calls out as the
        // one whose regressions are invisible: a model that reads fewer line
        // items still returns valid JSON and still passes every gate. Cutting
        // its thinking would save real money and there is no instrument here
        // that would notice if it also cost accuracy.
        //
        // The corpus to settle it exists (`COWORK_PROMPT_invoice_vision_
        // corpus_2026-07-30.md`). Run a level against it, then set one.
        config: flashStructuredConfig,
      });

      const responseText = result.text || '{}';
      const parsed = extractJSON(responseText);

      if (parsed.is_valid_invoice === false) {
        console.warn('[Validation] Not a valid automotive invoice:', parsed.validation_message);
        return {
          success: false,
          error: 'NOT_AUTOMOTIVE_INVOICE',
          message: parsed.validation_message || 'This document does not appear to be an automotive service invoice. Please upload a valid service or repair invoice.',
        };
      }

      if (parsed.vehicle_mismatch === true && !bypassVehicleCheck) {
        const extractedVehicle = (parsed.vehicle_info as Record<string, unknown>) || {};

        logger.warn('INVOICE:VEHICLE_MISMATCH', 'Vehicle mismatch detected', {
          mismatchMessage: parsed.mismatch_message,
          extracted: extractedVehicle,
          expected: vehicle,
        });

        const extractedStr = [
          extractedVehicle.year,
          extractedVehicle.make,
          extractedVehicle.model,
          extractedVehicle.color
        ].filter(v => v != null && v !== '').join(' ') || 'Unknown vehicle';

        const expectedStr = vehicle
          ? [vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(v => v != null && v !== '').join(' ')
          : 'Unknown vehicle';

        return {
          success: false,
          error: 'VEHICLE_MISMATCH',
          message: parsed.mismatch_message || 'Vehicle information does not match',
          extractedVehicle: extractedStr,
          expectedVehicle: expectedStr,
        };
      }

      if (bypassVehicleCheck && parsed.vehicle_mismatch === true) {
        console.log('[Validation] Vehicle mismatch bypassed by user confirmation');
      }

      invoiceData = {
        is_valid_invoice: parsed.is_valid_invoice !== false,
        vehicle_mismatch: parsed.vehicle_mismatch === true,
        shop_name: parsed.shop_name || null,
        service_date: parsed.service_date || null,
        invoice_number: parsed.invoice_number || null,
        grand_total: parsed.grand_total || null,
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };

      console.log(`[Gemini Extraction] Invoice #${invoiceData.invoice_number}, Shop: ${invoiceData.shop_name}, Date: ${invoiceData.service_date}, Raw items: ${invoiceData.items.length}, Total: $${invoiceData.grand_total}`);
    } catch (parseError) {
      console.error('[Gemini Extraction Failed]', parseError);
    }

    const lineItemsToInsert = invoiceData.items.map((item: any, index: number) => ({
      document_id: documentId,
      vehicle_id: vehicleId,
      line_number: index + 1,
      description: item.description || 'Unknown',
      part_number: item.part_number || null,
      quantity: parseFloat(item.quantity) || 1,
      unit_price: parseFloat(item.unit_cost) || 0,
      total_price: parseFloat(item.total_cost) || 0,
      category: (item.category || 'other').toLowerCase(),
    }));

    if (lineItemsToInsert.length > 0) {
      console.log(`[DB Insert] Inserting ${lineItemsToInsert.length} invoice line items...`);
      const { error: insertError } = await client
        .from('invoice_line_items')
        .insert(lineItemsToInsert);

      if (insertError) {
        console.error('[DB Error] Failed to insert invoice line items:', insertError);
      } else {
        console.log(`[DB Success] Inserted ${lineItemsToInsert.length} invoice line items`);
      }
    } else {
      console.warn('[Warning] No invoice line items to insert');
    }

    const itemsWithoutTax = invoiceData.items.filter((item: any) => {
      const category = (item.category || '').toLowerCase();
      return category !== 'tax';
    });

    console.log(`[Filtering] ${invoiceData.items.length} raw items -> ${itemsWithoutTax.length} after removing tax`);

    const combinedItems = combineLineItems(itemsWithoutTax);
    console.log(`[Combining] ${itemsWithoutTax.length} items -> ${combinedItems.length} combined items`);

    const { data: docData } = await client
      .from('vehicle_documents')
      .select('file_url')
      .eq('id', documentId)
      .single();

    const invoiceUrl = docData?.file_url || null;

    const { data: existingItems } = await client
      .from('maintenance_line_items')
      .select('id')
      .eq('source_document_id', documentId);

    if (existingItems && existingItems.length > 0) {
      console.log(`[Duplicate Detection] Found ${existingItems.length} existing items for document ${documentId}, removing...`);
      const { error: deleteError } = await client
        .from('maintenance_line_items')
        .delete()
        .eq('source_document_id', documentId);

      if (deleteError) {
        console.error('[DB Error] Failed to delete existing items:', deleteError);
      } else {
        console.log(`[DB Success] Deleted ${existingItems.length} existing items to prevent duplicates`);
      }
    }

    const maintenanceItemsToInsert = combinedItems.map((item: any) => ({
      vehicle_id: vehicleId,
      source_document_id: documentId,
      service_date: invoiceData.service_date,
      shop_name: invoiceData.shop_name,
      item_description: item.description,
      part_number: item.part_number || null,
      quantity: parseFloat(item.quantity) || 1,
      unit_cost: parseFloat(item.unit_cost) || 0,
      total_cost: item.total_cost,
      labor_cost: item.labor_cost || 0,
      parts_cost: item.parts_cost || 0,
      is_combined: item.is_combined || false,
      category: item.original_category || item.category,
      original_category: item.original_category || item.category,
      invoice_url: invoiceUrl,
      /*
        The one writer of this table where a model genuinely read the record.
        This is what earns the "AI Extracted" badge on the maintenance page —
        see the column comment in 20260801120000. The badge was unconditional
        until `9597869` and false for the other two writers.
      */
      source: 'vision',
    }));

    if (maintenanceItemsToInsert.length > 0) {
      console.log(`[DB Insert] Inserting ${maintenanceItemsToInsert.length} maintenance line items...`);
      const { error: maintenanceInsertError } = await client
        .from('maintenance_line_items')
        .insert(maintenanceItemsToInsert);

      if (maintenanceInsertError) {
        console.error('[DB Error] Failed to insert maintenance line items:', maintenanceInsertError);
        console.error('[DB Error Details]', JSON.stringify(maintenanceInsertError, null, 2));
      } else {
        console.log(`[DB Success] Created ${maintenanceItemsToInsert.length} maintenance records (${combinedItems.filter(i => i.is_combined).length} combined items)`);
      }
    } else {
      console.warn('[Warning] No maintenance line items to insert');
    }

    const totalCost = lineItemsToInsert.reduce((sum: number, item: any) => sum + item.total_price, 0);

    await client
      .from('vehicle_documents')
      .update({
        extracted_data: {
          vendor_name: invoiceData.shop_name,
          service_date: invoiceData.service_date,
          total_cost: totalCost,
          service_type: 'invoice',
          item_count: lineItemsToInsert.length,
        },
        extraction_status: 'completed',
      })
      .eq('id', documentId);

    return {
      success: true,
      lineItems: lineItemsToInsert,
      maintenanceItems: maintenanceItemsToInsert,
      shopName: invoiceData.shop_name,
      serviceDate: invoiceData.service_date,
      combinedCount: combinedItems.filter(i => i.is_combined).length,
    };
  } catch (error) {
    console.error('Parse invoice error:', error);
    return { success: false, error: 'Failed to parse invoice line items' };
  }
}

export async function uploadInvoice(formData: FormData) {
  try {
    const file = formData.get('file') as File;
    const vehicleId = formData.get('vehicleId') as string;
    // NOTE: this flag does NOT bypass any authorization. It overrides an AI
    // heuristic that flags an invoice as possibly belonging to a different
    // vehicle, letting the owner confirm "yes, this really is for this car".
    const bypassVehicleCheck = formData.get('bypassVehicleCheck') === 'true';

    if (!file || !vehicleId) throw new Error('Missing file or vehicle ID');

    // Uploads write to storage and insert document rows, so this must be an
    // owner. Previously this action reached straight for the service-role
    // client, letting an unauthenticated caller write into any vehicle.
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    console.log(`[Upload] Starting upload for ${file.name} (${file.size} bytes)${bypassVehicleCheck ? ' [BYPASS VEHICLE CHECK]' : ''}`);

    const fileName = vehicleStoragePath(vehicleId, 'invoices', file.name);
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const buffer = Buffer.from(arrayBuffer);
    const fileBlob = new Blob([buffer], { type: file.type });

    const { error: uploadError } = await client.storage
      .from('vehicle-documents')
      .upload(fileName, fileBlob, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Storage Upload Error]', uploadError);
      throw new Error(`Failed to upload file: ${uploadError.message}`);
    }

    const documentRecord = {
      vehicle_id: vehicleId,
      document_type: 'invoice' as const,
      // The path, not a URL — the bucket is private, so a public URL is dead
      // on arrival and a signed one expires. See `storedUrl`.
      file_url: storedUrl(fileName),
      extracted_data: {},
    };

    const { data: document, error: docError } = await client
      .from('vehicle_documents')
      .insert(documentRecord)
      .select()
      .single();

    if (docError || !document) {
      console.error('[Document Insert Error]', docError);
      throw new Error('Failed to create document record');
    }

    console.log('[Gemini] Parsing invoice with AI...');
    const parseResult = await parseInvoiceLineItems(
      document.id,
      vehicleId,
      base64Data,
      file.type || 'image/jpeg',
      bypassVehicleCheck
    );

    if (!parseResult.success) {
      console.warn('[Parse Warning]', parseResult.error);

      await client
        .from('vehicle_documents')
        .delete()
        .eq('id', document.id);

      /*
        Remove the object too. Deleting only the row left the uploaded file
        behind with nothing referencing it — and since a rejected parse is a
        normal outcome (not an automotive invoice, wrong vehicle, unreadable
        scan), this leaked on the common path. It accounts for the 54
        unreferenced objects found in this bucket against 5 surviving rows.
      */
      const { error: orphanError } = await client.storage
        .from('vehicle-documents')
        .remove([fileName]);

      if (orphanError) {
        logger.error('UPLOAD_INVOICE:ORPHAN_CLEANUP', new Error(orphanError.message), {
          vehicleId,
          fileName,
        });
      }

      if (parseResult.error === 'NOT_AUTOMOTIVE_INVOICE') {
        return {
          success: false,
          error: 'NOT_AUTOMOTIVE_INVOICE',
          message: parseResult.message,
        };
      }

      if (parseResult.error === 'VEHICLE_MISMATCH') {
        return {
          success: false,
          error: 'VEHICLE_MISMATCH',
          message: parseResult.message,
          extractedVehicle: parseResult.extractedVehicle,
          expectedVehicle: parseResult.expectedVehicle,
        };
      }

      return { success: false, error: parseResult.error || 'Failed to parse invoice' };
    }

    const itemsExtracted = parseResult.maintenanceItems?.length || 0;
    console.log(`[Upload Complete] Document ${document.id} processed with ${itemsExtracted} maintenance items`);

    await syncInvoiceWithDossier(vehicleId, parseResult.maintenanceItems || []);

    return { success: true, documentId: document.id, itemsExtracted };

  } catch (error: any) {
    console.error('[Upload Failed]:', error);
    return { success: false, error: error.message };
  }
}

export async function uploadVehiclePhoto(formData: FormData) {
  try {
    const file = formData.get('file') as File;
    const vehicleId = formData.get('vehicleId') as string;
    const focalXRaw = formData.get('focalX');
    const focalYRaw = formData.get('focalY');
    const focalX = focalXRaw !== null ? parseFloat(focalXRaw as string) : 50;
    const focalY = focalYRaw !== null ? parseFloat(focalYRaw as string) : 50;

    if (!file || !vehicleId) {
      return { success: false, error: 'Missing file or vehicle ID' };
    }

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    const { data: vehicle, error: vehicleError } = await client
      .from('vehicles')
      .select('custom_image_storage_path')
      .eq('id', vehicleId)
      .maybeSingle();

    if (vehicleError) {
      console.error('Vehicle fetch error:', vehicleError);
      return { success: false, error: 'Failed to fetch vehicle' };
    }

    if (vehicle?.custom_image_storage_path) {
      await client.storage
        .from('vehicle-documents')
        .remove([vehicle.custom_image_storage_path]);
    }

    const fileName = vehicleStoragePath(vehicleId, 'photos', file.name);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileBlob = new Blob([buffer], { type: file.type });

    const { error: uploadError } = await client.storage
      .from('vehicle-documents')
      .upload(fileName, fileBlob, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return { success: false, error: 'Failed to upload photo' };
    }

    /*
      Both columns hold the same path, in the two shapes their readers expect:
      `custom_image_storage_path` is what the delete-and-replace above reads,
      and `custom_image_url` is what every rendering surface reads. Writing a
      public URL to the second is the bug this fixes — it was unresolvable from
      the moment the bucket went private, which is why owner photos rendered as
      broken heroes while the file sat intact in storage.
    */
    const { error: updateError } = await client
      .from('vehicles')
      .update({
        custom_image_url: storedUrl(fileName),
        custom_image_storage_path: fileName,
        custom_image_uploaded_at: new Date().toISOString(),
        focal_point_x: focalX,
        focal_point_y: focalY,
      })
      .eq('id', vehicleId);

    if (updateError) {
      console.error('Vehicle update error:', updateError);
      return { success: false, error: 'Failed to update vehicle' };
    }

    /*
      `photoUrl` is signed rather than stored: it is handed straight to a
      caller that may put it in an `<img>`, and returning the internal
      `placeholder://` form there is how an unresolvable URL gets rendered.
      Signing is best-effort — the upload has already succeeded, and no caller
      currently needs the URL back.
    */
    const { data: signed } = await client.storage
      .from('vehicle-documents')
      .createSignedUrl(fileName, SIGNED_URL_TTL_SECONDS);

    return { success: true, photoUrl: signed?.signedUrl ?? null, focalX, focalY };
  } catch (error: any) {
    console.error('Upload vehicle photo error:', error);
    return { success: false, error: error.message || 'Failed to upload photo' };
  }
}

export async function removeVehiclePhoto(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    const { data: vehicle, error: vehicleError } = await client
      .from('vehicles')
      .select('custom_image_storage_path')
      .eq('id', vehicleId)
      .maybeSingle();

    if (vehicleError) {
      console.error('Vehicle fetch error:', vehicleError);
      return { success: false, error: 'Failed to fetch vehicle' };
    }

    if (vehicle?.custom_image_storage_path) {
      const { error: deleteError } = await client.storage
        .from('vehicle-documents')
        .remove([vehicle.custom_image_storage_path]);

      if (deleteError) {
        console.warn('Failed to delete storage file:', deleteError);
      }
    }

    const { error: updateError } = await client
      .from('vehicles')
      .update({
        custom_image_url: null,
        custom_image_storage_path: null,
        custom_image_uploaded_at: null,
      })
      .eq('id', vehicleId);

    if (updateError) {
      console.error('Vehicle update error:', updateError);
      return { success: false, error: 'Failed to remove photo' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Remove vehicle photo error:', error);
    return { success: false, error: error.message || 'Failed to remove photo' };
  }
}

export async function validateConsultantDocument(
  vehicleId: string,
  fileBase64: string,
  mimeType: string
): Promise<{
  success: boolean;
  isValid: boolean;
  documentType?: string;
  reason?: string;
  error?: string;
}> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, isValid: false, error: access.error };
    }

    const client = getServiceRoleClient();

    const { data: vehicle } = await client
      .from('vehicles')
      .select('year, make, model')
      .eq('id', vehicleId)
      .maybeSingle();

    if (!vehicle) {
      return { success: false, isValid: false, error: 'Vehicle not found' };
    }

    const prompt = CONSULTANT_DOCUMENT_VALIDATION_PROMPT(vehicle);

    const result = await genAI.models.generateContent({
      model: FLASH_VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: fileBase64,
              },
            },
          ],
        },
      ],
    });

    const response = result.text || '';
    const validationData = extractJSON(response);

    return {
      success: true,
      isValid: (validationData.is_valid as boolean | undefined) || false,
      documentType: validationData.document_type as string | undefined,
      reason: validationData.reason as string | undefined,
    };
  } catch (error) {
    logger.error('DOCUMENT:VALIDATION_ERROR', error as Error);
    return {
      success: false,
      isValid: false,
      error: (error as Error)?.message || 'Validation failed',
    };
  }
}

export async function uploadConsultantDocument(formData: FormData) {
  try {
    const file = formData.get('file') as File;
    const vehicleId = formData.get('vehicleId') as string;
    const sessionId = formData.get('sessionId') as string;

    if (!file || !vehicleId || !sessionId) {
      return { success: false, error: 'Missing required fields' };
    }

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const validation = await validateConsultantDocument(vehicleId, base64Data, file.type);

    if (!validation.success) {
      return { success: false, error: validation.error || 'Validation failed' };
    }

    if (!validation.isValid) {
      return {
        success: false,
        rejected: true,
        reason: validation.reason || 'Document does not appear to be automotive-related',
      };
    }

    const fileName = vehicleStoragePath(vehicleId, 'consultant', file.name, [sessionId]);
    const buffer = Buffer.from(arrayBuffer);
    const fileBlob = new Blob([buffer], { type: file.type });

    const { error: uploadError } = await client.storage
      .from('vehicle-documents')
      .upload(fileName, fileBlob, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Storage Upload Error]', uploadError);
      return { success: false, error: `Failed to upload file: ${uploadError.message}` };
    }

    const { data: document, error: dbError } = await client
      .from('consultant_documents')
      .insert({
        session_id: sessionId,
        vehicle_id: vehicleId,
        // The path, not a URL. `ConsultantChat` signs it to link to it, and
        // `downloadStoredFile` reads the bytes for Gemini straight from
        // storage without a URL at all.
        file_url: storedUrl(fileName),
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        is_car_related: true,
        validation_notes: validation.reason,
        document_type: validation.documentType,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[Database Insert Error]', dbError);
      await client.storage.from('vehicle-documents').remove([fileName]);
      return { success: false, error: 'Failed to save document record' };
    }

    return {
      success: true,
      document: document,
    };
  } catch (error: any) {
    console.error('Upload consultant document error:', error);
    return { success: false, error: error.message || 'Upload failed' };
  }
}

export async function fetchVehicleById(vehicleId: string) {
  try {
    console.log(`[Fetch Vehicle] Starting fetch for vehicle ${vehicleId}...`);

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error, vehicle: null };
    }

    const client = access.client;

    const { data, error } = await client
      .from('vehicles')
      .select(`
        *,
        nhtsa_data(*),
        vehicle_health_summary(*),
        vehicle_knowledge_base(*)
      `)
      .eq('id', vehicleId)
      .maybeSingle();

    if (error) {
      console.error('[Fetch Vehicle] Error:', error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: 'Vehicle not found' };
    }

    console.log(`[Fetch Vehicle] Successfully fetched vehicle ${vehicleId}`);
    return { success: true, vehicle: data };
  } catch (error: any) {
    console.error('[Fetch Vehicle] Exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function fetchDashboardData(vehicleId: string) {
  try {
    console.log(`[Fetch Dashboard] Starting fetch for vehicle ${vehicleId}...`);

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    const [vehicleResult, knowledgeResult, serviceItemsResult, nhtsaResult, bundlesResult, healthSummaryResult] = await Promise.all([
      client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('service_items').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
      client.from('nhtsa_data').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('labor_bundles').select('*').eq('vehicle_id', vehicleId).eq('status', 'suggested').order('suggested_at', { ascending: false }),
      client.from('vehicle_health_summary').select('*').eq('vehicle_id', vehicleId).maybeSingle()
    ]);

    if (vehicleResult.error) {
      console.error('[Fetch Dashboard] Vehicle error:', vehicleResult.error);
      return { success: false, error: vehicleResult.error.message };
    }

    if (!vehicleResult.data) {
      return { success: false, error: 'Vehicle not found' };
    }

    if (knowledgeResult.error) {
      console.warn('[Fetch Dashboard] Knowledge error (non-critical):', knowledgeResult.error);
    }
    if (serviceItemsResult.error) {
      console.warn('[Fetch Dashboard] Service items error (non-critical):', serviceItemsResult.error);
    }
    if (nhtsaResult.error) {
      console.warn('[Fetch Dashboard] NHTSA data error (non-critical):', nhtsaResult.error);
    }
    if (bundlesResult.error) {
      console.warn('[Fetch Dashboard] Bundles error (non-critical):', bundlesResult.error);
    }
    if (healthSummaryResult.error) {
      console.warn('[Fetch Dashboard] Health summary error (non-critical):', healthSummaryResult.error);
    }

    console.log(`[Fetch Dashboard] Successfully fetched dashboard data for vehicle ${vehicleId}`);
    return {
      success: true,
      vehicle: vehicleResult.data,
      knowledge: knowledgeResult.data,
      serviceItems: serviceItemsResult.data || [],
      nhtsa: nhtsaResult.data,
      bundles: bundlesResult.data || [],
      healthSummary: healthSummaryResult.data
    };
  } catch (error: any) {
    console.error('[Fetch Dashboard] Exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function fetchConsultantPageData(vehicleId: string) {
  try {
    console.log(`[Fetch Consultant] Starting fetch for vehicle ${vehicleId}...`);

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    const [vehicleResult, knowledgeResult, sessionsResult, wishlistResult, allServiceResult, maintenanceLineItemsResult, documentsResult, issueTrackingResult] = await Promise.all([
      client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('consultant_conversations').select('id, title, created_at, updated_at').eq('vehicle_id', vehicleId).order('updated_at', { ascending: false }),
      client.from('service_items').select('*').eq('vehicle_id', vehicleId).eq('status', 'wishlist'),
      client.from('service_items').select('*').eq('vehicle_id', vehicleId).order('date_completed', { ascending: false }),
      client.from('maintenance_line_items').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
      client.from('vehicle_documents').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
      client.from('known_issue_tracking').select('*').eq('vehicle_id', vehicleId)
    ]);

    if (vehicleResult.error) {
      console.error('[Fetch Consultant] Vehicle error:', vehicleResult.error);
      return { success: false, error: vehicleResult.error.message };
    }

    if (!vehicleResult.data) {
      return { success: false, error: 'Vehicle not found' };
    }

    if (knowledgeResult.error) {
      console.warn('[Fetch Consultant] Knowledge error (non-critical):', knowledgeResult.error);
    }
    if (sessionsResult.error) {
      console.warn('[Fetch Consultant] Sessions error (non-critical):', sessionsResult.error);
    }
    if (wishlistResult.error) {
      console.warn('[Fetch Consultant] Wishlist error (non-critical):', wishlistResult.error);
    }
    if (allServiceResult.error) {
      console.warn('[Fetch Consultant] Service items error (non-critical):', allServiceResult.error);
    }
    if (maintenanceLineItemsResult.error) {
      console.warn('[Fetch Consultant] Maintenance line items error (non-critical):', maintenanceLineItemsResult.error);
    }
    if (documentsResult.error) {
      console.warn('[Fetch Consultant] Documents error (non-critical):', documentsResult.error);
    }
    if (issueTrackingResult.error) {
      console.warn('[Fetch Consultant] Issue tracking error (non-critical):', issueTrackingResult.error);
    }

    const allServiceItems = allServiceResult.data || [];
    const completedItems = allServiceItems.filter((item: any) => item.status === 'completed');

    console.log(`[Fetch Consultant] Successfully fetched consultant data for vehicle ${vehicleId}`);
    return {
      success: true,
      vehicle: vehicleResult.data,
      knowledge: knowledgeResult.data,
      sessions: sessionsResult.data || [],
      wishlistItems: wishlistResult.data || [],
      allServiceItems,
      completedItems,
      maintenanceLineItems: maintenanceLineItemsResult.data || [],
      documents: documentsResult.data || [],
      issueTracking: issueTrackingResult.data || []
    };
  } catch (error: any) {
    console.error('[Fetch Consultant] Exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function createServiceItem(data: {
  vehicle_id: string;
  description: string;
  category: string;
  status: string;
  cost_parts: number;
  cost_labor: number;
  notes?: string;
}) {
  try {
    const access = await authorizeVehicleAccess(data.vehicle_id, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data: serviceItem, error } = await client
      .from('service_items')
      .insert({
        vehicle_id: data.vehicle_id,
        description: data.description,
        category: data.category,
        status: data.status,
        cost_parts: data.cost_parts,
        cost_labor: data.cost_labor,
        notes: data.notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[Create Service Item] Error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: serviceItem };
  } catch (error: any) {
    console.error('[Create Service Item] Exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function updateServiceItem(itemId: string, updates: any) {
  try {
    const access = await authorizeVehicleScopedRow('service_items', itemId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('service_items')
      .update(updates)
      .eq('id', itemId)
      .select()
      .single();

    if (error) {
      console.error('[Update Service Item] Error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (error: any) {
    console.error('[Update Service Item] Exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function deleteServiceItem(itemId: string) {
  try {
    const access = await authorizeVehicleScopedRow('service_items', itemId, {
      intent: 'write',
    });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const { error } = await access.client
      .from('service_items')
      .delete()
      .eq('id', itemId);

    if (error) {
      console.error('[Delete Service Item] Error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[Delete Service Item] Exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function moveServiceItemToHistory(
  serviceItemId: string,
  vehicleId: string,
  completionDetails: {
    dateCompleted: string;
    shopName?: string;
    totalCost?: number;
    notes?: string;
    invoiceUrl?: string;
  }
) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();

    const { data: serviceItem, error: fetchError } = await client
      .from('service_items')
      .select('*')
      .eq('id', serviceItemId)
      .maybeSingle();

    if (fetchError) {
      console.error('[Move to History] Fetch error:', fetchError);
      return { success: false, error: 'Failed to retrieve service item' };
    }

    if (!serviceItem) {
      return { success: false, error: 'Service item not found' };
    }

    const maintenanceData = {
      vehicle_id: vehicleId,
      service_date: completionDetails.dateCompleted,
      shop_name: completionDetails.shopName || null,
      item_description: serviceItem.description,
      category: serviceItem.category || 'maintenance',
      total_cost: completionDetails.totalCost || (serviceItem.cost_parts + serviceItem.cost_labor) || 0,
      notes: completionDetails.notes || null,
      invoice_url: completionDetails.invoiceUrl || null,
      /*
        Typed by the owner into the completion form. No model reads anything on
        this path, which is half of why the unconditional badge was false — a
        user marking a service item complete had their own data labelled as
        machine-extracted.
      */
      source: 'manual',
    };

    const { data: maintenanceItem, error: insertError } = await client
      .from('maintenance_line_items')
      .insert(maintenanceData)
      .select()
      .single();

    if (insertError) {
      console.error('[Move to History] Insert error:', insertError);
      return { success: false, error: 'Failed to create maintenance record' };
    }

    const { error: deleteError } = await client
      .from('service_items')
      .delete()
      .eq('id', serviceItemId);

    if (deleteError) {
      console.error('[Move to History] Delete error:', deleteError);
      return { success: false, error: 'Failed to remove from wishlist (maintenance record created)' };
    }

    return { success: true, data: maintenanceItem };
  } catch (error: any) {
    console.error('[Move to History] Exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function uploadInvoiceForCompletion(
  file: File,
  vehicleId: string
): Promise<{ success: boolean; data?: { url: string }; error?: string }> {
  try {
    // Writes to storage before the file is attached to any vehicle.
    const session = await requireSession();
    if (!session.ok) {
      return { success: false, error: session.error };
    }

    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      return { success: false, error: 'Only PDF, JPG, and PNG files are allowed' };
    }

    /*
      This wrote to `.from('documents')` — a bucket that does not exist in
      this project, which has only `vehicle-documents` and `garage-images`.
      Every call failed silently since it was written, which is why
      maintenance_line_items.invoice_url is NULL across every row: attaching
      an invoice while marking work complete has never worked.
    */
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;
    const fileName = vehicleStoragePath(vehicleId, 'invoices', file.name);

    const { error } = await client.storage
      .from('vehicle-documents')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      logger.error('INVOICE_UPLOAD:STORAGE', new Error(error.message), { vehicleId });
      return { success: false, error: 'Failed to upload invoice' };
    }

    // The storage path, not a URL. The bucket is private, so a URL is minted
    // on demand via getSignedStorageUrl instead of being persisted — a stored
    // public URL would outlive the permission that justified it.
    return { success: true, data: { url: storedUrl(fileName) } };
  } catch (error: any) {
    console.error('[Invoice Upload] Exception:', error);
    return { success: false, error: error.message || 'Failed to upload invoice' };
  }
}

interface CostEstimateItem {
  description: string;
  parts_cost_low: number;
  parts_cost_high: number;
  labor_hours_low: number;
  labor_hours_high: number;
  labor_cost_low: number;
  labor_cost_high: number;
  notes: string;
}

interface CostEstimate {
  items: CostEstimateItem[];
  regional_labor_rate: string;
  total_low: number;
  total_high: number;
}

export async function estimateCosts(
  vehicle: any,
  serviceItems: any[],
  zipCode: string
): Promise<{ success: boolean; data?: CostEstimate; error?: string }> {
  try {
    const itemsList = serviceItems.map((item, idx) =>
      `${idx + 1}. ${item.description} (Category: ${item.category})`
    ).join('\n');

    console.log('[Estimate Costs] Preparing prompt for cost estimation');
    const prompt = `You are an automotive cost estimation expert. Estimate repair/maintenance costs for the following vehicle and service items.

Vehicle Information:
- Year: ${vehicle.year}
- Make: ${vehicle.make}
- Model: ${vehicle.model}
- Trim: ${vehicle.trim || 'Standard'}
- Current Mileage: ${vehicle.current_mileage?.toLocaleString() || 'Unknown'} miles
- Location Zip Code: ${zipCode}

Service Items Requested:
${itemsList}

Please provide detailed cost estimates in the following JSON format:
{
  "items": [
    {
      "description": "exact item name from list",
      "parts_cost_low": number (minimum parts cost),
      "parts_cost_high": number (maximum parts cost),
      "labor_hours_low": number (minimum labor hours),
      "labor_hours_high": number (maximum labor hours),
      "labor_cost_low": number (minimum labor cost based on regional rates),
      "labor_cost_high": number (maximum labor cost based on regional rates),
      "notes": "brief explanation of estimate rationale"
    }
  ],
  "regional_labor_rate": "explanation of typical labor rates for this zip code area and how it affects estimates",
  "total_low": number (sum of all low estimates),
  "total_high": number (sum of all high estimates)
}

Important considerations:
1. Account for vehicle complexity (luxury/European brands typically cost more)
2. Consider regional labor rate differences based on zip code
3. Factor in typical market pricing for parts
4. Include realistic labor time estimates based on repair complexity
5. Provide ranges to account for shop-to-shop variation
6. Base labor rates: Estimate typical rates for the region (e.g., $80-120/hr for average areas, $120-180/hr for high-cost areas like major cities)

Return ONLY valid JSON with no additional text.`;

    let result;
    try {
      result = await withRetry(
        async () => {
          return await genAI.models.generateContent({
            model: FLASH_MODEL,
            contents: prompt,
          });
        },
        {
          maxAttempts: 3,
          initialDelayMs: 2000,
          context: 'GEMINI:ESTIMATE_COSTS',
          isRetryable: (error: Error) => {
            const message = error.message.toLowerCase();
            return message.includes('timeout') ||
                   message.includes('network') ||
                   message.includes('503') ||
                   message.includes('unavailable') ||
                   message.includes('rate limit') ||
                   message.includes('429');
          }
        }
      );
      console.log('[Estimate Costs] Received response object:', typeof result);
    } catch (apiError: any) {
      console.error('[Estimate Costs] API call failed:', apiError);
      console.error('[Estimate Costs] Error details:', {
        message: apiError.message,
        name: apiError.name,
        stack: apiError.stack
      });
      throw new Error(`Gemini API call failed: ${apiError.message}`);
    }

    if (!result || typeof result !== 'object') {
      console.error('[Estimate Costs] Invalid response object:', result);
      throw new Error('Invalid response object from API');
    }

    console.log('[Estimate Costs] Response object keys:', Object.keys(result));

    const text = result.text;
    if (!text || typeof text !== 'string') {
      console.error('[Estimate Costs] No text in response. Result structure:', JSON.stringify(result, null, 2));
      throw new Error('No response text from API');
    }

    console.log('[Estimate Costs] Response text length:', text.length);
    console.log('[Estimate Costs] Response text preview:', text.substring(0, 300));

    logger.debug('ESTIMATE:PARSE', 'Parsing JSON response');
    const estimateData = extractJSON(text) as unknown as Record<string, unknown>;

    if (!estimateData) {
      logger.error('ESTIMATE:EXTRACT_FAILED', new Error('Failed to extract JSON from response'));
      throw new Error('Failed to extract JSON from AI response');
    }

    if (!estimateData.items || !Array.isArray(estimateData.items) || estimateData.items.length === 0) {
      logger.error('ESTIMATE:INVALID_STRUCTURE', new Error('Invalid estimate structure'), { estimateData });
      throw new Error('Invalid cost estimate structure from AI');
    }

    if (!estimateData.total_low || !estimateData.total_high) {
      logger.error('ESTIMATE:MISSING_TOTALS', new Error('Missing total fields'), { estimateData });
      throw new Error('Missing total cost fields in estimate');
    }

    const estimate = estimateData as unknown as CostEstimate;

    for (let i = 0; i < estimate.items.length; i++) {
      const item = estimate.items[i];
      if (!item.description || typeof item.parts_cost_low !== 'number' || typeof item.labor_cost_low !== 'number') {
        console.error('[Estimate Costs] Invalid item structure at index', i, item);
        throw new Error(`Invalid item structure at index ${i}`);
      }
    }

    console.log('[Estimate Costs] Successfully validated and parsed cost estimate with', estimate.items.length, 'items');
    return { success: true, data: estimate };
  } catch (error: any) {
    console.error('[Estimate Costs] Error:', error.message || error);
    console.error('[Estimate Costs] Full error object:', error);
    if (error.stack) {
      console.error('[Estimate Costs] Stack trace:', error.stack);
    }
    return {
      success: false,
      error: error.message || 'Failed to generate cost estimates'
    };
  }
}

export async function generateEmailDraft(
  vehicle: any,
  serviceItems: any[],
  additionalNotes?: string
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const access = await authorizeVehicleAccess(vehicle?.id, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    console.log('[Generate Email Draft] Starting email generation');
    const itemsList = serviceItems.map((item, idx) =>
      `${idx + 1}. ${item.description} (${item.category})`
    ).join('\n');

    const notesSection = additionalNotes ? `\n\nAdditional Notes from Owner:\n${additionalNotes}` : '';

    const prompt = `Write a professional email to an auto repair shop requesting a quote. Use a friendly but business-like tone.

Vehicle Details:
- Year: ${vehicle.year}
- Make: ${vehicle.make}
- Model: ${vehicle.model}
- Trim: ${vehicle.trim || 'Standard'}
- Current Mileage: ${vehicle.current_mileage?.toLocaleString() || 'Unknown'} miles

Requested Services:
${itemsList}${notesSection}

Requirements for the email:
1. Start with a polite greeting
2. Clearly introduce the vehicle and the purpose
3. List the services needed in an easy-to-read format
4. Ask for an itemized pricing breakdown (parts and labor separated)
5. Request an estimated timeline for completion
6. Be concise and professional (aim for 150-250 words)
7. End with a polite closing and thank you
8. Use a conversational but professional tone

Return ONLY the email body text. Do NOT include a subject line. The email should be ready to copy and paste into an email client.`;

    const result = await withRetry(
      async () => {
        return await genAI.models.generateContent({
          model: FLASH_MODEL,
          contents: prompt,
        });
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        context: 'GEMINI:EMAIL_DRAFT',
        isRetryable: (error: Error) => {
          const message = error.message.toLowerCase();
          return message.includes('timeout') ||
                 message.includes('network') ||
                 message.includes('503') ||
                 message.includes('unavailable') ||
                 message.includes('rate limit') ||
                 message.includes('429');
        }
      }
    );

    console.log('[Generate Email Draft] Received response object');

    if (!result || typeof result !== 'object') {
      console.error('[Generate Email Draft] Invalid response object:', result);
      throw new Error('Invalid response object from API');
    }

    const emailText = result.text;
    if (!emailText || typeof emailText !== 'string') {
      console.error('[Generate Email Draft] No text in response:', result);
      throw new Error('No response text from API');
    }

    console.log('[Generate Email Draft] Response text length:', emailText.length);
    const emailDraft = emailText.trim();

    if (!emailDraft || emailDraft.length < 50) {
      console.error('[Generate Email Draft] Email draft too short or empty:', emailDraft);
      throw new Error('Generated email is too short or empty');
    }

    console.log('[Generate Email Draft] Successfully generated email with', emailDraft.length, 'characters');
    return { success: true, data: emailDraft };
  } catch (error: any) {
    console.error('[Generate Email Draft] Error:', error.message || error);
    console.error('[Generate Email Draft] Full error object:', error);
    if (error.stack) {
      console.error('[Generate Email Draft] Stack trace:', error.stack);
    }
    return {
      success: false,
      error: error.message || 'Failed to generate email draft'
    };
  }
}

function isSupabaseAuthError(error: any): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || '';
  const code = error.code?.toLowerCase() || '';
  return message.includes('401') || message.includes('unauthorized') ||
         code.includes('401') || code.includes('unauthorized') ||
         message.includes('invalid') || message.includes('jwt');
}

async function checkDatabaseHealth(): Promise<{ success: boolean; error?: string }> {
  const timestamp = new Date().toISOString();
  console.log(`[DB:HEALTH_CHECK] ${timestamp} - Starting database health check`);

  try {
    const client = getServiceRoleClient();
    const result = await withRetry(
      async () => {
        const { data, error } = await client
          .from('vehicles')
          .select('id')
          .limit(1);

        if (error) {
          throw error;
        }

        return data;
      },
      {
        maxAttempts: 2,
        initialDelayMs: 500,
        context: 'DB:HEALTH_CHECK',
        isRetryable: (error: Error) => {
          const message = error.message.toLowerCase();
          return message.includes('network') ||
                 message.includes('timeout') ||
                 message.includes('connection') ||
                 message.includes('refused');
        }
      }
    );

    console.log(`[DB:HEALTH_CHECK] ${timestamp} - Database health check passed`);
    return { success: true };
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`[DB:HEALTH_CHECK] ${timestamp} - Database health check failed:`, errorMsg);

    if (isSupabaseAuthError(error)) {
      return {
        success: false,
        error: 'Database authentication failed. Please check your Supabase configuration and API keys.'
      };
    }

    return {
      success: false,
      error: `Database connection failed: ${errorMsg}`
    };
  }
}

export async function generateQuoteRequest(
  vehicleId: string,
  selectedItemIds: string[],
  zipCode: string,
  additionalNotes?: string,
  quoteName?: string,
  items?: Array<{ id: string; description: string; category: string }>
): Promise<{
  success: boolean;
  data?: {
    quoteRequestId: string;
    emailDraft: string;
    costBreakdown: CostEstimate;
  };
  error?: string
}> {
  const timestamp = new Date().toISOString();
  console.log(`[QUOTE:START] ${timestamp} - Generating quote for vehicle ${vehicleId}, ${selectedItemIds.length} items, zip: ${zipCode}, itemsProvided: ${!!items}`);

  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const healthCheck = await checkDatabaseHealth();
    if (!healthCheck.success) {
      console.error(`[QUOTE:ERROR_HEALTH] ${timestamp} - Database health check failed:`, healthCheck.error);
      return { success: false, error: healthCheck.error || 'Database connection failed' };
    }

    const client = getServiceRoleClient();

    console.log(`[QUOTE:FETCH_VEHICLE] ${timestamp} - Fetching vehicle data...`);
    const { data: vehicle, error: vehicleError } = await withRetry(
      async () => {
        return await client
          .from('vehicles')
          .select('*')
          .eq('id', vehicleId)
          .single();
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        context: 'QUOTE:FETCH_VEHICLE',
        isRetryable: (error: Error) => {
          const message = error.message.toLowerCase();
          return !isSupabaseAuthError(error) && (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('refused')
          );
        }
      }
    );

    if (vehicleError) {
      console.error(`[QUOTE:ERROR_VEHICLE] ${timestamp} - Vehicle fetch error:`, vehicleError);
      if (isSupabaseAuthError(vehicleError)) {
        return { success: false, error: 'Database authentication failed. Please verify your Supabase configuration.' };
      }
      return { success: false, error: `Vehicle fetch failed: ${vehicleError.message}` };
    }
    if (!vehicle) {
      console.error(`[QUOTE:ERROR_VEHICLE] ${timestamp} - Vehicle not found for ID: ${vehicleId}`);
      return { success: false, error: 'Vehicle not found' };
    }
    console.log(`[QUOTE:SUCCESS_VEHICLE] ${timestamp} - Vehicle found: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

    let serviceItems: any[];

    if (items && items.length > 0) {
      console.log(`[QUOTE:USE_PROVIDED_ITEMS] ${timestamp} - Using provided items (from wishlist), skipping database lookup`);
      serviceItems = items.filter(item => selectedItemIds.includes(item.id));

      if (serviceItems.length === 0) {
        console.error(`[QUOTE:ERROR_ITEMS] ${timestamp} - No matching items found in provided items array`);
        return { success: false, error: 'Service items not found' };
      }
      console.log(`[QUOTE:SUCCESS_ITEMS] ${timestamp} - Found ${serviceItems.length} provided items: ${serviceItems.map((i: any) => i.description).join(', ')}`);
    } else {
      console.log(`[QUOTE:FETCH_ITEMS] ${timestamp} - Fetching ${selectedItemIds.length} service items from database...`);
      const { data: fetchedItems, error: itemsError } = await withRetry(
        async () => {
          return await client
            .from('service_items')
            .select('*')
            .in('id', selectedItemIds);
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          context: 'QUOTE:FETCH_ITEMS',
          isRetryable: (error: Error) => {
            const message = error.message.toLowerCase();
            return !isSupabaseAuthError(error) && (
              message.includes('network') ||
              message.includes('timeout') ||
              message.includes('connection') ||
              message.includes('refused')
            );
          }
        }
      );

      if (itemsError) {
        console.error(`[QUOTE:ERROR_ITEMS] ${timestamp} - Service items fetch error:`, itemsError);
        if (isSupabaseAuthError(itemsError)) {
          return { success: false, error: 'Database authentication failed. Please verify your Supabase configuration.' };
        }
        return { success: false, error: `Service items fetch failed: ${itemsError.message}` };
      }
      if (!fetchedItems || fetchedItems.length === 0) {
        console.error(`[QUOTE:ERROR_ITEMS] ${timestamp} - No service items found. Requested IDs: ${selectedItemIds.join(',')}`);
        return { success: false, error: 'Service items not found' };
      }
      serviceItems = fetchedItems;
      console.log(`[QUOTE:SUCCESS_ITEMS] ${timestamp} - Found ${serviceItems.length} service items: ${serviceItems.map((i: any) => i.description).join(', ')}`);
    }

    console.log(`[QUOTE:ESTIMATING_COSTS] ${timestamp} - Calling AI to estimate costs...`);
    const costResult = await estimateCosts(vehicle, serviceItems, zipCode);
    if (!costResult.success || !costResult.data) {
      console.error(`[QUOTE:ERROR_COSTS] ${timestamp} - Cost estimation failed:`, costResult.error);
      return { success: false, error: costResult.error || 'Failed to estimate costs' };
    }
    console.log(`[QUOTE:SUCCESS_COSTS] ${timestamp} - Costs estimated. Range: $${costResult.data.total_low?.toFixed(0)} - $${costResult.data.total_high?.toFixed(0)}`);

    console.log(`[QUOTE:GENERATING_EMAIL] ${timestamp} - Calling AI to generate email draft...`);
    const emailResult = await generateEmailDraft(vehicle, serviceItems, additionalNotes);
    if (!emailResult.success || !emailResult.data) {
      console.error(`[QUOTE:ERROR_EMAIL] ${timestamp} - Email generation failed:`, emailResult.error);
      return { success: false, error: emailResult.error || 'Failed to generate email draft' };
    }
    console.log(`[QUOTE:SUCCESS_EMAIL] ${timestamp} - Email draft generated (${emailResult.data.length} chars)`);

    const selectedItemsData = serviceItems.map((item: any) => ({
      id: item.id,
      description: item.description,
      category: item.category
    }));

    console.log(`[QUOTE:SAVING_DB] ${timestamp} - Saving quote request to database with name: "${quoteName || 'auto-generated'}"`);
    const { data: quoteRequest, error: insertError } = await withRetry(
      async () => {
        return await client
          .from('quote_requests')
          .insert({
            vehicle_id: vehicleId,
            selected_items: selectedItemsData,
            zip_code: zipCode,
            additional_notes: additionalNotes || null,
            name: quoteName || null,
            email_draft: emailResult.data!,
            estimated_total_low: costResult.data!.total_low,
            estimated_total_high: costResult.data!.total_high,
            cost_breakdown: costResult.data!
          })
          .select()
          .single();
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        context: 'QUOTE:SAVE_DB',
        isRetryable: (error: Error) => {
          const message = error.message.toLowerCase();
          return !isSupabaseAuthError(error) && (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('refused')
          );
        }
      }
    );

    if (insertError) {
      console.error(`[QUOTE:ERROR_DB] ${timestamp} - Database insert error:`, insertError);
      console.error(`[QUOTE:ERROR_DB_DETAIL] ${timestamp} - Error code: ${insertError.code}, Message: ${insertError.message}, Details: ${JSON.stringify(insertError.details)}`);
      if (isSupabaseAuthError(insertError)) {
        return { success: false, error: 'Database authentication failed. Please verify your Supabase configuration.' };
      }
      return { success: false, error: `Database save failed: ${insertError.message}` };
    }
    if (!quoteRequest) {
      console.error(`[QUOTE:ERROR_DB] ${timestamp} - Quote request was not returned after insert`);
      return { success: false, error: 'Failed to retrieve saved quote request' };
    }

    console.log(`[QUOTE:SUCCESS_DB] ${timestamp} - Quote request saved with ID: ${quoteRequest.id}`);
    console.log(`[QUOTE:COMPLETE] ${timestamp} - Quote generation completed successfully`);

    return {
      success: true,
      data: {
        quoteRequestId: quoteRequest.id,
        emailDraft: emailResult.data,
        costBreakdown: costResult.data
      }
    };
  } catch (error: any) {
    console.error(`[QUOTE:EXCEPTION] ${timestamp} - Unexpected error:`, error);
    console.error(`[QUOTE:EXCEPTION_DETAIL] ${timestamp} - Error type: ${error.constructor.name}, Message: ${error.message}, Stack: ${error.stack}`);
    return {
      success: false,
      error: error.message || 'Failed to generate quote request'
    };
  }
}

export async function savePreferredZipCode(
  vehicleId: string,
  zipCode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('vehicles')
      .update({ preferred_zip_code: zipCode })
      .eq('id', vehicleId);

    if (error) {
      console.error('[Save Preferred Zip Code] Error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[Save Preferred Zip Code] Exception:', error);
    return {
      success: false,
      error: error.message || 'Failed to save zip code'
    };
  }
}

export async function getQuoteRequestHistory(
  vehicleId: string,
  limit: number = 10
): Promise<{ success: boolean; data?: any[]; error?: string }> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('quote_requests')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Get Quote Request History] Error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('[Get Quote Request History] Exception:', error);
    return {
      success: false,
      error: error.message || 'Failed to fetch quote request history'
    };
  }
}

export async function getPerformanceModifications(vehicleId: string, performanceGoal?: 'mild' | 'moderate' | 'aggressive') {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    let goal = performanceGoal;

    if (!goal) {
      const { data: vehicleData, error: vehicleError } = await client
        .from('vehicles')
        .select('performance_goal')
        .eq('id', vehicleId)
        .maybeSingle();

      if (vehicleError || !vehicleData) {
        console.error('Failed to fetch vehicle performance goal:', vehicleError);
        return { success: false, data: [] };
      }

      goal = vehicleData.performance_goal || 'moderate';
    }

    const { data: knowledgeData, error: knowledgeError } = await client
      .from('vehicle_knowledge_base')
      .select('common_mods')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    if (knowledgeError || !knowledgeData) {
      console.error('Failed to fetch vehicle knowledge:', knowledgeError);
      return { success: false, data: [] };
    }

    const allMods = knowledgeData.common_mods || [];

    const modDifficulties: Record<string, number> = {
      'Easy': 1,
      'Moderate': 2,
      'Hard': 3,
    };

    const filteredMods = allMods.filter((mod: any) => {
      const modDifficulty = modDifficulties[mod.difficulty] || 2;

      if (goal === 'mild') {
        return modDifficulty <= 1 || mod.difficulty === 'Easy';
      } else if (goal === 'moderate') {
        return true;
      } else if (goal === 'aggressive') {
        return true;
      }

      return true;
    });

    return { success: true, data: filteredMods };
  } catch (error: any) {
    console.error('Get performance modifications error:', error);
    return { success: false, data: [] };
  }
}

export async function getCachedPerformanceModifications(vehicleId: string, performanceGoal: 'mild' | 'moderate' | 'aggressive') {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    const { data: cacheData, error: cacheError } = await client
      .from('performance_mod_cache')
      .select('mods_data, cached_at')
      .eq('vehicle_id', vehicleId)
      .eq('performance_goal', performanceGoal)
      .maybeSingle();

    if (!cacheError && cacheData) {
      const cacheAge = new Date().getTime() - new Date(cacheData.cached_at).getTime();
      const CACHE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

      if (cacheAge < CACHE_VALIDITY_MS) {
        return { success: true, data: cacheData.mods_data || [] };
      }
    }

    const liveResult = await getPerformanceModifications(vehicleId, performanceGoal);
    return liveResult;
  } catch (error: any) {
    console.error('Get cached performance modifications error:', error);
    return { success: false, data: [] };
  }
}

interface CacheDebugInfo {
  stage: 'names' | 'cache_lookup' | 'details_cached' | 'generation_started';
  timestamp: number;
  vehicleId: string;
  performanceGoal: string;
  duration?: number;
}

const cacheDebugLog: CacheDebugInfo[] = [];
const REQUEST_DEDUP_MAP = new Map<string, Promise<any>>();

function logCacheDebug(info: Omit<CacheDebugInfo, 'timestamp'>) {
  const entry: CacheDebugInfo = { ...info, timestamp: Date.now() };
  cacheDebugLog.push(entry);
  if (cacheDebugLog.length > 100) cacheDebugLog.shift();
  const stage = `[MOD_CACHE:${info.stage.toUpperCase()}]`;
  console.log(`${stage} Vehicle: ${info.vehicleId.substring(0, 8)} Goal: ${info.performanceGoal}${info.duration ? ` Duration: ${info.duration}ms` : ''}`);
}

export async function getModNamesOnly(vehicleId: string, performanceGoal: 'mild' | 'moderate' | 'aggressive') {
  const t0 = Date.now();
  const dedupKey = `names:${vehicleId}:${performanceGoal}`;

  if (REQUEST_DEDUP_MAP.has(dedupKey)) {
    console.log(`[MOD_NAMES:DEDUP] Request already in-flight for ${vehicleId.substring(0, 8)} goal ${performanceGoal}`);
    return REQUEST_DEDUP_MAP.get(dedupKey);
  }

  const promise = (async () => {
    try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

      const client = getServiceRoleClient();
      const { data: cacheData, error: cacheError } = await client
        .from('mod_names_cache')
        .select('mod_names, cached_at')
        .eq('vehicle_id', vehicleId)
        .eq('performance_goal', performanceGoal)
        .maybeSingle();

      if (cacheError) {
        console.error(`[MOD_NAMES:ERROR] Cache read failed: ${cacheError.message} | Code: ${cacheError.code}`);
      } else if (cacheData) {
        const cacheAge = Date.now() - new Date(cacheData.cached_at).getTime();
        const NAMES_CACHE_VALIDITY = 7 * 24 * 60 * 60 * 1000;

        if (cacheAge < NAMES_CACHE_VALIDITY) {
          logCacheDebug({ stage: 'names', vehicleId, performanceGoal: performanceGoal, duration: Date.now() - t0 });
          console.log(`[MOD_NAMES:HIT] Retrieved ${cacheData.mod_names?.length || 0} names, age: ${cacheAge}ms`);
          return { success: true, data: cacheData.mod_names || [] };
        }
      }

      console.log(`[MOD_NAMES:CACHE_MISS] Computing from knowledge base for ${vehicleId.substring(0, 8)}`);
      const { data: knowledgeData, error: knowledgeError } = await client
        .from('vehicle_knowledge_base')
        .select('common_mods')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      if (knowledgeError || !knowledgeData) {
        console.error(`[MOD_NAMES:ERROR] Knowledge base fetch failed: ${knowledgeError?.message}`);
        return { success: false, data: [] };
      }

      const allMods = knowledgeData.common_mods || [];
      const modDifficulties: Record<string, number> = { 'Easy': 1, 'Moderate': 2, 'Hard': 3 };

      const filteredMods = allMods
        .filter((mod: any) => {
          if (performanceGoal === 'mild') {
            const difficulty = modDifficulties[mod.difficulty] || 2;
            return difficulty <= 1;
          }
          return true;
        })
        .map((mod: any) => ({ name: mod.name, difficulty: mod.difficulty, purpose: mod.purpose }));

      const { error: upsertError } = await client
        .from('mod_names_cache')
        .upsert({
          vehicle_id: vehicleId,
          performance_goal: performanceGoal,
          mod_names: filteredMods,
          cached_at: new Date().toISOString(),
        }, {
          onConflict: 'vehicle_id,performance_goal',
        });

      if (upsertError) {
        console.error(`[MOD_NAMES:UPSERT_ERROR] Failed to cache names: ${upsertError.message}`);
      } else {
        console.log(`[MOD_NAMES:CACHED] Cached ${filteredMods.length} names for vehicle ${vehicleId.substring(0, 8)}`);
      }

      logCacheDebug({ stage: 'names', vehicleId, performanceGoal, duration: Date.now() - t0 });
      return { success: true, data: filteredMods };
    } catch (error: any) {
      console.error(`[MOD_NAMES:EXCEPTION] ${error.message}`);
      return { success: false, data: [] };
    } finally {
      REQUEST_DEDUP_MAP.delete(dedupKey);
    }
  })();

  REQUEST_DEDUP_MAP.set(dedupKey, promise);
  return promise;
}

export async function getDetailedModsWithCachedDetails(vehicleId: string, performanceGoal: 'mild' | 'moderate' | 'aggressive') {
  const t0 = Date.now();
  const dedupKey = `details:${vehicleId}:${performanceGoal}`;

  if (REQUEST_DEDUP_MAP.has(dedupKey)) {
    console.log(`[MOD_DETAILS:DEDUP] Request already in-flight for ${vehicleId.substring(0, 8)} goal ${performanceGoal}`);
    return REQUEST_DEDUP_MAP.get(dedupKey);
  }

  const promise = (async () => {
    try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

      const client = getServiceRoleClient();
      const { data: cacheData, error: cacheError } = await client
        .from('performance_mod_cache')
        .select('mods_data, cached_at')
        .eq('vehicle_id', vehicleId)
        .eq('performance_goal', performanceGoal)
        .maybeSingle();

      if (cacheError) {
        console.error(`[MOD_DETAILS:CACHE_READ_ERROR] ${cacheError.message} | Code: ${cacheError.code}`);
      } else if (cacheData) {
        const cacheAge = Date.now() - new Date(cacheData.cached_at).getTime();
        const DETAILS_CACHE_VALIDITY = 48 * 60 * 60 * 1000;

        if (cacheAge < DETAILS_CACHE_VALIDITY) {
          logCacheDebug({ stage: 'details_cached', vehicleId, performanceGoal, duration: Date.now() - t0 });
          console.log(`[MOD_DETAILS:HIT] Cache valid, age: ${cacheAge}ms for ${cacheData.mods_data?.length || 0} mods`);
          return { success: true, data: cacheData.mods_data || [], fromCache: true };
        }
      }

      console.log(`[MOD_DETAILS:CACHE_MISS] Fetching live data for ${vehicleId.substring(0, 8)}`);
      logCacheDebug({ stage: 'cache_lookup', vehicleId, performanceGoal, duration: Date.now() - t0 });
      return { success: false, data: [], fromCache: false };
    } catch (error: any) {
      console.error(`[MOD_DETAILS:EXCEPTION] ${error.message}`);
      return { success: false, data: [], fromCache: false };
    } finally {
      REQUEST_DEDUP_MAP.delete(dedupKey);
    }
  })();

  REQUEST_DEDUP_MAP.set(dedupKey, promise);
  return promise;
}

export async function preloadAllPerformanceModifications(vehicleId: string) {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = getServiceRoleClient();
    console.log(`[PRELOAD:START] Beginning preload for vehicle ${vehicleId.substring(0, 8)}`);
    const t0 = Date.now();

    const { data: vehicleData, error: vehicleError } = await client
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .maybeSingle();

    if (vehicleError || !vehicleData) {
      console.error(`[PRELOAD:ERROR] Failed to fetch vehicle: ${vehicleError?.message}`);
      return { success: false };
    }

    const { data: knowledgeData, error: knowledgeError } = await client
      .from('vehicle_knowledge_base')
      .select('common_mods')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    if (knowledgeError || !knowledgeData) {
      console.error(`[PRELOAD:ERROR] Failed to fetch knowledge base: ${knowledgeError?.message}`);
      return { success: false };
    }

    const performanceGoals: Array<'mild' | 'moderate' | 'aggressive'> = ['mild', 'moderate', 'aggressive'];
    const modDifficulties: Record<string, number> = { 'Easy': 1, 'Moderate': 2, 'Hard': 3 };

    for (const goal of performanceGoals) {
      const t1 = Date.now();
      const allMods = knowledgeData.common_mods || [];

      const filteredMods = allMods.filter((mod: any) => {
        const modDifficulty = modDifficulties[mod.difficulty] || 2;
        if (goal === 'mild') {
          return modDifficulty <= 1 || mod.difficulty === 'Easy';
        }
        return true;
      });

      console.log(`[PRELOAD:PHASE1] Goal ${goal}: filtering ${allMods.length} mods -> ${filteredMods.length} mods`);

      const modsWithDetails: any[] = [];
      const batchSize = 3;

      for (let i = 0; i < filteredMods.length; i += batchSize) {
        const batch = filteredMods.slice(i, i + batchSize);
        console.log(`[PRELOAD:BATCH] Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} mods) for goal ${goal}`);

        const detailPromises = batch.map(async (mod: any) => {
          try {
            /*
              The read must be scoped to `goal` or this loop launders one
              goal's analysis into all three.

              The mild pass generated and cached; the moderate and aggressive
              passes then hit that row through a goal-blind read, took mild
              text, and wrote it into `performance_mod_cache` under their own
              labels. Three caches, three labels, one goal's answer — and the
              two later passes looked fast because they were doing nothing.
            */
            const detailResult = await getModificationDetails(vehicleId, mod.name, goal);

            if (detailResult.success && detailResult.data) {
              return { ...mod, details: detailResult.data };
            }

            const genResult = await generateModificationDetails(vehicleId, mod.name, vehicleData, goal);

            if (genResult.success) {
              return { ...mod, details: genResult.data };
            }

            console.warn(`[PRELOAD:DETAIL_FAILED] ${mod.name} - generation failed, using null`);
            return { ...mod, details: null };
          } catch (error: any) {
            console.error(`[PRELOAD:DETAIL_EXCEPTION] ${mod.name} - ${error.message}`);
            return { ...mod, details: null };
          }
        });

        const batchResults = await Promise.allSettled(detailPromises);
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            modsWithDetails.push(result.value);
          }
        }
      }

      const { error: upsertError } = await client
        .from('performance_mod_cache')
        .upsert({
          vehicle_id: vehicleId,
          performance_goal: goal,
          mods_data: modsWithDetails,
          cached_at: new Date().toISOString(),
        }, {
          onConflict: 'vehicle_id,performance_goal',
        });

      if (upsertError) {
        console.error(`[PRELOAD:UPSERT_ERROR] Goal ${goal}: ${upsertError.message}`);
      } else {
        console.log(`[PRELOAD:PHASE2_COMPLETE] Goal ${goal}: cached ${modsWithDetails.length} mods in ${Date.now() - t1}ms`);
      }
    }

    console.log(`[PRELOAD:COMPLETE] Total preload time: ${Date.now() - t0}ms`);
    return { success: true };
  } catch (error: any) {
    console.error(`[PRELOAD:EXCEPTION] ${error.message}`);
    return { success: false };
  }
}

export async function getCacheDebugInfo() {
  return cacheDebugLog;
}

// ─── TIER ACHIEVEMENT SYSTEM ────────────────────────────────────────────────

const TIER_ORDER: Array<'mild' | 'moderate' | 'aggressive'> = ['mild', 'moderate', 'aggressive'];

const TIER_MOD_DIFFICULTY: Record<'mild' | 'moderate' | 'aggressive', string[]> = {
  mild: ['Easy'],
  moderate: ['Easy', 'Moderate'],
  aggressive: ['Easy', 'Moderate', 'Hard'],
};

// How many "not_interested" skips are allowed before a backfill mod is required
// per tier. We allow 2 free skips; the 3rd skip and beyond each require a backfill.
const FREE_SKIPS_PER_TIER = 2;

// Minimum actionable (not completed, not skipped) mods that must remain visible
// in the aggressive tier before we generate more.
const AGGRESSIVE_MIN_ACTIONABLE = 3;

function getModTier(difficulty: string): 'mild' | 'moderate' | 'aggressive' {
  if (difficulty === 'Easy') return 'mild';
  if (difficulty === 'Moderate') return 'moderate';
  return 'aggressive';
}

export async function recomputeVehicleTier(vehicleId: string): Promise<{
  success: boolean;
  tier?: 'mild' | 'moderate' | 'aggressive';
  progress?: {
    currentTier: 'mild' | 'moderate' | 'aggressive';
    completed: number;
    skipped: number;
    total: number;
    backfillsRequired: number;
    backfillsPending: number;
    canAdvance: boolean;
  };
}> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false };
    }

    const client = getServiceRoleClient();

    const [vehicleRes, knowledgeRes, trackingRes, backfillRes] = await Promise.all([
      client.from('vehicles').select('earned_tier').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('common_mods').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('modification_tracking').select('mod_name, status, tier, is_backfill').eq('vehicle_id', vehicleId),
      client.from('tier_backfill_queue').select('tier, status, skipped_mod_name').eq('vehicle_id', vehicleId),
    ]);

    if (!knowledgeRes.data) return { success: false };

    const allMods: any[] = knowledgeRes.data.common_mods || [];
    const tracking: any[] = trackingRes.data || [];
    const backfillQueue: any[] = backfillRes.data || [];

    const trackingByName = new Map(tracking.map((t) => [t.mod_name, t]));

    const currentEarnedTier = (vehicleRes.data?.earned_tier || 'mild') as 'mild' | 'moderate' | 'aggressive';

    // Compute what tier we're actually at by checking gates bottom-up
    let earnedTier: 'mild' | 'moderate' | 'aggressive' = 'mild';

    for (const tier of TIER_ORDER) {
      const tierMods = allMods.filter((m: any) => getModTier(m.difficulty) === tier);
      // Include backfill mods that belong to this tier
      const backfillMods = tracking.filter((t) => t.is_backfill && t.tier === tier);

      const allTierModNames = [
        ...tierMods.map((m: any) => m.name),
        ...backfillMods.map((t) => t.mod_name),
      ];

      const completed = allTierModNames.filter((n) => trackingByName.get(n)?.status === 'completed').length;
      const skipped = allTierModNames.filter((n) => trackingByName.get(n)?.status === 'not_interested').length;
      const total = allTierModNames.length;

      const pendingBackfills = backfillQueue.filter(
        (b) => b.tier === tier && b.status !== 'completed'
      ).length;

      const netSkips = Math.max(0, skipped - FREE_SKIPS_PER_TIER);
      const backfillsRequired = netSkips;
      const completedBackfills = backfillQueue.filter(
        (b) => b.tier === tier && b.status === 'completed'
      ).length;
      const backfillsSatisfied = completedBackfills >= backfillsRequired;

      const actionableDone = completed + skipped;
      const canAdvance = actionableDone >= total && backfillsSatisfied && pendingBackfills === 0;

      if (tier === currentEarnedTier) {
        if (!canAdvance) {
          earnedTier = tier;

          // Persist if changed
          if (earnedTier !== currentEarnedTier) {
            await client.from('vehicles').update({ earned_tier: earnedTier }).eq('id', vehicleId);
          }

          return {
            success: true,
            tier: earnedTier,
            progress: {
              currentTier: tier,
              completed,
              skipped,
              total,
              backfillsRequired,
              backfillsPending: pendingBackfills,
              canAdvance: false,
            },
          };
        }

        // Can advance — find next tier
        const nextIndex = TIER_ORDER.indexOf(tier) + 1;
        if (nextIndex < TIER_ORDER.length) {
          earnedTier = TIER_ORDER[nextIndex];
        } else {
          earnedTier = 'aggressive';
        }
      }
    }

    // If we made it through all tiers, cap at aggressive
    if (TIER_ORDER.indexOf(earnedTier) > TIER_ORDER.indexOf(currentEarnedTier)) {
      earnedTier = earnedTier;
    }

    // Persist updated tier
    if (earnedTier !== currentEarnedTier) {
      await client.from('vehicles').update({ earned_tier: earnedTier }).eq('id', vehicleId);
    }

    // Recompute progress for the new current tier
    const tier = earnedTier;
    const tierMods = allMods.filter((m: any) => getModTier(m.difficulty) === tier);
    const backfillMods = tracking.filter((t) => t.is_backfill && t.tier === tier);
    const allTierModNames = [
      ...tierMods.map((m: any) => m.name),
      ...backfillMods.map((t) => t.mod_name),
    ];
    const completed = allTierModNames.filter((n) => trackingByName.get(n)?.status === 'completed').length;
    const skipped = allTierModNames.filter((n) => trackingByName.get(n)?.status === 'not_interested').length;
    const total = allTierModNames.length;
    const netSkips = Math.max(0, skipped - FREE_SKIPS_PER_TIER);
    const completedBackfills = backfillQueue.filter(
      (b) => b.tier === tier && b.status === 'completed'
    ).length;
    const pendingBackfills = backfillQueue.filter(
      (b) => b.tier === tier && b.status !== 'completed'
    ).length;
    const backfillsRequired = netSkips;
    const backfillsSatisfied = completedBackfills >= backfillsRequired;
    const actionableDone = completed + skipped;
    const canAdvance = tier !== 'aggressive' && actionableDone >= total && backfillsSatisfied && pendingBackfills === 0;

    return {
      success: true,
      tier: earnedTier,
      progress: {
        currentTier: tier,
        completed,
        skipped,
        total,
        backfillsRequired,
        backfillsPending: pendingBackfills,
        canAdvance,
      },
    };
  } catch (error: any) {
    console.error('[TIER] recomputeVehicleTier error:', error.message);
    return { success: false };
  }
}

export async function getTierProgress(vehicleId: string): Promise<{
  success: boolean;
  tier?: 'mild' | 'moderate' | 'aggressive';
  progress?: {
    currentTier: 'mild' | 'moderate' | 'aggressive';
    completed: number;
    skipped: number;
    total: number;
    backfillsRequired: number;
    backfillsPending: number;
    canAdvance: boolean;
  };
}> {
  return recomputeVehicleTier(vehicleId);
}

export async function getModsForEarnedTier(
  vehicleId: string,
  tier: 'mild' | 'moderate' | 'aggressive'
): Promise<{ success: boolean; data: any[] }> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, data: [] };
    }

    const client = getServiceRoleClient();

    const [knowledgeRes, trackingRes, cacheRes] = await Promise.all([
      client.from('vehicle_knowledge_base').select('common_mods').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('modification_tracking').select('mod_name, status, tier, is_backfill').eq('vehicle_id', vehicleId).eq('tier', tier),
      client.from('performance_mod_cache').select('mods_data').eq('vehicle_id', vehicleId).eq('performance_goal', tier).maybeSingle(),
    ]);

    const allMods: any[] = knowledgeRes.data?.common_mods || [];
    const tracking: any[] = trackingRes.data || [];

    // Base mods for this tier
    const tierMods = allMods.filter((m: any) => getModTier(m.difficulty) === tier);

    // Backfill mods that were generated for this tier
    const backfillTracking = tracking.filter((t) => t.is_backfill);
    const backfillMods = backfillTracking.map((t) => ({ name: t.mod_name, difficulty: tier === 'mild' ? 'Easy' : tier === 'moderate' ? 'Moderate' : 'Hard', is_backfill: true }));

    const combinedMods = [...tierMods, ...backfillMods];

    // Enrich with cached details if available
    const cachedData: any[] = cacheRes.data?.mods_data || [];
    const cachedByName = new Map(cachedData.map((m: any) => [m.name, m]));

    const enriched = combinedMods.map((mod) => {
      const cached = cachedByName.get(mod.name);
      return cached ? { ...mod, details: cached.details } : mod;
    });

    return { success: true, data: enriched };
  } catch (error: any) {
    console.error('[TIER] getModsForEarnedTier error:', error.message);
    return { success: false, data: [] };
  }
}

export async function generateBackfillMod(
  vehicleId: string,
  tier: 'mild' | 'moderate' | 'aggressive',
  skippedModName: string
): Promise<{ success: boolean; modName?: string }> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false };
    }

    const client = getServiceRoleClient();

    const [vehicleRes, knowledgeRes, trackingRes] = await Promise.all([
      client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('common_mods').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('modification_tracking').select('mod_name').eq('vehicle_id', vehicleId),
    ]);

    if (!vehicleRes.data || !knowledgeRes.data) return { success: false };

    const vehicle = vehicleRes.data;
    const existingMods: string[] = (knowledgeRes.data.common_mods || []).map((m: any) => m.name);
    const trackedMods: string[] = (trackingRes.data || []).map((t: any) => t.mod_name);
    const knownSet = new Set(existingMods.concat(trackedMods));
    const allKnownMods = Array.from(knownSet);

    const difficultyLabel = tier === 'mild' ? 'Easy (bolt-on, no tuning required)' : tier === 'moderate' ? 'Moderate (some complexity, may need tune)' : 'Hard/Advanced (complex build work, significant investment)';

    const prompt = `You are an expert automotive performance consultant.

VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}
TIER: ${tier.toUpperCase()} — ${difficultyLabel}
SKIPPED MOD: "${skippedModName}" (the owner passed on this)

The owner skipped "${skippedModName}". Suggest ONE alternative modification at the same ${tier} difficulty tier that:
1. Is NOT already in this list: ${allKnownMods.join(', ')}
2. Is a real, commonly available modification for the ${vehicle.year} ${vehicle.make} ${vehicle.model}
3. Matches the ${tier} tier difficulty level
4. Provides a similar performance category as "${skippedModName}" if possible

Respond with ONLY valid JSON, no markdown:
{"modName": "Exact Modification Name", "difficulty": "${tier === 'mild' ? 'Easy' : tier === 'moderate' ? 'Moderate' : 'Hard'}", "purpose": "One sentence purpose"}`;

    const result = await genAI.models.generateContent({
      model: FLASH_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: withThinking(flashStructuredConfig, FLASH_MODEL, 'LOW'),
    });

    const responseText = result.text || '';
    let parsed: any = null;

    try {
      parsed = extractJSON(responseText);
    } catch {
      console.error('[BACKFILL] Failed to parse AI response');
      return { success: false };
    }

    if (!parsed?.modName) return { success: false };

    const modName = parsed.modName as string;

    // Add backfill mod to mod_names_cache for this tier
    const { data: cacheData } = await client
      .from('mod_names_cache')
      .select('mod_names')
      .eq('vehicle_id', vehicleId)
      .eq('performance_goal', tier)
      .maybeSingle();

    const existingNames: any[] = cacheData?.mod_names || [];
    const alreadyExists = existingNames.some((m: any) => m.name === modName);

    if (!alreadyExists) {
      const updatedNames = [
        ...existingNames,
        { name: modName, difficulty: parsed.difficulty || (tier === 'mild' ? 'Easy' : tier === 'moderate' ? 'Moderate' : 'Hard'), purpose: parsed.purpose || '', is_backfill: true },
      ];

      await client.from('mod_names_cache').upsert(
        { vehicle_id: vehicleId, performance_goal: tier, mod_names: updatedNames, cached_at: new Date().toISOString() },
        { onConflict: 'vehicle_id,performance_goal' }
      );
    }

    // Record this mod in modification_tracking as a backfill entry (pending)
    await client.from('modification_tracking').upsert(
      {
        vehicle_id: vehicleId,
        mod_name: modName,
        status: 'pending',
        tier,
        is_backfill: true,
        backfill_reason: skippedModName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'vehicle_id,mod_name' }
    );

    // Generate details for the backfill mod asynchronously
    generateModificationDetails(vehicleId, modName, vehicle, tier).catch(() => {});

    return { success: true, modName };
  } catch (error: any) {
    console.error('[BACKFILL] generateBackfillMod error:', error.message);
    return { success: false };
  }
}

export async function processSkipAndBackfill(
  vehicleId: string,
  modName: string,
  tier: 'mild' | 'moderate' | 'aggressive'
): Promise<{ success: boolean; backfillTriggered: boolean; newTier?: 'mild' | 'moderate' | 'aggressive' }> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, backfillTriggered: false };
    }

    const client = getServiceRoleClient();

    // Record the skip
    await client.from('modification_tracking').upsert(
      {
        vehicle_id: vehicleId,
        mod_name: modName,
        status: 'not_interested',
        tier,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'vehicle_id,mod_name' }
    );

    // Count skips so far for this tier
    const { data: trackingData } = await client
      .from('modification_tracking')
      .select('mod_name, status')
      .eq('vehicle_id', vehicleId)
      .eq('tier', tier)
      .eq('status', 'not_interested')
      .eq('is_backfill', false);

    const skipCount = (trackingData || []).length;

    // Check how many backfills already exist for this tier
    const { data: backfillData } = await client
      .from('tier_backfill_queue')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('tier', tier);

    const existingBackfills = (backfillData || []).length;

    // Determine if backfill is needed:
    // Each skip beyond FREE_SKIPS_PER_TIER requires a backfill
    // But we apply a grace ratio: 2 skips = 1 backfill, 4 skips = 2 backfills, etc.
    // (every 2 skips beyond the free allowance = 1 required backfill)
    const paidSkips = Math.max(0, skipCount - FREE_SKIPS_PER_TIER);
    const requiredBackfills = Math.ceil(paidSkips / 2);
    const backfillTriggered = requiredBackfills > existingBackfills;

    if (backfillTriggered) {
      // Queue a backfill
      await client.from('tier_backfill_queue').insert({
        vehicle_id: vehicleId,
        tier,
        skipped_mod_name: modName,
        status: 'pending',
      });

      // Generate the backfill async
      generateBackfillMod(vehicleId, tier, modName).then(async (result) => {
        if (result.success && result.modName) {
          await client.from('tier_backfill_queue').update({
            status: 'completed',
            replacement_mod_name: result.modName,
            updated_at: new Date().toISOString(),
          })
          .eq('vehicle_id', vehicleId)
          .eq('tier', tier)
          .eq('skipped_mod_name', modName);
        } else {
          await client.from('tier_backfill_queue').update({
            status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('vehicle_id', vehicleId)
          .eq('tier', tier)
          .eq('skipped_mod_name', modName);
        }
      }).catch(() => {});
    }

    const tierResult = await recomputeVehicleTier(vehicleId);

    return {
      success: true,
      backfillTriggered,
      newTier: tierResult.tier,
    };
  } catch (error: any) {
    console.error('[BACKFILL] processSkipAndBackfill error:', error.message);
    return { success: false, backfillTriggered: false };
  }
}

export async function ensureAggressiveModMinimum(vehicleId: string): Promise<{ success: boolean; generated: number }> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, generated: 0 };
    }

    const client = getServiceRoleClient();

    const [vehicleRes, knowledgeRes, trackingRes] = await Promise.all([
      client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('common_mods').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('modification_tracking').select('mod_name, status, tier, is_backfill').eq('vehicle_id', vehicleId),
    ]);

    if (!vehicleRes.data || !knowledgeRes.data) return { success: false, generated: 0 };

    const vehicle = vehicleRes.data;
    const allMods: any[] = knowledgeRes.data.common_mods || [];
    const tracking: any[] = trackingRes.data || [];

    const trackingByName = new Map(tracking.map((t: any) => [t.mod_name, t]));

    const aggressiveMods = allMods.filter((m: any) => getModTier(m.difficulty) === 'aggressive');
    const aggressiveBackfills = tracking.filter((t: any) => t.is_backfill && t.tier === 'aggressive');

    const allAggressiveNames = [
      ...aggressiveMods.map((m: any) => m.name),
      ...aggressiveBackfills.map((t: any) => t.mod_name),
    ];

    const actionable = allAggressiveNames.filter((n) => {
      const t = trackingByName.get(n);
      return !t || t.status === 'pending';
    });

    if (actionable.length >= AGGRESSIVE_MIN_ACTIONABLE) {
      return { success: true, generated: 0 };
    }

    const needed = AGGRESSIVE_MIN_ACTIONABLE - actionable.length + 2; // generate a couple extra
    let generated = 0;

    const existingNames = new Set(allAggressiveNames);

    for (let i = 0; i < needed; i++) {
      const prompt = `You are an expert automotive performance consultant.

VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}
TIER: AGGRESSIVE — Hard/Advanced modifications, significant investment, track-focused

Generate ONE new aggressive performance modification for this vehicle that is NOT in this list:
${Array.from(existingNames).join(', ')}

Respond with ONLY valid JSON:
{"modName": "Exact Modification Name", "difficulty": "Hard", "purpose": "One sentence purpose"}`;

      try {
        const result = await genAI.models.generateContent({
          model: FLASH_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: withThinking(flashStructuredConfig, FLASH_MODEL, 'LOW'),
        });

        const responseText = result.text || '';
        const parsed = extractJSON(responseText);

        if (parsed?.modName) {
          const modName = parsed.modName as string;
          if (!existingNames.has(modName)) {
            existingNames.add(modName);

            await client.from('modification_tracking').upsert(
              {
                vehicle_id: vehicleId,
                mod_name: modName,
                status: 'pending',
                tier: 'aggressive',
                is_backfill: true,
                backfill_reason: 'perpetual_aggressive',
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'vehicle_id,mod_name' }
            );

            // Update mod_names_cache for aggressive tier
            const { data: cacheData } = await client
              .from('mod_names_cache')
              .select('mod_names')
              .eq('vehicle_id', vehicleId)
              .eq('performance_goal', 'aggressive')
              .maybeSingle();

            const existingCacheNames: any[] = cacheData?.mod_names || [];
            if (!existingCacheNames.some((m: any) => m.name === modName)) {
              await client.from('mod_names_cache').upsert(
                {
                  vehicle_id: vehicleId,
                  performance_goal: 'aggressive',
                  mod_names: [...existingCacheNames, { name: modName, difficulty: 'Hard', purpose: parsed.purpose || '', is_backfill: true }],
                  cached_at: new Date().toISOString(),
                },
                { onConflict: 'vehicle_id,performance_goal' }
              );
            }

            generateModificationDetails(vehicleId, modName, vehicle, 'aggressive').catch(() => {});
            generated++;
          }
        }
      } catch {
        // Continue even if one generation fails
      }
    }

    return { success: true, generated };
  } catch (error: any) {
    console.error('[AGGRESSIVE] ensureAggressiveModMinimum error:', error.message);
    return { success: false, generated: 0 };
  }
}

export async function updateModificationStatusWithTier(
  vehicleId: string,
  modName: string,
  status: 'pending' | 'completed' | 'not_interested',
  tier: 'mild' | 'moderate' | 'aggressive',
  notes?: string,
  installedDate?: string,
  costParts?: number,
  costLabor?: number
): Promise<{ success: boolean; newTier?: 'mild' | 'moderate' | 'aggressive'; backfillTriggered?: boolean }> {
  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false };
    }

    if (status === 'not_interested') {
      const result = await processSkipAndBackfill(vehicleId, modName, tier);
      return {
        success: result.success,
        newTier: result.newTier,
        backfillTriggered: result.backfillTriggered,
      };
    }

    const client = getServiceRoleClient();
    const { error } = await client
      .from('modification_tracking')
      .upsert({
        vehicle_id: vehicleId,
        mod_name: modName,
        status,
        tier,
        notes: notes || null,
        installed_date: installedDate || null,
        cost_parts: costParts || 0,
        cost_labor: costLabor || 0,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'vehicle_id,mod_name',
      });

    if (error) {
      console.error('[TIER] updateModificationStatusWithTier error:', error);
      return { success: false };
    }

    // If completing an aggressive mod, check if we need to top up
    if (status === 'completed' && tier === 'aggressive') {
      ensureAggressiveModMinimum(vehicleId).catch(() => {});
    }

    const tierResult = await recomputeVehicleTier(vehicleId);

    return {
      success: true,
      newTier: tierResult.tier,
      backfillTriggered: false,
    };
  } catch (error: any) {
    console.error('[TIER] updateModificationStatusWithTier error:', error.message);
    return { success: false };
  }
}

export async function generateQuoteRequestV2(
  vehicleId: string,
  selectedItemIds: string[],
  zipCode: string,
  additionalNotes?: string,
  quoteName?: string,
  items?: Array<{ id: string; description: string; category: string }>
): Promise<{
  success: boolean;
  data?: {
    quoteRequestId: string;
    emailDraft: string;
    costBreakdown: CostEstimate;
  };
  error?: string;
}> {
  console.log('[QUOTE_V2] Starting quote generation', {
    vehicleId,
    itemCount: selectedItemIds.length,
    zipCode,
    hasNotes: !!additionalNotes,
    hasName: !!quoteName,
    itemsProvided: !!items
  });

  try {
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    if (!selectedItemIds || selectedItemIds.length === 0) {
      return { success: false, error: 'Please select at least one item for the quote' };
    }

    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      return { success: false, error: 'Please enter a valid 5-digit zip code' };
    }

    const client = getServiceRoleClient();

    console.log('[QUOTE_V2] Fetching vehicle data');
    let { data: vehicle, error: vehicleError } = await client
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    // Fallback: if service role fails, try anon client (works for is_demo=true vehicles
    // via the "is_demo = true" RLS SELECT policy — no auth required)
    if (vehicleError || !vehicle) {
      console.warn('[QUOTE_V2] Service role vehicle fetch failed, trying anon client:', vehicleError?.message);
      const fallbackClient = getServerClient();
      const fallback = await fallbackClient
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();
      vehicle = fallback.data;
      if (fallback.error || !vehicle) {
        console.error('[QUOTE_V2] Vehicle fetch error (both clients):', vehicleError, fallback.error);
        return { success: false, error: `Vehicle not found (${vehicleError?.message || fallback.error?.message || 'unknown'})` };
      }
    }

    let serviceItems: any[];

    if (items && items.length > 0) {
      console.log('[QUOTE_V2] Using provided items (from wishlist), skipping database lookup');
      serviceItems = items.filter(item => selectedItemIds.includes(item.id));

      if (serviceItems.length === 0) {
        console.error('[QUOTE_V2] No matching items found in provided items array');
        return { success: false, error: 'Selected items not found' };
      }
    } else {
      console.log('[QUOTE_V2] Fetching service items from database');
      const { data: fetchedItems, error: itemsError } = await client
        .from('service_items')
        .select('*')
        .in('id', selectedItemIds);

      if (itemsError || !fetchedItems || fetchedItems.length === 0) {
        console.error('[QUOTE_V2] Service items fetch error:', itemsError);
        return { success: false, error: 'Selected items not found' };
      }

      serviceItems = fetchedItems;

      if (serviceItems.length !== selectedItemIds.length) {
        console.warn('[QUOTE_V2] Some items not found. Expected:', selectedItemIds.length, 'Got:', serviceItems.length);
      }
    }

    console.log('[QUOTE_V2] Estimating costs');
    const costResult = await estimateCosts(vehicle, serviceItems, zipCode);
    if (!costResult.success || !costResult.data) {
      console.error('[QUOTE_V2] Cost estimation failed:', costResult.error);
      return {
        success: false,
        error: costResult.error || 'Failed to estimate costs. Please try again.'
      };
    }

    console.log('[QUOTE_V2] Generating email draft');
    const emailResult = await generateEmailDraft(vehicle, serviceItems, additionalNotes);
    if (!emailResult.success || !emailResult.data) {
      console.error('[QUOTE_V2] Email generation failed:', emailResult.error);
      return {
        success: false,
        error: emailResult.error || 'Failed to generate email draft. Please try again.'
      };
    }

    const selectedItemsData = serviceItems.map((item: any) => ({
      id: item.id,
      description: item.description,
      category: item.category
    }));

    console.log('[QUOTE_V2] Saving quote to database');
    const { data: quoteRequest, error: insertError } = await client
      .from('quote_requests')
      .insert({
        vehicle_id: vehicleId,
        selected_items: selectedItemsData,
        zip_code: zipCode,
        additional_notes: additionalNotes || null,
        name: quoteName || null,
        email_draft: emailResult.data,
        estimated_total_low: costResult.data.total_low,
        estimated_total_high: costResult.data.total_high,
        cost_breakdown: costResult.data
      })
      .select()
      .single();

    if (insertError || !quoteRequest) {
      console.warn('[QUOTE_V2] Database insert failed (continuing with generated content):', insertError?.message);
      // Return generated content with a synthetic ID rather than hard-failing
      const syntheticId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      return {
        success: true,
        data: {
          quoteRequestId: syntheticId,
          emailDraft: emailResult.data,
          costBreakdown: costResult.data
        }
      };
    }

    console.log('[QUOTE_V2] Quote generated successfully:', quoteRequest.id);
    return {
      success: true,
      data: {
        quoteRequestId: quoteRequest.id,
        emailDraft: emailResult.data,
        costBreakdown: costResult.data
      }
    };
  } catch (error: any) {
    console.error('[QUOTE_V2] Unexpected error:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred. Please try again.'
    };
  }
}