/**
 * Whether an account is entitled to the paid tier, and for how long.
 *
 * Phase 6, E7 — the surviving half of 5.3 after the web paywall was dropped.
 * Pure, no IO, no clock of its own: the caller reads the row and supplies
 * `now`, exactly as `notification-sweep` does, because the part that has to be
 * right is the reasoning and it should be testable without a database.
 *
 * ── Why this exists before there is anything to buy ─────────────────────────
 *
 * `resolveTier` has been returning `TIERS.free` unconditionally, with a
 * docblock explaining that it is a function rather than a constant "so the call
 * sites are already written against the right shape". That was correct, and it
 * left the actual decision — *is this account entitled today?* — unwritten.
 *
 * It turns out to be the dependency under most of Track E. Apple IAP (E8) needs
 * somewhere to record what it sold; the upgrade prompt (E6) needs something to
 * point at; deleting an account with a live subscription (E5) needs to know
 * there is one. Four items, one missing foundation, and the foundation is the
 * only piece of it that needs no Apple credentials to build.
 *
 * ── The shape is Apple's, deliberately ──────────────────────────────────────
 *
 * A subscription is not a boolean. Apple gives an `original_transaction_id`
 * that is stable across renewals, a product id, and an expiry that moves every
 * period — and it tells you about renewals and lapses asynchronously, through
 * App Store Server Notifications, rather than at the moment of use. So the
 * stored record is "entitled until X" and every read is a comparison against
 * the clock. A stored boolean would be wrong the instant a renewal failed and
 * nobody had told us yet.
 */

import { TIERS, type Tier, type TierName } from './ai/budget';
import { decideFeatureAccess, type FeatureDecision, type PaidFeature } from './paid-features';

export interface EntitlementRecord {
  /** What was sold. Anything not in `TierName` is treated as unrecognised. */
  tier: string | null;
  /**
   * ISO timestamp the current period ends, or null for an entitlement with no
   * expiry — a comped account, or a lifetime grant. Null is *not* "expired".
   */
  expiresAt: string | null;
}

/**
 * The tier an account is actually on right now.
 *
 * ── Every unclear case resolves to `free`, and that is the safe direction ────
 *
 * Note this is the **opposite** default from `decideBudget`, which treats a
 * misconfigured limit as "no ceiling" and lets the call through. The two rules
 * disagree on purpose, because they protect different things and fail in
 * opposite directions:
 *
 *   - `decideBudget` protects **a bill**. Reading a broken config as "spend
 *     nothing" would take every AI feature offline over a typo, so it fails
 *     open and the honest cost is that the ceiling under-reports.
 *   - this protects **revenue**. Reading a broken row as "paid" gives the
 *     product away, silently, to anyone whose record is malformed — and the
 *     malformed case is exactly what an attacker would aim for.
 *
 * ── Why falling back to `free` is not harsh ─────────────────────────────────
 *
 * It matters that the downgrade is survivable rather than punitive. `free` is
 * documented as a fuse rather than a plan — 400k output-equivalent tokens,
 * where the median archetype lands near 200k — so a paying customer hitting a
 * corrupt row is not cut off, they are put on a ceiling an ordinary month does
 * not touch. That is what makes failing closed here defensible: the bad case
 * is a quiet degradation somebody can complain about, not a locked door.
 */
export function resolveEntitledTier(
  record: EntitlementRecord | null | undefined,
  now: Date = new Date()
): Tier {
  if (!record) return TIERS.free;

  const tier = record.tier;
  if (tier === null || !isKnownTier(tier)) return TIERS.free;
  if (tier === 'free') return TIERS.free;

  /*
    No expiry is a deliberate grant rather than a missing value: a comped
    account, or a support gesture. It is distinguishable from a lapsed one
    because a lapse writes a date in the past, never a null.
  */
  if (record.expiresAt === null) return TIERS[tier];

  const expires = Date.parse(record.expiresAt);

  /*
    An unparseable date is not "probably fine". It is the one input here an
    attacker could hope to influence, and reading it as a grant would make a
    malformed row the cheapest subscription in the product.
  */
  if (Number.isNaN(expires)) return TIERS.free;

  return expires > now.getTime() ? TIERS[tier] : TIERS.free;
}

