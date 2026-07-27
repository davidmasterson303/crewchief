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
  createBearerClient,
  createServerActionClient,
  getServerClient,
  getServiceRoleClient,
} from '@/lib/supabase';
import { isDemoVehicleId } from '@crewchief/core/demo';
import { vehicleIdSchema } from '@crewchief/core/validation';
import { logger } from '@crewchief/core/logger';

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

// ---------------------------------------------------------------------------
// Caller identity — cookie session or bearer token
// ---------------------------------------------------------------------------

/*
 * Phase 2 task 2.1. The web app authenticates with cookies. A native client
 * has no cookie jar, so it presents `Authorization: Bearer <jwt>` instead.
 *
 * Both arrive here and leave as the same thing: a verified user plus a client
 * that RLS scopes to them. Everything downstream — the ownership check, the
 * conditions under which a service-role client is handed back — is shared, and
 * deliberately so. A bearer path with its own ownership logic would be a
 * second implementation of the rule that decides who may reach privileged
 * data, and this codebase's recurring bug is a second implementation drifting
 * from the first.
 *
 * NOTE for the internal-fetch ratchet: this is the one module permitted to
 * read an `Authorization` header. See lib/__tests__/internal-fetch-posture.test.ts.
 */

/**
 * Pull the token out of an `Authorization` header value.
 *
 * Deliberately strict. `Bearer` is matched case-insensitively because RFC 6750
 * says the scheme is, but anything malformed returns null rather than a
 * best-effort guess — a token this function had to repair is a token we do not
 * understand, and guessing at credentials is how parsers become vulnerabilities.
 */
export function parseBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;

  const match = /^Bearer[ ]+(\S+)$/i.exec(headerValue.trim());
  return match ? match[1] : null;
}

interface Caller {
  userId: string;
  /** RLS-scoped to the caller. Never privileged. */
  client: SupabaseClient;
}

/**
 * Resolve who is calling, from either credential type.
 *
 * **Precedence, and it is a security decision.** A bearer token wins when one
 * is present, and a *malformed or rejected* bearer is a 401 — it never falls
 * back to whatever cookie happens to be on the request. Falling back would
 * mean a caller who explicitly presented one identity gets served as another,
 * which makes "who was this request?" unanswerable from the outside and hides
 * a broken client behind a stale browser session.
 */
async function resolveCaller(): Promise<Caller | null> {
  const token = readBearerToken();

  if (token) {
    // getUser(jwt) validates the token against the auth server rather than
    // decoding it locally. A signature check we performed ourselves would be
    // a signature check we could get wrong.
    const bearerClient = createBearerClient(token);
    const {
      data: { user },
      error,
    } = await bearerClient.auth.getUser(token);

    if (error || !user) {
      logger.warn('API_AUTH:BEARER_REJECTED', 'Bearer token did not verify');
      return null;
    }

    return { userId: user.id, client: bearerClient };
  }

  const sessionClient = createServerActionClient();
  const {
    data: { user },
    error,
  } = await sessionClient.auth.getUser();

  if (error || !user) return null;

  return { userId: user.id, client: sessionClient };
}

/**
 * Read the Authorization header out of the ambient request.
 *
 * Wrapped so a context without one — a server action invoked outside a request
 * scope, or a unit test — degrades to "no bearer" instead of throwing.
 */
function readBearerToken(): string | null {
  try {
    const { headers } = require('next/headers');
    return parseBearerToken(headers().get('authorization'));
  } catch {
    return null;
  }
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

  // Cookie session or bearer token — see resolveCaller. Everything below is
  // identical for both, which is the point.
  const caller = await resolveCaller();

  if (!caller) {
    return deny('Unauthorized', 401);
  }

  // Ownership is checked through the *caller's* client so RLS applies here too.
  const { data: owned, error: ownershipError } = await caller.client
    .from('vehicles')
    .select('id')
    .eq('id', vehicleId)
    .eq('user_id', caller.userId)
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
      userId: caller.userId,
    });
    return deny(NOT_FOUND_MESSAGE, 404);
  }

  return {
    ok: true,
    isDemo: false,
    userId: caller.userId,
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
 *
 * Accepts either credential type, on the same terms as
 * `authorizeVehicleAccess` — see `resolveCaller`.
 */
export async function requireSession(): Promise<SessionResult> {
  const caller = await resolveCaller();

  if (!caller) {
    return deny('Unauthorized', 401);
  }

  return { ok: true, userId: caller.userId };
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
