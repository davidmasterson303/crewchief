/**
 * Everything the advisor knows about a vehicle, loaded server-side.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `sendConsultantMessage` took the entire vehicle context as *parameters*:
 * vehicle, knowledge, wishlist, service history, maintenance line items,
 * documents, tracked issues, tracked mods, recalls, health summary. The web
 * client loaded all of it and posted it back, and the server built the Gemini
 * prompt out of whatever it was handed.
 *
 * For the web client that is merely wasteful. As the basis of a public API it
 * is two separate problems:
 *
 *   1. **Payload.** A phone would upload the vehicle's entire history on every
 *      message. On a mobile connection that is the difference between a usable
 *      feature and an unusable one.
 *   2. **Trust.** It is caller-controlled data feeding a model prompt. The
 *      codebase already knows this is dangerous here — `auth-posture.test.ts`
 *      asserts `params.isDemo` must never decide the authorization intent,
 *      "because a caller could downgrade the check on a real vehicle". The
 *      same argument applies to every other field: a caller could describe a
 *      vehicle to the advisor however it liked, including as a car it does not
 *      own, and the advisor would answer about the fiction.
 *
 * So the context is derived from `vehicleId` and nothing else. The caller
 * chooses which vehicle to ask about — the server decides what is true of it.
 *
 * ── One loader, two callers ─────────────────────────────────────────────────
 *
 * The server action and the forthcoming `/api/v1/consultant` route share this
 * rather than each assembling their own. Two implementations of "what the
 * advisor knows" would drift, and the drift would be invisible: both would
 * answer, and only one would be right.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@crewchief/core/logger';

/*
  `any` throughout, matching the parameters this replaces and the prompt
  builder that consumes it. These rows are wide, loosely-typed database shapes
  read straight into `CONSULTANT_SYSTEM_PROMPT`; tightening them is worth doing
  and is a separate job from moving where they are loaded from.
*/
export interface ConsultantContext {
  vehicle: any;
  knowledge: any;
  /** `service_items` awaiting work. */
  wishlistItems: any[];
  /** `service_items` already done. */
  completedItems: any[];
  maintenanceLineItems: any[];
  documents: any[];
  issueTracking: any[];
  modTracking: any[];
  /**
   * The `wishlist_items` table, which is a different thing from
   * `wishlistItems` above despite the names. Mods the owner wants, versus
   * service work outstanding. `ConsultantChat.tsx` carries the same warning
   * because the two were conflated once already.
   */
  modWishlistItems: any[];
  nhtsaData: any;
  healthSummary: any;
}

export type ConsultantContextResult =
  | { ok: true; context: ConsultantContext }
  | { ok: false; error: string };

/**
 * Load the advisor's view of a vehicle.
 *
 * `client` must already be authorized for `vehicleId` — this function checks
 * nothing. Pass the client `authorizeVehicleAccess` handed back, which is the
 * anon client for a demo read and the service role once ownership is proven.
 *
 * **Only the vehicle itself is required.** Every other table degrades to empty
 * and is logged, because a car with no recorded mods is the ordinary case and
 * an advisor that refuses to answer until every table responds would be worse
 * than one answering from less. The distinction that matters is between "there
 * is nothing" and "we could not read it", and only the second is logged.
 */
export async function loadConsultantContext(
  vehicleId: string,
  client: SupabaseClient
): Promise<ConsultantContextResult> {
  const [
    vehicleResult,
    knowledgeResult,
    serviceItemsResult,
    maintenanceLineItemsResult,
    documentsResult,
    issueTrackingResult,
    modTrackingResult,
    modWishlistResult,
    nhtsaResult,
    healthResult,
  ] = await Promise.all([
    /*
      `select('*')` is right here and wrong in an API route. This shape is
      never returned to a caller — it feeds prompt assembly in this process —
      so there is no wire contract to pin down, and the prompt reads unusual
      columns (usage_profile, driving_style, stock_hp) that a curated list
      would have to track by hand.
    */
    client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
    client.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    client
      .from('service_items')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('date_completed', { ascending: false }),
    client
      .from('maintenance_line_items')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('service_date', { ascending: false }),
    client.from('vehicle_documents').select('*').eq('vehicle_id', vehicleId),
    client.from('known_issue_tracking').select('*').eq('vehicle_id', vehicleId),
    client.from('modification_tracking').select('*').eq('vehicle_id', vehicleId),
    client
      .from('wishlist_items')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false }),
    client.from('nhtsa_data').select('recalls').eq('vehicle_id', vehicleId).maybeSingle(),
    client.from('vehicle_health_summary').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
  ]);

  if (vehicleResult.error) {
    logger.error('CONSULTANT_CONTEXT', new Error(vehicleResult.error.message), { vehicleId });
    return { ok: false, error: 'Failed to load vehicle' };
  }

  if (!vehicleResult.data) {
    // Same message the authorization layer uses — "not found" and "not yours"
    // stay indistinguishable. See NOT_FOUND_MESSAGE in lib/api-auth.
    return { ok: false, error: 'Vehicle not found' };
  }

  const optional = {
    knowledge: knowledgeResult,
    serviceItems: serviceItemsResult,
    maintenanceLineItems: maintenanceLineItemsResult,
    documents: documentsResult,
    issueTracking: issueTrackingResult,
    modTracking: modTrackingResult,
    modWishlist: modWishlistResult,
    nhtsa: nhtsaResult,
    health: healthResult,
  };

  for (const [name, result] of Object.entries(optional)) {
    if (result.error) {
      logger.warn('CONSULTANT_CONTEXT', 'Context table unreadable, answering without it', {
        vehicleId,
        table: name,
        error: result.error.message,
      });
    }
  }

  const serviceItems = (serviceItemsResult.data || []) as any[];

  return {
    ok: true,
    context: {
      vehicle: vehicleResult.data,
      knowledge: knowledgeResult.data,
      wishlistItems: serviceItems.filter((item) => item.status === 'wishlist'),
      completedItems: serviceItems.filter((item) => item.status === 'completed'),
      maintenanceLineItems: maintenanceLineItemsResult.data || [],
      documents: documentsResult.data || [],
      issueTracking: issueTrackingResult.data || [],
      modTracking: modTrackingResult.data || [],
      modWishlistItems: modWishlistResult.data || [],
      nhtsaData: nhtsaResult.data,
      healthSummary: healthResult.data,
    },
  };
}
