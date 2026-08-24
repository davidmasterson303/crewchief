import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';
import { resolveVehiclePhoto } from '@/lib/vehicle-photo';
import { driversForVehicle } from '@crewchief/core/health-drivers';

export const dynamic = 'force-dynamic';

/**
 * One embedded row, whichever shape PostgREST chose.
 *
 * An embedded one-to-one arrives as an object and a one-to-many as an array,
 * and `nhtsa_data` is declared one-to-one but comes back either way depending
 * on how the relationship is inferred. Both mobile screens carry the same
 * helper for the same reason — a wrong guess here reads as a car with no
 * recalls rather than as a shape mismatch, which is the quiet direction to be
 * wrong in.
 */
function embedded<T>(value: unknown): T | undefined {
  return (Array.isArray(value) ? value[0] : (value ?? undefined)) as T | undefined;
}

/**
 * The columns this endpoint promises. Declared rather than `select('*')`.
 *
 * `select('*')` made the response shape a mirror of the table, so every column
 * added to `vehicles` silently became part of the mobile contract and every
 * column removed was a breaking change nobody noticed writing. Listing them
 * makes the contract a decision instead of a side effect.
 *
 * `custom_image_url` is read but never returned: it holds a storage path, not
 * a URL, so it is resolved into `photo_url` and stripped. See `resolvePhoto`.
 */
/*
  The two embedded selects at the end are the fix for a screen that showed
  *less* than the row it was opened from.

  `/api/v1/vehicles` returns `nhtsa_data(recalls)` and
  `vehicle_health_summary(...)`; this route returned neither. So the mobile
  detail screen declared both, computed a band and a recall count from them,
  and rendered a Health card and a recall card that **could never appear** —
  tapping a garage card reading "70 · FAIR · 2 recalls" led to a screen showing
  no score and no recalls.

  It typechecked because both fields are optional, every test passed, and it
  stayed invisible until the screen was opened for the first time on 5 Aug.
  The detail view of a thing must not know less about it than the list did;
  `vehicle-detail-not-poorer.test.ts` keeps it that way.

  Verified against the live database on the **anon** path specifically, because
  that is the client `authorizeVehicleAccess` hands back for a demo read and an
  embedded select is exactly where RLS would bite: the demo Accord returns
  `health_score: 74` and `recalls: []`.
*/
/*
  ⚠ `recall_actions` and `next_service_*` both added 23 Aug, and both are the
  rule directly above this line
  doing its job: the detail view of a thing must not know less about it than the
  list did. The garage bay names the next service, so the screen you reach by
  tapping that bay has to be able to name it too — and `vehicles/route.ts`
  carries why the three columns were absent from both.

  The recall marks travel because this screen counts **open** recalls — total
  minus what the owner has marked repaired — and a detail view that could not
  subtract them would show a number the garage row it was opened from does not.
  That is the failure this whole file's rule is named after.
*/
/*
  ⚠ `last_generated` travels because **a verdict has to be able to say when it
  was reached.**

  On 23 Aug the M235i's detail screen read "a complete lack of documented
  maintenance … impossible to assess its current condition" while its service
  history listed five records and $1,461. Both were rendering honestly: the
  stored summary was generated on 30 Jul, the line items were filed on 6 Aug,
  and the row has not been recomputed since.

  `generateVehicleHealthSummary` reads `maintenance_line_items` as of 5 Aug,
  so a recompute would now produce the right answer — but nothing on the
  mobile read path performs one, and this route returned no way for the client
  to tell that the sentence it was given predates the records beside it. A
  stale verdict that cannot be recognised as stale is indistinguishable from a
  wrong one, and it tells the owner the app did not read the invoice they just
  scanned.

  One column, and it is what lets the screen refuse to present an out-of-date
  reading as a current one.
*/
const VEHICLE_COLUMNS =
  'id,year,make,model,trim,color,vin,current_mileage,avg_miles_per_month,' +
  'image_url,custom_image_url,performance_mindedness,ownership_objective,' +
  'vehicle_status,focal_point_x,focal_point_y,created_at,updated_at,' +
  'next_service_label,next_service_at_miles,next_service_due_on,' +
  'nhtsa_data(recalls),' +
  'recall_actions(campaign_number,addressed_at),' +
  'vehicle_health_summary(health_score,summary,red_flags,last_generated)';

/**
 * Vehicle and knowledge-base read.
 *
 * Authorization goes through `authorizeVehicleAccess` like everything else.
 * It used to hand-roll its own: session lookup, then a `vehicles` ownership
 * query, then `getServiceRoleClient()` — a second implementation of the rule
 * `lib/api-auth.ts` exists to own, and the bug this codebase keeps repeating.
 *
 * It also reached for the service role **unconditionally, including for demo
 * vehicles**, which is why this route returned 500 "Invalid API key" on both
 * deployments while sibling routes served the demo fine: the deployed
 * service-role key is rejected, and this route needed it even for public data.
 * `authorizeVehicleAccess` hands back the anon client for a demo read, so that
 * path no longer depends on the elevated credential at all.
 */