/**
 * Whether an account has an entitlement that is still running.
 *
 * Distinct from `resolveEntitledTier` because the *question* is different, and
 * E5 is why: deleting an account while an Apple-billed subscription keeps
 * charging is a documented App Store rejection reason, and answering it needs
 * "is there a live subscription" rather than "what may they use today". A
 * lapsed record answers the second question and must not answer the first.
 */
export function hasLiveEntitlement(
  record: EntitlementRecord | null | undefined,
  now: Date = new Date()
): boolean {
  return resolveEntitledTier(record, now).name !== 'free';
}

/**
 * Whether this account may use a paid feature — the pricing decision of 24 Aug.
 *
 * ── ⚠ What this module gates changed, and the old shape survives beneath ────
 *
 * `resolveEntitledTier` answers *what may they spend*; that question has not
 * gone away and `decideBudget` still asks it. What changed is that the spend
 * ceiling is no longer **what is sold** — it is abuse protection behind the
 * gate, invisible to the customer, and the thing sold is three named features.
 * `paid-features.ts` carries the full argument.
 *
 * So this is a second reader of the same record rather than a replacement, for
 * the same reason `hasLiveEntitlement` is: the *question* is different.
 * "What may they use today" and "is there a live subscription" already needed
 * separate answers, and "may they open the advisor" is a third — one that must
 * be answerable without a usage query, because it is asked on a screen before
 * anything has been spent.
 *
 * ⚠ Every unclear record still resolves to `free`, and therefore to a refusal
 * once enforcement is on. That is the same direction `resolveEntitledTier`
 * fails in and for the same reason: reading a malformed row as paid gives the
 * product away to exactly the case an attacker would aim for.
 */
export function entitlesFeature(
  record: EntitlementRecord | null | undefined,
  feature: PaidFeature,
  options: { enforced?: boolean; now?: Date } = {}
): FeatureDecision {
  return decideFeatureAccess({
    feature,
    tier: resolveEntitledTier(record, options.now ?? new Date()).name,
    enforced: options.enforced,
  });
}

function isKnownTier(value: string): value is TierName {
  return Object.prototype.hasOwnProperty.call(TIERS, value);
}

/**
 * Postgres/PostgREST codes meaning **the entitlements table is not there.**
 *
 * `PGRST205` is PostgREST failing to find the relation in its schema cache;
 * `42P01` is Postgres' own `undefined_table`.
 */
const TABLE_ABSENT_CODES = new Set(['PGRST205', '42P01']);

/**
 * Whether a failed entitlement read should be treated as "definitely nobody has
 * a subscription" rather than "we cannot tell".
 *
 * ── The deploy-ordering trap this exists to close ───────────────────────────
 *
 * Both read paths deliberately fail *toward* warning: an unreadable entitlement
 * must not cost somebody a subscription they keep paying for after their
 * account is deleted. That is right when the table exists and the read failed.
 *
 * **It is wrong when the table has not been created yet**, and that is a state
 * this project will actually pass through — the code ships in one commit and
 * the migration is applied by hand, separately. In the window between, every
 * read errors, every user is treated as a subscriber, and the delete screen
 * tells all of them to go and cancel a subscription that does not exist. On the
 * surface Apple reviews.
 *
 * A missing table is not ambiguous: nothing could have written a subscription
 * to a table that was never created. So it resolves to "no subscription" with
 * certainty, and every *other* error keeps failing toward the warning.
 *
 * This is deploy-order safety expressed as a rule rather than as a runbook
 * step, because a runbook step is only as good as the person reading it at the
 * moment they push.
 */
export function readFailureMeansNoSubscription(code: string | null | undefined): boolean {
  return code !== null && code !== undefined && TABLE_ABSENT_CODES.has(code);
}
