import { getServiceRoleClient } from './supabase';
import { logger } from '@crewchief/core/logger';
import {
  AI_USAGE_PURPOSES,
  AI_USAGE_SURFACES,
  type AiUsagePurpose,
  type AiUsageSurface,
  readUsageMetadata,
  isWorthRecording,
} from '@crewchief/core/ai/usage';
import { isDemoVehicleId } from '@crewchief/core/demo';

/**
 * Record what a Gemini call cost, per account.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Phase 2.95c. Three things wait on it and none of them is observability: tier
 * limits (5.1) have no per-account number to enforce against, decision D2 (the
 * price point) is currently built on estimated tokens, and 2.95d is sized
 * against a guess about how per-user cost grows with tenure.
 *
 * ── It cannot fail a request, and that is a hard rule ───────────────────────
 *
 * A user asked their advisor a question. Whether the meter wrote a row is not
 * their problem, and a metering bug that turns a working answer into an error
 * is strictly worse than an unmetered call. So:
 *
 *   - every path returns rather than throws;
 *   - the caller is not asked to await it (see `recordAiUsage` vs the fire-and-
 *     forget wrapper below);
 *   - a failed write is logged at warn and dropped.
 *
 * The cost of that choice is honest and worth stating: **this meter
 * under-reports rather than over-reports.** A row lost to a database hiccup is
 * a call that happened and was not billed to anyone. For setting a price that
 * is the safe direction to be wrong in — you will price against a floor — but
 * it means the table is not an accounting record and should never be presented
 * as one.
 */

export type { AiUsagePurpose, AiUsageSurface };
export { AI_USAGE_PURPOSES, AI_USAGE_SURFACES };

export interface AiUsageContext {
  purpose: AiUsagePurpose;
  model: string;
  /** NULL for anonymous demo traffic, which is real spend belonging to nobody. */
  userId: string | null;
  vehicleId?: string | null;
  /**
   * Whose traffic this was. **Omit it** unless the derivation below cannot
   * reach the right answer — the canary is the only such case today, because it
   * has no user and no vehicle and would otherwise look like front-door traffic.
   *
   * Deriving rather than requiring it at eleven call sites is deliberate: an
   * explicit parameter is one a future call site can forget, and a forgotten
   * one lands in whichever bucket the default names. The cost of that mistake
   * is a silently wrong price input, which is the exact failure this column
   * exists to prevent.
   */
  surface?: AiUsageSurface;
}

/**
 * Work out whose traffic a call was from what the caller already has.
 *
 * Order matters. A signed-in user reading the demo garage is still an account —
 * their calls cost real money against a real person who might pay — so the
 * `userId` check comes first and the demo check only ever applies to
 * unauthenticated traffic.
 */
export function deriveSurface(context: AiUsageContext): AiUsageSurface {
  if (context.surface) return context.surface;
  if (context.userId) return 'account';
  if (context.vehicleId && isDemoVehicleId(context.vehicleId)) return 'demo';
  return 'anonymous';
}

/**
 * Persist one call's usage. Resolves to `true` when a row was written.
 *
 * Exported un-wrapped so tests can await it. Application code should call
 * `recordAiUsageInBackground`.
 */
export async function recordAiUsage(
  context: AiUsageContext,
  // Deliberately `unknown`: this is `response.usageMetadata` off the SDK, whose
  // shape is the SDK's to change. `readUsageMetadata` does the narrowing in one
  // place rather than every call site trusting a field that may be absent.
  usageMetadata: unknown
): Promise<boolean> {
  try {
    const usage = readUsageMetadata(usageMetadata);

    if (!isWorthRecording(usage)) {
      /*
        A call that reports no tokens at all is not a free call — it is a
        response whose metadata was missing or malformed, and writing a row of
        zeroes would silently deflate every average built on this table. Better
        a gap that can be spotted than a zero that cannot.
      */
      logger.warn('AI_USAGE:NO_METADATA', 'Gemini response carried no usable usage metadata', {
        purpose: context.purpose,
        model: context.model,
      });
      return false;
    }

    const client = getServiceRoleClient();

    const { error } = await client.from('ai_usage_events').insert({
      user_id: context.userId,
      vehicle_id: context.vehicleId ?? null,
      model: context.model,
      purpose: context.purpose,
      surface: deriveSurface(context),
      prompt_tokens: usage.promptTokens,
      output_tokens: usage.outputTokens,
      thoughts_tokens: usage.thoughtsTokens,
      cached_tokens: usage.cachedTokens,
      total_tokens: usage.totalTokens,
    });

    if (error) {
      logger.warn('AI_USAGE:WRITE_FAILED', 'Could not record AI usage', {
        purpose: context.purpose,
        model: context.model,
        message: error.message,
      });
      return false;
    }

    return true;
  } catch (err) {
    /*
      Catches the case the `error` branch above cannot: `getServiceRoleClient`
      throwing because the key is unset. That is the shape a misconfigured
      preview takes, and it must not turn every consultant answer into a 500.
    */
    logger.warn('AI_USAGE:RECORD_THREW', 'AI usage recording threw and was dropped', {
      purpose: context.purpose,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Fire-and-forget. The call site does not await it and cannot be broken by it.
 *
 * `void` on the promise is load-bearing rather than stylistic: without it an
 * unhandled rejection from a future refactor of the function above would take
 * the process down under Node's default, and the whole point of this module is
 * that it cannot.
 */
export function recordAiUsageInBackground(context: AiUsageContext, usageMetadata: unknown): void {
  void recordAiUsage(context, usageMetadata).catch(() => {
    // `recordAiUsage` already swallows and logs. This is the belt to that
    // braces — reached only if the catch above is ever removed.
  });
}
