/**
 * What the subscription buys — three features, not a bigger number.
 *
 * ── ⚠ The pricing decision of 24 Aug, and what it replaces ──────────────────
 *
 * The paid tier used to be **a larger token allowance**: 400,000
 * output-equivalent tokens a month became 1,000,000, and `PaywallScreen` sold
 * that difference in as many words. The boundary moves from *how much you have
 * used* to *which features you have*.
 *
 * Three things go wrong with selling an allowance, and they compound:
 *
 *   1. **Nobody can tell what they are buying.** "A monthly allowance for
 *      CrewChief's AI features" is a unit the customer has never seen, cannot
 *      observe while using the app, and has no way to relate to their own use.
 *   2. **The number invites a claim, and the claim was wrong.** The screen said
 *      the paid tier *"raises that allowance five times over"*; 400k → 1M is
 *      **2.5×**. IAP-06. Deriving the figure from `TIERS` fixed the arithmetic
 *      and left the unit unintelligible.
 *   3. **It prices the wrong thing.** Both tiers could reach every feature, so
 *      the expensive paths — the advisor, invoice vision, dossier research —
 *      were open to free accounts and bounded only by a fuse. Cost and revenue
 *      were not connected to each other at any point.
 *
 * A feature gate answers all three. It is nameable on a paywall, it is
 * observable in the product, and the three paid features are exactly the three
 * that call a model — so price now tracks cost by construction rather than by
 * a ceiling somebody tunes.
 *
 * ── ⚠ IAP-06 is killed rather than corrected ────────────────────────────────
 *
 * `entitlementMultiple()` in `ai/budget.ts` exists solely to keep that "five
 * times" copy honest. With the allowance out of the sales pitch there is **no
 * multiple to state**, so the sentence is deleted rather than fixed. A derived
 * figure that nothing renders is a smaller version of the same problem.
 *
 * ── The ceiling survives, as a fuse and not as a pitch ──────────────────────
 *
 * `TIERS` and `decideBudget` are unchanged and still enforced. What changes is
 * that the ceiling is **abuse protection behind the gate**, never customer-
 * facing copy: it exists so one runaway account cannot cost more than every
 * subscription it sits beside, and an ordinary month does not approach it.
 * `ai/budget.ts` already calls it "a fuse, not a meter" — this is that sentence
 * taken seriously in the product as well as the code.
 */

/**
 * The three features a subscription unlocks.
 *
 * ⚠ These are exactly the three that call a model. That is not a coincidence to
 * be maintained by hand — it is the reason the gate is drawn here, and a fourth
 * paid feature that costs nothing to run would be a price rise wearing a
 * feature's clothes.
 */
export type PaidFeature = 'advisor' | 'invoice-scanning' | 'dossier';

/** What stays free, named so the paywall can say it without inventing a list. */
export type FreeFeature = 'garage' | 'service-log' | 'mileage' | 'recalls';

export interface FeatureCopy {
  /** The name on the paywall. Title case, no trailing punctuation. */
  label: string;
  /** One line saying what it does, in the owner's terms rather than ours. */
  blurb: string;
}

export const PAID_FEATURE_COPY: Record<PaidFeature, FeatureCopy> = {
  advisor: {
    label: 'The advisor',
    blurb: 'Ask about a noise, a quote or a job, with your car’s history in front of it.',
  },
  'invoice-scanning': {
    label: 'Invoice scanning',
    blurb: 'Photograph a receipt and have the work read off it into your service log.',
  },
  dossier: {
    label: 'The vehicle dossier',
    blurb: 'Known issues, a typical service schedule and modification guidance for your car.',
  },
};

/**
 * What an account keeps without paying, and it is deliberately a real product.
 *
 * ── ⚠ Why the free tier has to stay useful ──────────────────────────────────
 *
 * A garage that stops working when a subscription lapses is a hostage, not a
 * free tier — and the records in it are the owner's own. Everything here is
 * something CrewChief stores or looks up rather than generates: the car, its
 * history, its mileage, and NHTSA's recall list. None of it costs a model call,
 * so none of it needs to be paid for, and a lapsed subscriber still has their
 * service book.
 *
 * ⚠ **Recalls stay free, and that one is not a pricing decision.** They are
 * safety notices from a federal database. Putting an open recall behind a
 * paywall would mean a defect notice an owner could not see because their card
 * expired, and there is no version of this product where that is acceptable.
 */
