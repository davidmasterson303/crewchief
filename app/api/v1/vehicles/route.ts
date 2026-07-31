import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { requireCaller } from '@/lib/api-auth';
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
  'performance_goal,ownership_objective,created_at,' +
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
