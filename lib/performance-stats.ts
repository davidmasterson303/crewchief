/**
 * Performance-stat recomputation.
 *
 * Lifted out of `app/api/performance-stats/route.ts` so it can be called as a
 * function rather than over HTTP.
 *
 * **Why that mattered.** `app/api/wishlist/complete/route.ts` used to recompute
 * stats by POSTing to `${request.nextUrl.origin}/api/performance-stats` and
 * forwarding the caller's session cookie, so the inner route could authorize
 * the hop. `nextUrl.origin` is derived from the incoming request's host
 * headers, which means the destination of that request — and therefore where
 * the user's session cookie was sent — depended on a header the caller
 * influences and on whether the platform in front of the app normalises it.
 *
 * It may well have been safe on Netlify. The point is that its safety was a
 * property of someone else's proxy configuration rather than of this
 * codebase, it could change without anything here changing, and no test could
 * ever assert it. Deleting the hop is cheaper than verifying it and stays
 * true. The caller already holds an authorized client and a proven vehicle id
 * from `authorizeVehicleScopedRow`, which is strictly better evidence than a
 * re-derived cookie.
 *
 * Authorization and rate limiting stay with the callers: this module assumes
 * it has been handed a client that has already proven access. Do not call it
 * with a service-role client obtained any other way.
 */

import { genAI, flashStructuredConfig } from '@/lib/gemini';
import { recordAiUsageInBackground } from '@/lib/ai-usage';
import { logger } from '@crewchief/core/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PerformanceStats {
  stock_hp: number | null;
  stock_torque: number | null;
  stock_zero_to_sixty: number | null;
  modified_hp: number | null;
  modified_torque: number | null;
  modified_zero_to_sixty: number | null;
  completed_mods: string[];
}

export type PerformanceStatsResult =
  | { ok: true; cached: boolean; stats: PerformanceStats }
  | { ok: false; status: number; error: string };

export function extractJSON(text: string): Record<string, unknown> {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return JSON.parse(codeBlockMatch[1].trim());
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('No valid JSON found');
}

/**
 * Identity of a vehicle's service history, used to decide whether the cached
 * stats are still valid. Order-independent, so reordering rows is not a change.
 */
export function computeModHash(items: string[]): string {
  return [...items].sort().join('|');
}

/**
 * Recompute a vehicle's performance stats, calling Gemini only when the
 * service history has actually changed.
 *
 * @param client  An already-authorized Supabase client. Callers must have
 *                proven access to `vehicleId` before reaching here.
 * @param isDemo  Demo vehicles serve seeded stats and never reach the model —
 *                they have no mod hash, so without this every anonymous page
 *                view would trigger a Gemini call and a write against shared
 *                data that anyone can hit.
 */
