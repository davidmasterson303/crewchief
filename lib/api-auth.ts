/**
 * CrewChief - API route authorization
 *
 * Every API route that touches vehicle-scoped data must run through
 * `authorizeVehicleAccess` before it reaches for a privileged client.
 *
 * The rules it encodes:
 *
 *   - Demo vehicles are world-readable and never writable. They are shared
 *     across every anonymous visitor, so a write would corrupt the public
 *     demo for everyone.
 *   - Everything else requires a session AND ownership of the vehicle.
 *   - The service-role client bypasses RLS entirely, so it is only handed
 *     back once ownership has been proven.
 *
 * Callers that receive `{ ok: false }` must return `result.response`
 * unchanged — it carries the correct status and a message that does not
 * leak whether the resource exists.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createServerActionClient,
  getServerClient,
  getServiceRoleClient,
} from '@/lib/supabase';
import { isDemoVehicleId } from '@/lib/demo';
import { vehicleIdSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

export type AccessIntent = 'read' | 'write';

export interface VehicleAccessGranted {
  ok: true;
  /** True when the caller is operating on shared demo data. */
  isDemo: boolean;
  /** Null for anonymous demo reads. */
  userId: string | null;
  /**
   * Anon client for demo reads (RLS scopes it to is_demo rows), service-role
   * client once ownership is proven. Use this and not a fresh client.
   */
  client: SupabaseClient;
}

export interface VehicleAccessDenied {
  ok: false;
  /** Ready-to-return Response, for route handlers. */
  response: Response;
  /** Same denial as plain data, for server actions that return `{success,error}`. */
  error: string;
  status: number;
}

export type VehicleAccessResult = VehicleAccessGranted | VehicleAccessDenied;

/**
 * Deliberately vague — "not found" and "not yours" must be indistinguishable
 * so this cannot be used to probe for which vehicle IDs exist.
 */
const NOT_FOUND_MESSAGE = 'Vehicle not found';

function deny(error: string, status: number): VehicleAccessDenied {
  return {
    ok: false,
    response: Response.json({ success: false, error }, { status }),
    error,
    status,
  };
}

/**
 * Resolve whether the current caller may act on `vehicleId`.
 *
 * @param vehicleId  Vehicle UUID from the request. Null/undefined yields 400.
 * @param intent     'read' permits anonymous access to demo vehicles.
 *                   'write' rejects demo vehicles outright.
 */
export async function authorizeVehicleAccess(
  vehicleId: string | null | undefined,
  { intent }: { intent: AccessIntent }
): Promise<VehicleAccessResult> {
  if (!vehicleId) {
    return deny('Missing vehicleId', 400);
  }

  if (!vehicleIdSchema.safeParse(vehicleId).success) {
    return deny('Invalid vehicleId format', 400);
  }

  if (isDemoVehicleId(vehicleId)) {
    if (intent === 'write') {
      return deny('Demo vehicles are read-only', 403);
    }
    // Anon client: the SELECT policy restricts it to is_demo rows.
    return { ok: true, isDemo: true, userId: null, client: getServerClient() };
  }

  const sessionClient = createServerActionClient();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();

  if (authError || !user) {
    return deny('Unauthorized', 401);
  }

  // Ownership is checked through the *session* client so RLS applies here too.
  const { data: owned, error: ownershipError } = await sessionClient
    .from('vehicles')
    .select('id')
    .eq('id', vehicleId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (ownershipError) {
    logger.error('API_AUTH:OWNERSHIP_LOOKUP', new Error(ownershipError.message), {
      vehicleId,
    });
    return deny('Failed to verify vehicle access', 500);
  }

  if (!owned) {
    logger.warn('API_AUTH:OWNERSHIP_DENIED', 'Caller does not own vehicle', {
      vehicleId,
      userId: user.id,
    });
    return deny(NOT_FOUND_MESSAGE, 404);
  }

  return {
    ok: true,
    isDemo: false,
    userId: user.id,
    client: getServiceRoleClient(),
  };
}

/**
 * Same contract as `authorizeVehicleAccess`, but starting from a row ID whose
 * table hangs off a vehicle. Resolves the parent vehicle, then authorizes it.
 *
 * The lookup runs with the service role because RLS would hide the row from an
 * unauthenticated caller and we would not be able to tell "missing" from
 * "forbidden" — both of which must return the same 404 anyway.
 */
export type SessionGranted = { ok: true; userId: string };
export type SessionResult = SessionGranted | VehicleAccessDenied;

/**
 * Require a signed-in caller, without tying the request to a vehicle.
 *
 * For actions that legitimately have no vehicle association but still must not
 * be open to the internet — a VIN decode, a Gemini-backed spec lookup, a file
 * upload that has not been attached to anything yet. These leak little on
 * their own but they cost money and write rows, so anonymous callers are out.
 *
 * Prefer `authorizeVehicleAccess` whenever a vehicle is in scope; this is the
 * weaker guarantee and should be the exception.
 */
export async function requireSession(): Promise<SessionResult> {
  const sessionClient = createServerActionClient();
  const {
    data: { user },
    error,
  } = await sessionClient.auth.getUser();

  if (error || !user) {
    return deny('Unauthorized', 401);
  }

  return { ok: true, userId: user.id };
}

export type VehicleScopedTable =
  | 'wishlist_items'
  | 'maintenance_line_items'
  | 'vehicle_documents'
  | 'invoice_line_items'
  | 'service_items'
  | 'consultant_conversations';

export async function authorizeVehicleScopedRow(
  table: VehicleScopedTable,
  rowId: string | null | undefined,
  { intent }: { intent: AccessIntent }
): Promise<VehicleAccessResult & { vehicleId?: string }> {
  if (!rowId) {
    return deny('Missing id', 400);
  }

  if (!vehicleIdSchema.safeParse(rowId).success) {
    return deny('Invalid id format', 400);
  }

  const { data: row, error } = await getServiceRoleClient()
    .from(table)
    .select('vehicle_id')
    .eq('id', rowId)
    .maybeSingle();

  if (error) {
    logger.error('API_AUTH:ROW_LOOKUP', new Error(error.message), { table, rowId });
    return deny('Failed to verify access', 500);
  }

  if (!row) {
    // Same status and message as "not yours" — see NOT_FOUND_MESSAGE.
    return deny(NOT_FOUND_MESSAGE, 404);
  }

  const result = await authorizeVehicleAccess(row.vehicle_id, { intent });
  return result.ok ? { ...result, vehicleId: row.vehicle_id } : result;
}