export const FREE_FEATURE_COPY: Record<FreeFeature, FeatureCopy> = {
  garage: { label: 'Your garage', blurb: 'Every vehicle you own, with photos and details.' },
  'service-log': {
    label: 'Service log',
    blurb: 'Everything that has been done, entered by hand or scanned in while you had Plus.',
  },
  mileage: { label: 'Mileage tracking', blurb: 'Odometer readings and what is due by distance.' },
  recalls: {
    label: 'Recall alerts',
    blurb: 'Open safety recalls from NHTSA, with a notification when a new one lands.',
  },
};

const PAID: ReadonlySet<string> = new Set(Object.keys(PAID_FEATURE_COPY));

/** Whether a feature sits behind the subscription. */
export function isPaidFeature(feature: string): feature is PaidFeature {
  return PAID.has(feature);
}

/** The paid features in the order a paywall should list them. */
export const PAID_FEATURES: readonly PaidFeature[] = [
  'advisor',
  'invoice-scanning',
  'dossier',
] as const;

/** The free features, in the order a paywall should list them. */
export const FREE_FEATURES: readonly FreeFeature[] = [
  'garage',
  'service-log',
  'mileage',
  'recalls',
] as const;

/**
 * Why a feature was refused, so a caller can say something useful.
 *
 * ⚠ `'not-enforced'` is a distinct answer from `'allowed'` even though both let
 * the call through. A caller that logs them the same way cannot tell "this
 * account is entitled" from "the gate is not switched on yet", and that is
 * exactly the fact somebody will need on the day the switch flips.
 */
export type FeatureDecision =
  | { state: 'allowed' }
  | { state: 'not-enforced' }
  | { state: 'needs-subscription'; feature: PaidFeature; message: string };

/**
 * Whether this account may use a paid feature.
 *
 * ── ⚠ `enforced` exists because you cannot gate what nobody can buy ─────────
 *
 * It is not a feature flag in the usual sense — a knob for rolling something
 * out gradually — and it must not become one. It encodes a single rule:
 *
 *   **A feature may only be gated behind a purchase the app can actually make.**
 *
 * At the time this was written, `PaywallScreen` is mounted by no navigator and
 * no StoreKit library is installed: E8 is unfinished, and there is literally
 * nothing to buy. Shipping an enforcing gate in that state would take the
 * advisor, invoice scanning and the dossier away from every existing account
 * and offer them no way back — a worse product for everybody, and on the
 * surface App Review opens.
 *
 * So the decision is implemented in full and enforcement is off until the thing
 * it points at exists. This is the same shape as
 * `readFailureMeansNoSubscription`'s deploy-ordering rule: a sequencing hazard
 * expressed as a rule in the code rather than as a step in a runbook, because a
 * runbook step is only as good as the person reading it at the moment they push.
 *
 * ⚠ Turning it on is a **product launch**, not a config change. Its
 * preconditions are E8 complete: a purchasable product in App Store Connect, the
 * paywall reachable, and a tested Restore. `paid-features.test.ts` asserts the
 * default is off precisely so nobody flips it by accident and discovers the
 * order was wrong from a support email.
 */
export function decideFeatureAccess(params: {
  feature: PaidFeature;
  /** The tier resolved from the stored entitlement — see `entitlement.ts`. */
  tier: 'free' | 'paid';
  /** Whether there is something to buy. See the docblock; defaults to off. */
  enforced?: boolean;
}): FeatureDecision {
  if (params.enforced !== true) return { state: 'not-enforced' };
  if (params.tier === 'paid') return { state: 'allowed' };

  return {
    state: 'needs-subscription',
    feature: params.feature,
    message: featureUpsellMessage(params.feature),
  };
}

/**
 * What to tell somebody who has hit the gate.
 *
 * ⚠ Names the feature and does not mention allowances, tokens or limits. The
 * whole point of the pricing change is that a customer can tell what they are
 * buying; a refusal that says "you have reached your monthly allowance" would
 * put the old model back in the one place the customer actually reads.
 */
export function featureUpsellMessage(feature: PaidFeature): string {
  return `${PAID_FEATURE_COPY[feature].label} is part of CrewChief Plus. Your garage, service log, mileage and recall alerts stay free.`;
}
