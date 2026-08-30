/**
 * What an account may do, once there is no free tier.
 *
 * ── The two decisions this encodes, both David's, 30 Aug ────────────────────
 *
 *   *"I don't want a free tier. I think we should have a demo view/mode without
 *   real LLM calls so prospects can explore the app without costing anything."*
 *
 *   *"A lapse drops to read only."*
 *
 * Together they replace a tier system with an access system, and the difference
 * is worth stating: `ai/budget.ts` answers **how much** an account may spend,
 * and this answers **what it may do at all**. A budget cannot express "you may
 * read your own service history forever but never write to it again", and that
 * is the shape the product now has.
 *
 * ── Four states, and the last two look identical on purpose ─────────────────
 *
 *   demo          nobody is signed in. Sample data, sample answers, no writes.
 *   subscribed    a live entitlement. Everything.
 *   lapsed        paid once, the subscription ended. Read-only on their own
 *                 records.
 *   unsubscribed  signed up, never subscribed. Read-only, which is a formality
 *                 because there is nothing in the account yet.
 *
 * `lapsed` and `unsubscribed` permit exactly the same things and are still two
 * states, because the **copy** differs and getting that wrong is cruel in one
 * direction and confusing in the other: "your subscription ended" shown to
 * somebody who never had one, or "subscribe to get started" shown to somebody
 * whose two years of service history is sitting behind it.
 *
 * ── ⚠ Why read-only is not the same as locked out ──────────────────────────
 *
 * `paid-features.ts` argues that a garage which stops working when a
 * subscription ends is a hostage, and that the records in it are the owner's
 * own. That argument was written about the free tier and survives its deletion
 * intact, because it was never about tiers — it is about whose data it is.
 *
 * So a lapsed account keeps reading, keeps exporting and keeps the right to
 * delete itself. Reading costs nothing, and Apple's 5.1.1(v) requires the
 * deletion path regardless of billing state. What stops is writing and
 * generating, which are the two things that cost money or change the record.
 */

/** Who is asking. */
export type AccessState = 'demo' | 'subscribed' | 'lapsed' | 'unsubscribed';

/**
 * The things an account can want to do, at the coarsest grain that still makes
 * distinctions the product actually draws.
 */
export type Capability =
  /** See records this account owns. Costs nothing and is never withdrawn. */
  | 'read-own-records'
  /** Add or change them — a service record, a mileage reading, a wishlist item. */
  | 'write-own-records'
  /** Anything that calls a model: the advisor, invoice extraction, the dossier. */
  | 'generate'
  /** Take the data out, in a form the owner keeps. */
  | 'export'
  /** Close the account. Guideline 5.1.1(v) — never gated on anything. */
  | 'delete-account'
  /**
   * Fetch fresh NHTSA recall data for this account's vehicles, and notify.
   *
   * ⚠ **Separated from `read-own-records` deliberately, and it is the one line
   * in this file that is a live question rather than a decision.** See
   * `RECALL_ALERTS_AFTER_LAPSE` below.
   */
  | 'recall-alerts';

/**
 * ⛔ **Open: does a lapsed account still get recall alerts?**
 *
 * "Read only" says no — a recall refresh is a fetch and a write, and it happens
 * without the owner asking. Set to `false`, this file follows the instruction
 * as given.
 *
 * The argument for `true` is `paid-features.ts`'s own, applied harder. It put
 * recalls in the free tier because *a federal defect notice an owner cannot see
 * because their card expired is not a version of this product that should
 * exist* — and that sentence is about **exactly this person**. A recall lookup
 * costs nothing: NHTSA is free, there is no model call, and the nightly sweep
 * already runs.
 *
 * It is one boolean because it should be one decision, made once, by David —
 * not something rediscovered at four call sites. Flipping it changes what
 * `permits('lapsed', 'recall-alerts')` answers and nothing else.
 */
export const RECALL_ALERTS_AFTER_LAPSE = false;

const CAPABILITIES: Record<AccessState, ReadonlySet<Capability>> = {
  /*
    A demo visitor has no account, so `export` and `delete-account` are not
    withheld from them — there is nothing of theirs to take out or close. They
    are absent rather than refused, and the distinction matters for the copy: a
    demo that says "sign in to export your data" is offering something the
    person has not created yet.
  */
  demo: new Set<Capability>(['read-own-records']),

  subscribed: new Set<Capability>([
    'read-own-records',
    'write-own-records',
    'generate',
    'export',
    'delete-account',
    'recall-alerts',
  ]),

  lapsed: new Set<Capability>([
    'read-own-records',
    'export',
    'delete-account',
    ...(RECALL_ALERTS_AFTER_LAPSE ? (['recall-alerts'] as const) : []),
  ]),

  unsubscribed: new Set<Capability>(['read-own-records', 'export', 'delete-account']),
};

/** Whether this state permits this capability. */
export function permits(state: AccessState, capability: Capability): boolean {
  return CAPABILITIES[state].has(capability);
}

/**
 * Whether this state may make a model call. The only question `ai/budget.ts`
 * should ever have to ask this module.
 *
 * ⚠ Named separately from `permits(state, 'generate')` because it is the one
 * with a bill attached, and a call site reading `canGenerate` is harder to
 * misread than one reading a string.
 */
export function canGenerate(state: AccessState): boolean {
  return permits(state, 'generate');
}

/**
 * What to tell somebody who cannot do the thing they just tried.
 *
 * ⚠ Copy lives here, beside the rule, for the reason `advice-disclosure.ts`
 * gives about its own: two clients that explain the same refusal differently
 * are two clients telling somebody different things about their money.
 *
 * Every string says what happened, what it costs them, and what changes it —
 * a refusal that names none of those reads as a bug.
 */
export function refusalCopy(state: AccessState, capability: Capability): string | null {
  if (permits(state, capability)) return null;

  if (state === 'demo') {
    return capability === 'generate'
      ? 'This is a sample answer, written in advance. Subscribe to ask about your own car.'
      : 'This is a demo garage. Subscribe to add your own car and keep its record.';
  }

  if (state === 'lapsed') {
    return capability === 'generate'
      ? 'Your subscription has ended, so new answers are paused. Everything you have already recorded is still here.'
      : 'Your subscription has ended. Your records stay readable and exportable — renew to add to them again.';
  }

  return capability === 'generate'
    ? 'Subscribe to ask about your car, scan invoices and get its dossier.'
    : 'Subscribe to start keeping this car’s record.';
}
