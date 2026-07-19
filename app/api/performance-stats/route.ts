import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase';
import { genAI, flashStructuredConfig } from '@/lib/gemini';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function extractJSON(text: string): Record<string, unknown> {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return JSON.parse(codeBlockMatch[1].trim());
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('No valid JSON found');
}

function computeModHash(items: string[]): string {
  return [...items].sort().join('|');
}

export async function POST(request: NextRequest) {
  try {
    const identifier = getClientIdentifier(request);
    const rateLimit = await checkRateLimit(identifier, 'ai');
    if (!rateLimit.allowed) {
      logger.warn('PERF_STATS:RATE_LIMIT', 'Rate limit exceeded', { identifier });
      return rateLimitResponse(rateLimit) as NextResponse;
    }

    const { vehicleId, forceRefresh } = await request.json();
    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId required' }, { status: 400 });
    }

    const client = getServiceRoleClient();

    const { data: vehicle, error: vErr } = await client
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .maybeSingle();

    if (vErr || !vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
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
    completedMods?.forEach(m => allItems.add(m.mod_name));
    allMaintenanceItems?.forEach(m => allItems.add(m.item_description));
    const itemList = Array.from(allItems);

    const currentHash = computeModHash(itemList);
    const needsStockStats = !vehicle.stock_hp && !vehicle.stock_torque && !vehicle.stock_zero_to_sixty;
    const itemsChanged = currentHash !== (vehicle.perf_stats_mod_hash || '');
    const manualOverride = vehicle.perf_stats_manual_override === true;

    if (!needsStockStats && !itemsChanged && !forceRefresh) {
      return NextResponse.json({
        success: true,
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
      });
    }

    const prompt = buildPrompt(vehicle, itemList, needsStockStats);

    const result = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: flashStructuredConfig,
    });

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
        if (parsed.modified.zero_to_sixty) updateData.modified_zero_to_sixty = parsed.modified.zero_to_sixty;
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
      logger.error('PERF_STATS:UPDATE', updateErr as Error, { vehicleId });
      return NextResponse.json({ error: 'Failed to save stats' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      cached: false,
      stats: {
        stock_hp: updateData.stock_hp ?? vehicle.stock_hp,
        stock_torque: updateData.stock_torque ?? vehicle.stock_torque,
        stock_zero_to_sixty: updateData.stock_zero_to_sixty ?? vehicle.stock_zero_to_sixty,
        modified_hp: updateData.modified_hp !== undefined ? updateData.modified_hp : vehicle.modified_hp,
        modified_torque: updateData.modified_torque !== undefined ? updateData.modified_torque : vehicle.modified_torque,
        modified_zero_to_sixty: updateData.modified_zero_to_sixty !== undefined ? updateData.modified_zero_to_sixty : vehicle.modified_zero_to_sixty,
        completed_mods: perfMods,
      },
    });
  } catch (error) {
    logger.error('PERF_STATS:EXCEPTION', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
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
