import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess, requireCaller } from '@/lib/api-auth';
import { validateMileageUpdate } from '@crewchief/core/mileage-tracking';
import { buildBaselineRow, isBaselineAge } from '@crewchief/core/onboarding-baseline';
import { getServiceRoleClient } from '@/lib/supabase';
import { resolveVehiclePhotos } from '@/lib/vehicle-photo';

export const dynamic = 'force-dynamic';

/**
 * The columns this endpoint promises. Declared rather than `select('*')`, for
 * the reasons written out in `load-vehicle/route.ts`: a star select makes the
 * response shape a mirror of the table, so the mobile contract changed every
 * time a migration did, without anyone deciding to change it.
 *
 * Mirrors `GARAGE_COLUMNS` in `hooks/useVehicles.ts` — the garage is the same
 * screen on both clients, so they should be asking for the same facts.
 *
 * `custom_image_url` is read but never returned: it holds a `placeholder://`
 * storage path into a private bucket, not a URL. It is resolved into
 * `photo_url` and stripped.
 */
const GARAGE_COLUMNS =
  'id,year,make,model,trim,color,current_mileage,image_url,custom_image_url,' +
  'performance_mindedness,ownership_objective,created_at,' +
  'vehicle_status,avg_miles_per_month,focal_point_x,focal_point_y,' +
  'nhtsa_data(recalls),' +
  'vehicle_health_summary(health_score,summary,red_flags)';

interface GarageRow {
  id: string;
  image_url?: string | null;
  custom_image_url?: string | null;
  [column: string]: unknown;
}

/**
 * The signed-in caller's garage.
 *
 * Authorization goes through `lib/api-auth`, like every other v1 route. This
 * one used to call `createServerActionClient()` and `auth.getUser()` directly,
 * which meant it accepted a **cookie session only** — so a native client
 * presenting `Authorization: Bearer <jwt>` got a 401 from the one endpoint the
 * garage screen cannot work without. Phase 2.1 built the bearer path; this
 * route predates it and never joined.
 *
 * The gap survived the auth-posture ratchet because the ratchet accepted a bare
 * `auth.getUser()` as proof of a 'session' posture. That proved the route
 * authenticated *somebody*; it could not see which credentials it would take.
 * Tightened in `auth-posture.test.ts` alongside this change.
 */
export async function GET(request: NextRequest): Promise<Response> {
  logger.info('API:GET_VEHICLES', 'Fetching vehicles for authenticated user');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:GET_VEHICLES', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const caller = await requireCaller();
    if (!caller.ok) {
      return caller.response;
    }

    const { data, error } = await caller.client
      .from('vehicles')
      .select(GARAGE_COLUMNS)
      // Explicit, not left to RLS alone — see requireCaller. This filter is
      // also what proves ownership of every row below.
      .eq('user_id', caller.userId)
      .eq('is_demo', false)
      // Ascending, matching useMyVehicles. Two garages listing the same cars in
      // opposite orders is the disagreement this codebase keeps paying for, and
      // nothing consumed the old descending order.
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('API:GET_VEHICLES', new Error(error.message));
      return Response.json(
        { success: false, error: error.message, vehicles: [] } as ApiResponse,
        { status: 500 }
      );
    }

    /*
      `as unknown as` because the column list is a runtime string, so Supabase's
      generic parser cannot narrow the row. Same pattern and same reasoning as
      load-vehicle: the shape is guaranteed by GARAGE_COLUMNS, not by inference.
    */
    const rows = (data || []) as unknown as GarageRow[];

    /*
      Signed with the service role, and only now: the query above returned rows
      the caller owns and nothing else, which is the ownership proof this
      codebase requires before reaching for the privileged client. Signing with
      the caller's own RLS-scoped client would depend on the storage policies
      granting them each object, and a failure there degrades silently to a
      garage with no photos — the failure mode is invisible, so it is not the
      one to build on.

      One round trip for the whole garage, not one per car.
    */
    const photos = await resolveVehiclePhotos(rows, getServiceRoleClient());

    const vehicles = rows.map((row) => {
      const { custom_image_url, ...vehicle } = row;
      return { ...vehicle, photo_url: photos.get(row.id) ?? null };
    });

    logger.info('API:GET_VEHICLES', 'Vehicles fetched successfully', {
      count: vehicles.length,
    });

    return Response.json({
      success: true,
      vehicles,
    } as ApiResponse);
  } catch (error) {
    logger.error('API:GET_VEHICLES', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load vehicles', vehicles: [] } as ApiResponse,
      { status: 500 }
    );
  }
}

