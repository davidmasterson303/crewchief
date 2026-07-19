'use server';

import { getServiceRoleClient } from '@/lib/supabase';
import { genAI } from '@/lib/gemini';
import { logger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';
import { FLASH_MODEL } from '@/lib/ai/models';

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

export interface CostEstimate {
  items: CostEstimateItem[];
  regional_labor_rate: string;
  total_low: number;
  total_high: number;
}

function extractJSON(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const m = trimmed.match(/^[\s\S]*?(\{[\s\S]*\}|\[[\s\S]*\])[\s\S]*?$/);
    if (m) return JSON.parse(m[1]);
  }
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return JSON.parse(codeBlock[1].trim());
  const json = text.match(/\{[\s\S]*\}/);
  if (json) return JSON.parse(json[0]);
  throw new Error('No valid JSON found in response');
}

const RETRY_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 2000,
  isRetryable: (error: Error) => {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('network') ||
      msg.includes('503') || msg.includes('unavailable') ||
      msg.includes('rate limit') || msg.includes('429');
  },
};

export async function estimateCosts(
  vehicle: { year: number; make: string; model: string; trim?: string; current_mileage?: number },
  serviceItems: Array<{ description: string; category: string }>,
  zipCode: string
): Promise<{ success: boolean; data?: CostEstimate; error?: string }> {
  try {
    const itemsList = serviceItems.map((item, idx) =>
      `${idx + 1}. ${item.description} (Category: ${item.category})`
    ).join('\n');

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
      "parts_cost_low": number,
      "parts_cost_high": number,
      "labor_hours_low": number,
      "labor_hours_high": number,
      "labor_cost_low": number,
      "labor_cost_high": number,
      "notes": "brief explanation of estimate rationale"
    }
  ],
  "regional_labor_rate": "explanation of typical labor rates for this zip code area",
  "total_low": number,
  "total_high": number
}

Important considerations:
1. Account for vehicle complexity (luxury/European brands typically cost more)
2. Consider regional labor rate differences based on zip code
3. Factor in typical market pricing for parts
4. Include realistic labor time estimates based on repair complexity
5. Provide ranges to account for shop-to-shop variation
6. Base labor rates: $80-120/hr for average areas, $120-180/hr for high-cost areas

Return ONLY valid JSON with no additional text.`;

    let result;
    try {
      result = await withRetry(
        async () => genAI.models.generateContent({ model: FLASH_MODEL, contents: prompt }),
        { ...RETRY_OPTIONS, context: 'GEMINI:ESTIMATE_COSTS' }
      );
    } catch (apiError: unknown) {
      const msg = apiError instanceof Error ? apiError.message : String(apiError);
      throw new Error(`Gemini API call failed: ${msg}`);
    }

    const text = result?.text;
    if (!text || typeof text !== 'string') {
      throw new Error('No response text from API');
    }

    const estimateData = extractJSON(text) as unknown as Record<string, unknown>;

    if (!estimateData?.items || !Array.isArray(estimateData.items) || estimateData.items.length === 0) {
      logger.error('ESTIMATE:INVALID_STRUCTURE', new Error('Invalid estimate structure'));
      throw new Error('Invalid cost estimate structure from AI');
    }

    if (!estimateData.total_low || !estimateData.total_high) {
      throw new Error('Missing total cost fields in estimate');
    }

    const estimate = estimateData as unknown as CostEstimate;

    for (let i = 0; i < estimate.items.length; i++) {
      const item = estimate.items[i];
      if (!item.description || typeof item.parts_cost_low !== 'number' || typeof item.labor_cost_low !== 'number') {
        throw new Error(`Invalid item structure at index ${i}`);
      }
    }

    return { success: true, data: estimate };
  } catch (error: unknown) {
    logger.error('ESTIMATE:FAILED', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate cost estimates',
    };
  }
}

export async function generateEmailDraft(
  vehicle: { year: number; make: string; model: string; trim?: string; current_mileage?: number },
  serviceItems: Array<{ description: string; category: string }>,
  additionalNotes?: string
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
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

Return ONLY the email body text. Do NOT include a subject line.`;

    const result = await withRetry(
      async () => genAI.models.generateContent({ model: FLASH_MODEL, contents: prompt }),
      { ...RETRY_OPTIONS, context: 'GEMINI:EMAIL_DRAFT' }
    );

    const emailText = result?.text;
    if (!emailText || typeof emailText !== 'string') {
      throw new Error('No response text from API');
    }

    const emailDraft = emailText.trim();
    if (!emailDraft || emailDraft.length < 50) {
      throw new Error('Generated email is too short or empty');
    }

    return { success: true, data: emailDraft };
  } catch (error: unknown) {
    logger.error('EMAIL:DRAFT_FAILED', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate email draft',
    };
  }
}

function isSupabaseAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: string; code?: string };
  const message = e.message?.toLowerCase() || '';
  const code = e.code?.toLowerCase() || '';
  return message.includes('401') || message.includes('unauthorized') ||
    code.includes('401') || code.includes('unauthorized') ||
    message.includes('invalid') || message.includes('jwt');
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
  data?: { quoteRequestId: string; emailDraft: string; costBreakdown: CostEstimate };
  error?: string;
}> {
  try {
    if (!selectedItemIds || selectedItemIds.length === 0) {
      return { success: false, error: 'Please select at least one item for the quote' };
    }

    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      return { success: false, error: 'Please enter a valid 5-digit zip code' };
    }

    const client = getServiceRoleClient();

    const { data: vehicle, error: vehicleError } = await client
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (vehicleError || !vehicle) {
      logger.error('QUOTE:VEHICLE_FETCH', vehicleError as Error, { vehicleId });
      return { success: false, error: 'Vehicle not found' };
    }

    let serviceItems: Array<{ id: string; description: string; category: string }>;

    if (items && items.length > 0) {
      serviceItems = items.filter(item => selectedItemIds.includes(item.id));
      if (serviceItems.length === 0) {
        return { success: false, error: 'Selected items not found' };
      }
    } else {
      const { data: fetchedItems, error: itemsError } = await client
        .from('service_items')
        .select('*')
        .in('id', selectedItemIds);

      if (itemsError || !fetchedItems || fetchedItems.length === 0) {
        logger.error('QUOTE:ITEMS_FETCH', itemsError as Error, { vehicleId });
        return { success: false, error: 'Selected items not found' };
      }

      serviceItems = fetchedItems;
    }

    const costResult = await estimateCosts(vehicle, serviceItems, zipCode);
    if (!costResult.success || !costResult.data) {
      return { success: false, error: costResult.error || 'Failed to estimate costs. Please try again.' };
    }

    const emailResult = await generateEmailDraft(vehicle, serviceItems, additionalNotes);
    if (!emailResult.success || !emailResult.data) {
      return { success: false, error: emailResult.error || 'Failed to generate email draft. Please try again.' };
    }

    const selectedItemsData = serviceItems.map(item => ({
      id: item.id,
      description: item.description,
      category: item.category,
    }));

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
        cost_breakdown: costResult.data,
      })
      .select()
      .single();

    if (insertError || !quoteRequest) {
      logger.error('QUOTE:DB_INSERT', insertError as Error, { vehicleId });
      return { success: false, error: 'Failed to save quote request' };
    }

    return {
      success: true,
      data: {
        quoteRequestId: quoteRequest.id,
        emailDraft: emailResult.data,
        costBreakdown: costResult.data,
      },
    };
  } catch (error: unknown) {
    logger.error('QUOTE:EXCEPTION', error as Error, { vehicleId });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.',
    };
  }
}

export async function savePreferredZipCode(
  vehicleId: string,
  zipCode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getServiceRoleClient();
    const { error } = await client
      .from('vehicles')
      .update({ preferred_zip_code: zipCode })
      .eq('id', vehicleId);

    if (error) {
      logger.error('QUOTE:SAVE_ZIP', error as Error, { vehicleId });
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: unknown) {
    logger.error('QUOTE:SAVE_ZIP_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Failed to save zip code' };
  }
}

export async function getQuoteRequestHistory(
  vehicleId: string,
  limit = 10
): Promise<{ success: boolean; data?: unknown[]; error?: string }> {
  try {
    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('quote_requests')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('QUOTE:HISTORY_FETCH', error as Error, { vehicleId });
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (error: unknown) {
    logger.error('QUOTE:HISTORY_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch quote request history' };
  }
}
