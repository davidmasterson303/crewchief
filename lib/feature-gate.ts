import { getServiceRoleClient } from './supabase';
import { logger } from '@crewchief/core/logger';
import { entitlesFeature } from '@crewchief/core/entitlement';
import { type FeatureDecision, type PaidFeature } from '@crewchief/core/paid-features';

/**
 * The server-side half of the feature gate — the pricing decision of 24 Aug.
 *
 * ── Why this is a sibling of `ai-budget.ts` and not part of it ──────────────
 *
 * They answer different questions and fail in **opposite directions**, which is
 * exactly the pairing `entitlement.ts` already documents:
 *
 *   - `checkMonthlyBudget` protects **a bill**. An unreadable usage row lets the
 *     call through, because taking every AI feature offline over a database
 *     hiccup costs more than the tokens would.
 *   - this protects **revenue**. An unreadable entitlement resolves to `free`,
 *     because reading a broken row as paid gives the product away to precisely
 *     the case somebody would try to manufacture.
 *
 * Folding them into one function would force one failure direction on both, and
 * whichever was chosen would be wrong for the other half.
 *
 * Both still run. The gate decides *whether* a feature may be used at all; the
 * budget decides whether this particular call is affordable. A subscriber past
 * the fuse is still refused, and that is deliberate — `paid-features.ts` calls
 * the ceiling abuse protection behind the gate rather than a thing being sold.
 */

/**
 * ── ⚠ Off until there is something to buy ───────────────────────────────────
 *
 * `PAID_FEATURES_ENFORCED` is not a rollout flag and must not become one. It
 * encodes one rule, stated at length in `paid-features.ts`: **a feature may
 * only be gated behind a purchase the app can actually make.**
 *
 * As of writing, E8 is unfinished — `PaywallScreen` is mounted by no navigator
 * and no StoreKit library is installed. Enforcing now would take the advisor,
 * invoice scanning and the dossier from every existing account and offer them
 * no way back.
 *
 * ⚠ Anything other than the exact string `'true'` is off, including `'1'`,
 * `'yes'` and `'TRUE'`. A gate that switches on for a typo is a gate that
 * switches on by accident, and the accident here is a support inbox.
 *
 * ⚠ It is read per call rather than captured at module load. A captured value
 * bakes the environment into the bundle and makes the switch a redeploy of the
 * whole app rather than a config change plus a restart.
 */
function enforced(): boolean {
  return process.env.PAID_FEATURES_ENFORCED === 'true';
}

/**
 * Whether this account may use a paid feature.
 *
 * ⚠ An anonymous caller is `null` and resolves to `free`. The demo reaches the
 * consultant through its own budget path and must keep doing so — it is a
 * portfolio piece with its own ceiling, not an account, and gating it would put
 * a paywall on the page recruiters are sent to.
 */
export async function checkFeatureAccess(
  userId: string | null,
  feature: PaidFeature
): Promise<FeatureDecision> {
  if (!enforced()) return { state: 'not-enforced' };
  if (!userId) return entitlesFeature(null, feature, { enforced: true });

  try {
    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('account_entitlements')
      .select('tier, expires_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      /*
        ⚠ Fails **closed**, unlike every other read in `ai-budget.ts`. Logged at
        warn so a paying customer's complaint has something to match, which is
        the same bargain `readTier` makes in the other direction.
      */
      logger.warn(
        'FEATURE_GATE:ENTITLEMENT_READ_FAILED',
        'Could not read entitlement; treating as free',
        { userId, feature, message: error.message }
      );
      return entitlesFeature(null, feature, { enforced: true });
    }

    /*
      A missing row is the ordinary case rather than an error: an account only
      gets one when it buys something.
    */
    return entitlesFeature(
      data
        ? { tier: data.tier as string | null, expiresAt: data.expires_at as string | null }
        : null,
      feature,
      { enforced: true }
    );
  } catch (err) {
    logger.warn('FEATURE_GATE:THREW', 'Feature gate threw; treating as free', {
      userId,
      feature,
      message: err instanceof Error ? err.message : String(err),
    });
    return entitlesFeature(null, feature, { enforced: true });
  }
}

/**
 * The refusal message, or `null` when the call may proceed.
 *
 * A convenience for the call sites, which all have the same shape as the budget
 * checks above them: one guard, one early return carrying a sentence the client
 * can render.
 */
export function featureRefusal(decision: FeatureDecision): string | null {
  return decision.state === 'needs-subscription' ? decision.message : null;
}
