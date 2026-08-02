/**
 * Reading a Gemini response's usage metadata, and deciding whether it is worth
 * recording. No database, no SDK.
 *
 * The write itself needs a service-role client (see `lib/ai-usage.ts`), but the
 * decisions — which fields to read, what a missing field means, whether a row
 * of zeroes is a free call or a broken response — are pure, and they are the
 * part that fails quietly. A meter that records zeroes looks exactly like a
 * meter that is working, right up until the price is set off its averages.
 */

/**
 * The purposes a Gemini call can be recorded under.
 *
 * One per call site as of 2 Aug 2026. Mirrors the CHECK constraint in
 * `20260802150000_meter_ai_usage_per_account.sql` and is held in step with it by
 * `ai-usage-purposes.test.ts` — a purpose the application knows and the database
 * refuses is a write that fails at runtime, on the one path that is not allowed
 * to disturb a request.
 *
 * Adding one means a migration. That is the correct amount of friction for a
 * vocabulary the cost reports are grouped by; the alternative is 'consultant',
 * 'Consultant' and 'chat' all being different features by the time anyone looks.
 */
export const AI_USAGE_PURPOSES = [
  'consultant',
  'invoice_extraction',
  'vehicle_dossier',
  'vehicle_health_summary',
  'powertrain_options',
  'modification_details',
  'modification_backfill',
  'performance_stats',
  'health_check',
] as const;

export type AiUsagePurpose = (typeof AI_USAGE_PURPOSES)[number];

export interface AiUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

/** A non-negative integer, or 0 for anything that is not one. */
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

/**
 * Narrow the SDK's `usageMetadata` into the five numbers this application bills
 * against.
 *
 * Takes `unknown` on purpose. The shape belongs to `@google/genai` and has
 * already changed once in this project's lifetime; doing the narrowing here
 * means a field disappearing produces a zero in one place rather than a
 * `TypeError` at nine call sites, on paths that must not throw.
 *
 * **`totalTokens` is recomputed rather than trusted when it disagrees.** The
 * API's own total has been observed to exclude thinking tokens on some
 * responses, and a total that omits the most expensive component is worse than
 * no total — every cost figure derived from it would be low, consistently, and
 * plausibly.
 */
export function readUsageMetadata(metadata: unknown): AiUsage {
  const m = (metadata ?? {}) as Record<string, unknown>;

  const promptTokens = count(m.promptTokenCount);
  const outputTokens = count(m.candidatesTokenCount);
  const thoughtsTokens = count(m.thoughtsTokenCount);
  const cachedTokens = count(m.cachedContentTokenCount);

  const reported = count(m.totalTokenCount);
  const summed = promptTokens + outputTokens + thoughtsTokens;

  return {
    promptTokens,
    outputTokens,
    thoughtsTokens,
    cachedTokens,
    totalTokens: Math.max(reported, summed),
  };
}

/**
 * Whether this usage represents a call that actually happened.
 *
 * A response with every counter at zero is not a free call — Gemini does not
 * serve those. It is metadata that was missing, malformed, or from an error
 * path. Writing it would put a row of zeroes in the table, and a row of zeroes
 * is invisible in exactly the statistic it corrupts: it drags every per-call
 * average down without appearing anywhere as a fault.
 *
 * A gap can be noticed. A zero cannot.
 */
export function isWorthRecording(usage: AiUsage): boolean {
  return usage.promptTokens > 0 || usage.outputTokens > 0 || usage.thoughtsTokens > 0;
}

/**
 * What a call cost, in the only unit that is comparable across models:
 * billable tokens, with thinking counted at output rate.
 *
 * Not a currency figure. Prices belong with the model tiers and change without
 * the schema changing; this is the quantity those prices multiply.
 */
export function billableTokens(usage: AiUsage): { input: number; output: number } {
  return {
    // Cached input bills at a discount, so it is reported separately rather
    // than folded in. Subtracting it here would understate the full-rate input.
    input: usage.promptTokens,
    // Thinking bills at the output rate. This is the sum that made 2.95a the
    // largest single cost lever in the application.
    output: usage.outputTokens + usage.thoughtsTokens,
  };
}