/**
 * Record an odometer reading.
 *
 * ── Why this route exists at all ────────────────────────────────────────────
 *
 * `current_mileage` has been read over HTTP since Phase 2.1 and **never
 * written** — the web app updates it through a server action, which a React
 * Native client cannot call. Phase 5.6's service notification opens on a
 * mileage confirmation, so the phone needs a way to answer. This is the first
 * mobile write against `vehicles`.
 *
 * ── Why it is a method here rather than `/api/v1/vehicles/[vehicleId]` ──────
 *
 * No v1 route uses a path parameter. The id travels in the query string on
 * `load-vehicle` and in the body on `wishlist`, and inventing a dynamic segment
 * for one method would make this the only endpoint whose shape has to be
 * explained. The route that already owns this table gains a verb.
 *
 * ── Why the caller says whether it is a correction ──────────────────────────
 *
 * `validateMileageUpdate` carries the reasoning: a purely monotonic rule locks
 * a fat-fingered reading in permanently, and the wrong number then feeds every
 * service-due calculation after it. The flag is how confirming a reading and
 * fixing a typo stay distinguishable, rather than the rule guessing.
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:PATCH_VEHICLE', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  let body: { vehicleId?: unknown; currentMileage?: unknown; isCorrection?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' } as ApiResponse, {
      status: 400,
    });
  }

  const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
  if (!vehicleId) {
    return Response.json({ success: false, error: 'Missing vehicleId' } as ApiResponse, {
      status: 400,
    });
  }

  /*
    `intent: 'write'` rather than a read authorization plus an update. The
    demo vehicles are readable by anyone and must not be writable by anyone —
    `auth-posture.test.ts` enforces this shape on every route that touches a
    vehicle-scoped table, and a mileage write to a seeded demo car would
    change what every visitor sees.
  */
  const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
  if (!access.ok) return access.response;

  const { data: vehicle, error: readError } = await access.client
    .from('vehicles')
    .select('current_mileage')
    .eq('id', vehicleId)
    .maybeSingle();

  if (readError || !vehicle) {
    logger.error(
      'API:PATCH_VEHICLE',
      readError ? new Error(readError.message) : new Error('Vehicle not found after authorization'),
      { vehicleId }
    );
    return Response.json({ success: false, error: 'Vehicle not found' } as ApiResponse, {
      status: 404,
    });
  }

  const decision = validateMileageUpdate({
    current: vehicle.current_mileage ?? 0,
    next: body.currentMileage,
    isCorrection: body.isCorrection === true,
  });

  if (!decision.ok) {
    /*
      422 rather than 400. The request is well-formed and the caller is
      authorized — what failed is a rule about the value, and the message is
      written to be shown to the person who typed it. A 400 would read as a
      client bug and get logged rather than displayed.
    */
    return Response.json(
      { success: false, error: decision.message, reason: decision.reason } as ApiResponse,
      { status: 422 }
    );
  }

  const currentMileage = body.currentMileage as number;

  const { error: writeError } = await access.client
    .from('vehicles')
    .update({
      current_mileage: currentMileage,
      last_mileage_update_date: new Date().toISOString(),
    })
    .eq('id', vehicleId);

  if (writeError) {
    logger.error('API:PATCH_VEHICLE', new Error(writeError.message), { vehicleId });
    return Response.json({ success: false, error: 'Could not save the reading' } as ApiResponse, {
      status: 500,
    });
  }

  logger.info('API:PATCH_VEHICLE', 'Mileage recorded', {
    vehicleId,
    isCorrection: body.isCorrection === true,
  });

  return Response.json({ success: true, currentMileage } as ApiResponse);
}

