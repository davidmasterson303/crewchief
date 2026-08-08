/**
 * What a service-due figure actually rests on, said out loud.
 *
 * ── Why this exists, and why it is not decoration ───────────────────────────
 *
 * This app has rendered a provenance claim it could not substantiate **twice**.
 * `ae45710` removed fabricated "AI Verified" maintenance records; an
 * unconditional "AI Extracted" badge survived that clean-up and shipped to the
 * public demo, on rows that included hand-typed completions and seeded demo
 * data. `provenance-claims.test.ts` fails the build if that returns, and its
 * instruction for doing it legitimately is the one followed here: **record
 * where the figure came from, and render the claim from that** rather than
 * writing a badge next to it.
 *
 * `evaluateSchedule` already returns `basedOnHistory`, so every claim below is
 * a function of data rather than a sentence someone chose.
 *
 * ── Why it matters more here than on a knowledge panel ──────────────────────
 *
 * Because a structured number reads as a record. "Your 60,000-mile service is
 * due: transmission fluid, spark plugs, brake fluid" is indistinguishable, to
 * an owner, from something their dealer told them — and it is a model's best
 * guess at a manufacturer schedule, compared against an odometer reading the
 * owner typed in themselves. **Structure confers authority**, and the two
 * inputs here have not earned it. The label is how the screen stays honest
 * while still being useful.
 *
 * David's decision, 7 Aug: confirm the mileage, then assert the service, with
 * provenance visible. Both halves.
 *
 * ── Why the wording is in core ──────────────────────────────────────────────
 *
 * Same rule as `consultant-context-kinds.ts`: what a claim **means** and what
 * to call it is product judgement and lives here so both clients make the same
 * claim; how the chip looks — Lucide and Tailwind on web, a bordered `View` on
 * the phone — is presentation and stays with the platform. A provenance label
 * that drifts between clients means the laptop and the phone say different
 * things about the same car, which is the exact failure the context-kind
 * labels were split out to prevent.
 *
 * Deliberately **not** `CONTEXT_KIND_LABELS`. Those mean "this was put in front
 * of the model", which is a claim about a prompt. These mean "this is where the
 * number came from", which is a claim about a fact. Overloading one set to
 * carry both is how `wishlist` and `service` collapsed into one chip and the
 * app asserted a mod profile for a car that had none.
 */

/** Where a "next due" figure came from. */
export type ServiceBasis = 'service-history' | 'owner-reported' | 'mileage-estimate';

/**
 * What was found to count from, before it is turned into a claim.
 *
 * `null` means nothing was found, which is the second-hand car's default and
 * the reason `mileage-estimate` exists.
 */
export type ServiceEvidence = 'records' | 'owner-reported' | null;

/** Where the interval itself came from. Only one source exists today. */
export type ScheduleBasis = 'generated-schedule';

export const SERVICE_BASIS_LABELS: Record<ServiceBasis, string> = {
  'service-history': 'From your service records',
  /*
    Track A2a. Deliberately not folded into `service-history`, and the wording
    is the reason the distinction exists at all.

    A line item extracted from an invoice is evidence: a document said so. An
    onboarding answer is a **recollection** — "I think the last big service was
    around 85,000" — given on a sign-up screen by somebody who mainly wants to
    finish signing up. Both are far better than nothing and both belong in the
    calculation. Only one of them is a record.

    "You told us" rather than "From your notes" because it names the source as a
    person's memory, which is the part a reader needs in order to judge it. This
    is the same reasoning that made `generated-schedule` say "typical" instead
    of "manufacturer-recommended": the weaker word is the true one.
  */
  'owner-reported': 'Based on what you told us at sign-up',
  'mileage-estimate': 'Estimated from your mileage',
};

export const SCHEDULE_BASIS_LABELS: Record<ScheduleBasis, string> = {
  /*
    "Typical" rather than "manufacturer-recommended", which is what the prompt
    asks the model for and what the model will happily claim. We do not hold a
    manufacturer document; we hold a model's account of one. The weaker word is
    the true one.
  */
  'generated-schedule': 'Typical schedule for this vehicle, AI-generated',
};

/**
 * The basis for one service's due figure, derived rather than asserted.
 *
 * Takes the flag `evaluateSchedule` already computes, so there is no second
 * place where a claim could be made that the data does not support.
 */
export function serviceBasis(evidence: ServiceEvidence): ServiceBasis {
  if (evidence === 'records') return 'service-history';
  if (evidence === 'owner-reported') return 'owner-reported';
  return 'mileage-estimate';
}

/**
 * The one-line qualifier for a whole milestone.
 *
 * **A milestone is only as well-founded as its weakest service.** If three
 * services come from logged records and one is estimated, the screen must not
 * say "from your service records" — a reader would take that as covering the
 * lot. Mixed evidence reports as the weakest of what it holds, which is the
 * conservative direction and the only one that cannot mislead.
 *
 * With three bases rather than two the rule is unchanged, just ordered:
 * records > owner-reported > estimate. A milestone mixing an invoice with a
 * remembered date reports as **owner-reported**, because that is the claim the
 * whole group can actually support.
 */
export function milestoneBasis(services: Array<{ evidence: ServiceEvidence }>): ServiceBasis {
  if (services.length === 0) return 'mileage-estimate';

  // Any service with nothing to count from drags the whole visit down to an
  // estimate — one unknown is enough to make "from your records" untrue.
  if (services.some((service) => service.evidence === null)) return 'mileage-estimate';

  return services.every((service) => service.evidence === 'records')
    ? 'service-history'
    : 'owner-reported';
}

/**
 * Narrow an unvalidated string, for the same reason
 * `consultant-context-kinds.ts` does: the mobile client reads this off a JSON
 * response, so what arrives is `unknown` whatever the route's type says. An
 * unrecognised basis renders nothing rather than an empty chip — a client that
 * cannot name a source should not draw one.
 */
export function isServiceBasis(value: unknown): value is ServiceBasis {
  return (
    value === 'service-history' ||
    value === 'owner-reported' ||
    value === 'mileage-estimate'
  );
}