export async function GET(request: NextRequest): Promise<Response> {
  logger.info('API:LOAD_VEHICLE', 'Loading vehicle');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:LOAD_VEHICLE', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const vehicleId = request.nextUrl.searchParams.get('vehicleId');

    if (!vehicleId) {
      logger.warn('API:LOAD_VEHICLE', 'Missing vehicleId parameter');
      return Response.json({ success: false, error: 'Missing vehicleId' } as ApiResponse, { status: 400 });
    }

    // Validates the id, resolves demo vs owned, and returns the right client:
    // anon for a demo read, service-role only once ownership is proven.
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return access.response;
    }

    const supabase = access.client;

    /*
      The third query is the health card's three drivers — 15 Aug.

      ⚠ It is here rather than in a migration, and that is a deliberate change
      of shape from `docs/step4-api-gaps.md`, which proposed three stored
      columns written by the nightly sweep. **Stored numbers would need a
      writer, would go stale between sweeps, and could disagree with the
      schedule they were derived from.** Every input the drivers need is either
      already on this response or is this one extra row, so they are derived at
      read and cannot drift from the facts they describe.

      Parallel with the two that were already here, so the cost is a round trip
      this request was waiting through anyway rather than a third one in series.
      This is a single-vehicle detail read; the garage list must not copy it —
      that is the per-row cost the same document argues against.
    */
    const [vehicleResult, knowledgeResult, historyResult, healthHistoryResult] =
      await Promise.all([
      supabase.from('vehicles').select(VEHICLE_COLUMNS).eq('id', vehicleId).maybeSingle(),
      supabase.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      supabase
        .from('maintenance_line_items')
        .select('item_description, service_date, mileage_at_service, source')
        .eq('vehicle_id', vehicleId),
      /*
        Score over time — the fourth instrument, 15 Aug.

        Bounded at 30 readings and ordered oldest-first, which is the order a
        chart draws in. The bound is not defensive: the sweep writes a row per
        vehicle per run, so this table grows without limit and a detail screen
        that fetched all of it would get slower every night it ran.

        ⚠ **Invisible on this account today**, and that is correct rather than
        broken: there is exactly one recorded reading for the real car, and
        `HealthHistory` declines to draw a chart from a single point. The
        plumbing is here so it fills in on its own as the sweep runs.
      */
      supabase
        .from('vehicle_health_history')
        .select('health_score, recorded_at')
        .eq('vehicle_id', vehicleId)
        .order('recorded_at', { ascending: true })
        .limit(30),
    ]);

    const { data: vehicleData, error: vehicleError } = vehicleResult;

    if (vehicleError) {
      return Response.json({ success: false, error: vehicleError.message } as ApiResponse, { status: 500 });
    }

    if (!vehicleData) {
      return Response.json({ success: false, error: 'Vehicle not found' } as ApiResponse, { status: 404 });
    }

    const knowledgeData = knowledgeResult.data;

    // custom_image_url leaves as photo_url or not at all — a caller must never
    // receive a placeholder:// value it has no way to resolve.
    /*
      `as unknown as` because the column list is a runtime string, so Supabase's
      generic parser cannot narrow the row and falls back to GenericStringError.
      Same pattern as hooks/useVehicles.ts. The shape is guaranteed by
      VEHICLE_COLUMNS above, not by inference.
    */
    const { custom_image_url, ...vehicle } = vehicleData as unknown as Record<
      string,
      unknown
    > & { custom_image_url?: string | null };

    const photo_url = await resolveVehiclePhoto(
      vehicleId,
      { image_url: vehicle.image_url as string | null, custom_image_url },
      supabase
    );

    /*
      ── The drivers, and how each one fails ────────────────────────────────

      `historyResult.error` is **not** fatal and must not be. A demo read runs
      on the anon client, where `maintenance_line_items` may be unreachable
      under RLS, and a detail screen that 500s because it could not enrich a
      card is worse than one that says "no record to count from". So a failed
      history read degrades to no history: every mileage-driven service still
      evaluates from the odometer, and the time-only ones report `unknown`,
      which the maintenance driver is explicitly built not to charge for.

      A missing schedule degrades the same way — `maintenanceDriver` returns a
      null score with a sentence rather than a zero.
    */
    const schedule = knowledgeData?.maintenance_schedule;
    const history = historyResult.error ? [] : (historyResult.data ?? []);

    /*
      ⚠ The assembly moved into `driversForVehicle` — D10.

      It was correct here and it was correct *only* here, which is why the web
      dashboard rendered no drivers at all. Both clients read the one function
      now; the three decisions this block used to make locally (empty schedule,
      degraded history, `undefined` recalls) are stated in its docblock and are
      unchanged.
    */
    const drivers = driversForVehicle({
      schedule,
      historyRows: history,
      /*
        `undefined` when the embed is absent, which the driver reads as "never
        checked" rather than "none". An empty array means NHTSA was asked and
        had nothing; those are different claims and only one of them is safe to
        make.
      */
      recalls: embedded<{ recalls?: unknown }>(vehicle.nhtsa_data)?.recalls,
      currentMileage: vehicle.current_mileage as number | null,
      year: vehicle.year as number | null,
    });

    logger.info('API:LOAD_VEHICLE', 'Vehicle loaded successfully', { vehicleId });

    return Response.json({
      success: true,
      vehicle: { ...vehicle, photo_url },
      knowledge: knowledgeData,
      /*
        Top level rather than folded into `vehicle`. These are *derived* and the
        vehicle object is the row — mixing them would make a caller believe it
        could write one back.
      */
      health_drivers: drivers,
      /*
        Same degrade as the service history: a failed read is an empty chart,
        never a 500. A detail screen that refuses to render because it could not
        draw a trend line is worse than one without the trend line.
      */
      health_history: healthHistoryResult.error ? [] : (healthHistoryResult.data ?? []),
    } as ApiResponse);
  } catch (error) {
    logger.error('API:LOAD_VEHICLE', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load vehicle' } as ApiResponse,
      { status: 500 }
    );
  }
}