export async function recomputePerformanceStats({
  vehicleId,
  client,
  isDemo,
  forceRefresh = false,
}: {
  vehicleId: string;
  client: SupabaseClient;
  isDemo: boolean;
  forceRefresh?: boolean;
}): Promise<PerformanceStatsResult> {
  const { data: vehicle, error: vErr } = await client
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .maybeSingle();

  if (vErr || !vehicle) {
    return { ok: false, status: 404, error: 'Vehicle not found' };
  }

  if (isDemo) {
    return {
      ok: true,
      cached: true,
      stats: {
        stock_hp: vehicle.stock_hp,
        stock_torque: vehicle.stock_torque,
        stock_zero_to_sixty: vehicle.stock_zero_to_sixty,
        modified_hp: vehicle.modified_hp,
        modified_torque: vehicle.modified_torque,
        modified_zero_to_sixty: vehicle.modified_zero_to_sixty,
        completed_mods: [],
      },
    };
  }

  const { data: completedMods } = await client
    .from('modification_tracking')
    .select('mod_name')
    .eq('vehicle_id', vehicleId)
    .eq('status', 'completed');

  const { data: allMaintenanceItems } = await client
    .from('maintenance_line_items')
    .select('item_description')
    .eq('vehicle_id', vehicleId);

  const allItems = new Set<string>();
  completedMods?.forEach((m) => allItems.add(m.mod_name));
  allMaintenanceItems?.forEach((m) => allItems.add(m.item_description));
  const itemList = Array.from(allItems);

  const currentHash = computeModHash(itemList);
  const needsStockStats =
    !vehicle.stock_hp && !vehicle.stock_torque && !vehicle.stock_zero_to_sixty;
  const itemsChanged = currentHash !== (vehicle.perf_stats_mod_hash || '');
  const manualOverride = vehicle.perf_stats_manual_override === true;

  if (!needsStockStats && !itemsChanged && !forceRefresh) {
    return {
      ok: true,
      cached: true,
      stats: {
        stock_hp: vehicle.stock_hp,
        stock_torque: vehicle.stock_torque,
        stock_zero_to_sixty: vehicle.stock_zero_to_sixty,
        modified_hp: vehicle.modified_hp,
        modified_torque: vehicle.modified_torque,
        modified_zero_to_sixty: vehicle.modified_zero_to_sixty,
        completed_mods: [],
      },
    };
  }

  const prompt = buildPrompt(vehicle, itemList, needsStockStats);

  const result = await genAI.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: flashStructuredConfig,
  });
  /*
    The owner comes off the vehicle row rather than the signature. This function
    takes no `userId` — its docblock is explicit that the caller proved access
    before reaching here — and threading one through purely for the meter would
    put a metering concern into an authorization contract that is deliberately
    narrow. `select('*')` already has the row.

    Note the model here is a hardcoded 2.5 literal, which is why it takes no
    thinking level. `model-tiering.test.ts` only forbids literals in
    `app/actions.ts`, so this one is outside the ratchet — worth pulling into a
    tier constant, but that changes which model serves this path and is not a
    metering change.
  */
  recordAiUsageInBackground(
    {
      purpose: 'performance_stats',
      model: 'gemini-2.5-flash',
      userId: (vehicle as { user_id?: string | null }).user_id ?? null,
      vehicleId,
    },
    result.usageMetadata
  );

  const text = result.text || '';
  const parsed = extractJSON(text) as any;

  const perfMods: string[] = parsed.performance_mods || [];
  const hasPerformanceMods = perfMods.length > 0;

  const updateData: Record<string, any> = {
    perf_stats_mod_hash: currentHash,
  };

  if (parsed.stock) {
    if (parsed.stock.hp) updateData.stock_hp = parsed.stock.hp;
    if (parsed.stock.torque) updateData.stock_torque = parsed.stock.torque;
    if (parsed.stock.zero_to_sixty) updateData.stock_zero_to_sixty = parsed.stock.zero_to_sixty;
  }

  if (!manualOverride) {
    if (hasPerformanceMods && parsed.modified) {
      if (parsed.modified.hp) updateData.modified_hp = parsed.modified.hp;
      if (parsed.modified.torque) updateData.modified_torque = parsed.modified.torque;
      if (parsed.modified.zero_to_sixty)
        updateData.modified_zero_to_sixty = parsed.modified.zero_to_sixty;
    } else if (!hasPerformanceMods) {
      updateData.modified_hp = null;
      updateData.modified_torque = null;
      updateData.modified_zero_to_sixty = null;
    }
  }

  const { error: updateErr } = await client
    .from('vehicles')
    .update(updateData)
    .eq('id', vehicleId);

  if (updateErr) {
    logger.error('PERF_STATS:UPDATE', new Error(updateErr.message), { vehicleId });
    return { ok: false, status: 500, error: 'Failed to save stats' };
  }

  return {
    ok: true,
    cached: false,
    stats: {
      stock_hp: updateData.stock_hp ?? vehicle.stock_hp,
      stock_torque: updateData.stock_torque ?? vehicle.stock_torque,
      stock_zero_to_sixty: updateData.stock_zero_to_sixty ?? vehicle.stock_zero_to_sixty,
      modified_hp: updateData.modified_hp !== undefined ? updateData.modified_hp : vehicle.modified_hp,
      modified_torque:
        updateData.modified_torque !== undefined ? updateData.modified_torque : vehicle.modified_torque,
      modified_zero_to_sixty:
        updateData.modified_zero_to_sixty !== undefined
          ? updateData.modified_zero_to_sixty
          : vehicle.modified_zero_to_sixty,
      completed_mods: perfMods,
    },
  };
}

function buildPrompt(vehicle: any, allItems: string[], needsStock: boolean): string {
  const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ''}`.trim();

  let prompt = `You are an expert automotive performance engineer analyzing a ${vehicleName}.\n\n`;

  if (needsStock) {
    prompt += `Provide the FACTORY STOCK performance specifications for this vehicle.\n\n`;
  } else {
    prompt += `The stock specs are: ${vehicle.stock_hp || '?'}hp, ${vehicle.stock_torque || '?'} lb-ft torque, ${vehicle.stock_zero_to_sixty || '?'}s 0-60.\n\n`;
  }

  if (allItems.length > 0) {
    prompt += `Below is a list of ALL maintenance and service items completed on this vehicle. Some are routine maintenance, some are performance modifications. You must identify which items are PERFORMANCE MODIFICATIONS that would affect horsepower, torque, or 0-60 time.\n\n`;
    prompt += `Service history:\n`;
    allItems.forEach((item, i) => {
      prompt += `${i + 1}. ${item}\n`;
    });
    prompt += `\nIdentify which of these are performance modifications (e.g., intake, exhaust, tune, turbo upgrade, intercooler, downpipe, headers, cams, injectors, diverter valve, boost controller, etc). Ignore routine maintenance items like oil changes, fluid services, brake pads, filters, thermostat replacements, cosmetic items, etc.\n\n`;
    prompt += `If performance mods are found, estimate the COMBINED effect on performance. Be realistic - account for diminishing returns and how mods interact.\n\n`;
  }

  prompt += `Return ONLY valid JSON with this exact structure (numeric values only, no units):\n{\n`;
  prompt += `  "stock": { "hp": number, "torque": number, "zero_to_sixty": number },\n`;
  if (allItems.length > 0) {
    prompt += `  "performance_mods": ["list of items you identified as performance mods"],\n`;
    prompt += `  "modified": { "hp": number, "torque": number, "zero_to_sixty": number }\n`;
  } else {
    prompt += `  "performance_mods": []\n`;
  }
  prompt += `}\n\n`;
  prompt += `If no performance mods are found, set "performance_mods" to an empty array and omit the "modified" field.`;

  return prompt;
}