/**
 * Add a vehicle to the caller's garage.
 *
 * ── Why a route, when `createVehicle` already exists ────────────────────────
 *
 * `app/actions.ts`'s `createVehicle` authenticates with
 * `createServerActionClient()` — `next/headers` cookies and nothing else. A
 * React Native client presents `Authorization: Bearer <jwt>` and carries no
 * cookies, so it cannot call that action at all. Same class as the wishlist GET
 * fixed on 7 Aug, and as the garage route before it.
 *
 * That mattered little while mobile was a companion. From 8 Aug it is the
 * product, and **a person could not create a car on the phone** — there was no
 * sign-up either. This is half of closing that.
 *
 * ── Deliberately fewer fields than the web wizard ───────────────────────────
 *
 * The web action takes fourteen, gathered over a five-step wizard. This takes
 * the four that identify a car plus the two the product actually branches on.
 * Everything else on that row has a sensible default and can be edited later,
 * and a first-run flow that asks for a VIN and a drivetrain before showing
 * anything is a first-run flow people abandon.
 *
 * ── `user_id` is never accepted from the caller ─────────────────────────────
 *
 * Ownership comes from the verified session. `createVehicle`'s own comment
 * makes the point and it holds harder here: a client-supplied `user_id` on a
 * request body reads as authoritative even when the handler ignores it, which
 * is one careless edit away from being trusted.
 *
 * ── Research is not awaited ─────────────────────────────────────────────────
 *
 * The dossier generation measured ~23s on a warm server. Holding the response
 * open for it would put a half-minute spinner between "add my car" and seeing
 * anything. The row is returned immediately and the knowledge base fills in
 * behind it — `research_status: 'pending'` is what `VehicleInsights` already
 * watches for, so the existing machinery does the rest.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:CREATE_VEHICLE', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  const caller = await requireCaller();
  if (!caller.ok) return caller.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' } as ApiResponse, {
      status: 400,
    });
  }

  const year = Number(body.year);
  const make = typeof body.make === 'string' ? body.make.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 2) {
    return Response.json(
      { success: false, error: 'Enter a valid model year' } as ApiResponse,
      { status: 400 }
    );
  }

  if (!make || !model) {
    return Response.json(
      { success: false, error: 'Make and model are required' } as ApiResponse,
      { status: 400 }
    );
  }

  /*
    Mileage reuses `validateMileageUpdate` against a current of 0 rather than
    growing a second opinion about what a plausible odometer reading is. A first
    reading is only ever an increase from nothing, so the correction path does
    not apply and the bounds do.
  */
  const mileage = Number(body.currentMileage ?? 0);
  const mileageCheck = validateMileageUpdate({ current: 0, next: mileage });
  if (!mileageCheck.ok) {
    return Response.json(
      { success: false, error: mileageCheck.message } as ApiResponse,
      { status: 422 }
    );
  }

  const client = getServiceRoleClient();

  const { data: vehicle, error } = await client
    .from('vehicles')
    .insert({
      year,
      make,
      model,
      trim: typeof body.trim === 'string' ? body.trim.trim() : '',
      current_mileage: mileage,
      /*
        The one product branch that has to be set at creation: whether this
        owner sees modifications at all. `mild` means interested and `stock`
        means not — the enum's own values, and `showsModifications` is the rule
        that reads them.
      */
      performance_mindedness: body.wantsModifications === false ? 'stock' : 'mild',
      user_id: caller.userId,
    })
    .select('id,year,make,model')
    .single();

  if (error || !vehicle) {
    logger.error('API:CREATE_VEHICLE', new Error(error?.message ?? 'Insert returned no row'), {
      userId: caller.userId,
    });
    return Response.json({ success: false, error: 'Could not save the vehicle' } as ApiResponse, {
      status: 500,
    });
  }

  /*
    Seed the knowledge-base row as `pending` and return. `VehicleInsights`
    already triggers research when it sees that status, so the dossier fills in
    on first view rather than blocking this request for ~23 seconds.
  */
  const { error: kbError } = await client
    .from('vehicle_knowledge_base')
    .insert({ vehicle_id: vehicle.id, research_status: 'pending' });

  if (kbError) {
    // Not fatal. The car exists and is usable; the dossier is what waits.
    logger.warn('API:CREATE_VEHICLE', 'Vehicle created without a knowledge-base row', {
      vehicleId: vehicle.id,
      error: kbError.message,
    });
  }

  /*
    Track A2a — the service baseline, if the owner gave one.

    ── Why this cannot fail the request ────────────────────────────────────────

    Two independent reasons, and either alone would be enough:

    1. **The migration adding `mileage_at_service` and the `'owner-onboarding'`
       source may not be applied yet.** It is written and additive and needs a
       dashboard run. Until then this insert is rejected on a missing column,
       and a request that let that through would mean **nobody can add a car** —
       turning a pending migration into a total outage of the launch-blocking
       flow.

    2. Even once applied, a baseline is an optimisation. The car is the thing
       being created; the baseline improves what the milestone screen can say
       about it later. Losing it costs a service being estimated rather than
       counted, which is exactly the behaviour every car has today.

    Same posture as the knowledge-base insert above, for the same reason: what
    the caller asked for was a vehicle.
  */
  const baseline = buildBaselineRow({
    mileage: typeof body.lastServiceMileage === 'number' ? body.lastServiceMileage : null,
    age: isBaselineAge(body.lastServiceAge) ? body.lastServiceAge : null,
    today: new Date().toISOString().slice(0, 10),
  });

  if (baseline) {
    const { error: baselineError } = await client
      .from('maintenance_line_items')
      .insert({ vehicle_id: vehicle.id, ...baseline });

    if (baselineError) {
      logger.warn('API:CREATE_VEHICLE', 'Vehicle created without its service baseline', {
        vehicleId: vehicle.id,
        error: baselineError.message,
      });
    }
  }

  logger.info('API:CREATE_VEHICLE', 'Vehicle created', { vehicleId: vehicle.id });

  return Response.json({ success: true, vehicle } as ApiResponse, { status: 201 });
}
