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
import { selectNhtsaRow } from '@/lib/nhtsa-row';
import { logger } from '@wellkept/core/logger';

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
 * The collections the advisor can be grounded in, named for the chips the web
 * client renders under an answer.
 *
 * These live here rather than in the component because the claim they make is
 * now a server-side fact. While `ConsultantChat.tsx` assembled the context and
 * posted it, it could honestly say "this is what I supplied". Once the context
 * moved into `loadConsultantContext`, the client no longer knew — it was still
 * computing chips from values it sent and the server discarded. Same shape as
 * the "AI Extracted" badge removed in `9597869`: a provenance claim the data
 * behind it no longer substantiated.
 */
/*
  Declared in `@wellkept/core/consultant-context-kinds` since the Expo advisor
  screen began rendering the same provenance row and cannot reach this file.
  Re-exported rather than moved outright so the existing `@/lib/consultant-context`
  import path keeps working — this module is still where the kinds are *computed*,
  which is the half that needs a Supabase client.
*/
export type { ContextKind } from '@wellkept/core/consultant-context-kinds';
import type { ContextKind } from '@wellkept/core/consultant-context-kinds';

function nonEmpty(v: any): boolean {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/**
 * Which collections were non-empty in the context that built this prompt.
 *
 * The claim is "this was loaded and put in front of the model", which is
 * checkable from here and was not checkable from the browser. It is still not
 * "the model used this" — no caller can know that — so the client keeps
 * prefixing the row "Based on" rather than "Sources".
 *
 * `wishlistItems` is deliberately absent: it is outstanding `service_items`,
 * and the "Wishlist" chip means `modWishlistItems` — the `wishlist_items`
 * table, which is mods the owner wants. The two were collapsed into one chip
 * once already, and the chip claimed a mod profile the demo Accord does not
 * have. The field names are what mislead; these labels tell the truth.
 */
export function loadedContextKinds(context: ConsultantContext): ContextKind[] {
  const kinds: ContextKind[] = [];
  if (nonEmpty(context.knowledge)) kinds.push('knowledge');
  if (nonEmpty(context.completedItems) || nonEmpty(context.maintenanceLineItems)) {
    kinds.push('service');
  }
  if (nonEmpty(context.issueTracking)) kinds.push('issues');
  if (nonEmpty(context.modTracking)) kinds.push('mods');
  if (nonEmpty(context.modWishlistItems)) kinds.push('wishlist');
  if (nonEmpty(context.nhtsaData?.recalls)) kinds.push('recalls');
  return kinds;
}

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
    /*
      `lookup_status` so the advisor can say "not checked" rather than "none".
      FN-03 — and through `selectNhtsaRow`, because the column is not applied in
      production and naming it in a select rejects the whole query. The advisor
      losing every recall it could have cited is the same silent failure the
      dashboard had.
    */
    selectNhtsaRow(client, vehicleId).then((data) => ({ data, error: null })),
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
