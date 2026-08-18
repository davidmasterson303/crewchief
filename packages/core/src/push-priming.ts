/**
 * Whether to explain notifications before iOS asks about them.
 *
 * Phase 5, C5. Pure — no clock of its own, no storage, no React Native — so the
 * rule can be tested without a device, which matters because the behaviour it
 * governs is **irreversible and can only be observed once per install.**
 *
 * ── The problem, stated once ────────────────────────────────────────────────
 *
 * iOS shows the notification permission dialog **exactly once**. A "no" is only
 * undoable in Settings, which nobody goes to. Today `registerForPush()` fires
 * on entry to the signed-in stack, so the one irreversible ask is spent
 * immediately, on somebody who has just signed in and has not yet seen what the
 * product does. The most likely answer to a dialog you did not expect is no.
 *
 * `push.ts`'s own docblock has said this since it was written: *"the better
 * pattern is a screen explaining what CrewChief would tell them before the
 * system dialog appears… That screen is worth building before submission and is
 * not built."* This is the rule half of building it.
 *
 * ── Why a primer is not just politeness ─────────────────────────────────────
 *
 * A primer is refusable without cost. Someone who says "not now" to *our*
 * screen has spent nothing — the system ask is still available, and we can ask
 * again next month when they have a car and a service coming due. Someone who
 * says no to *Apple's* dialog has spent it permanently.
 *
 * So the primer is not a second prompt bolted onto the first. It is the thing
 * that makes the first prompt recoverable.
 */

/** What iOS currently thinks, as the app can observe it. */
export type PushPermission =
  /** Never asked. The one state where the system dialog is still available. */
  | 'undetermined'
  /** Already granted — nothing to ask, nothing to explain. */
  | 'granted'
  /** Refused, and iOS will not re-prompt. Only Settings can change it. */
  | 'denied';

/**
 * How long to wait before offering the primer again after a "not now".
 *
 * 30 days, matching `SERVICE_COOLDOWN_DAYS` rather than being picked
 * separately: both answer "how long before raising the same subject again", and
 * two different numbers for one idea is how a product starts feeling
 * inconsistent for reasons nobody can name.
 */
export const PRIMER_COOLDOWN_DAYS = 30;

/**
 * The number of vehicles below which notifications have nothing to be about.
 *
 * Asking someone with an empty garage to enable service reminders is asking
 * them to agree to something abstract. **Earning the ask is the whole design:**
 * a person who has added a car has demonstrated the thing notifications serve.
 */
export const PRIMER_MIN_VEHICLES = 1;

export interface PrimingInput {
  permission: PushPermission;
  /** ISO date the user last dismissed the primer, or null if never. */
  dismissedOn: string | null;
  vehicleCount: number;
  /** ISO date. Injected so the rule is testable without the clock. */
  today: string;
}

/**
 * Whether to show the explanatory screen now.
 *
 * Every branch below refuses. That is deliberate: the cost of showing the
 * primer too eagerly is an interruption, and the cost of the *system* dialog
 * appearing uninvited is permanent. When in doubt, do not ask yet — the ask
 * keeps.
 */
export function shouldShowPushPrimer(input: PrimingInput): boolean {
  /*
    Granted: there is nothing to explain and nothing to ask. Existing users who
    already said yes must never see this screen — a primer shown to someone who
    already enabled notifications reads as a bug, and it is the regression most
    likely to be introduced by a later edit.
  */
  if (input.permission === 'granted') return false;

  /*
    Denied is the painful one, and the answer is still no.

    iOS will not re-prompt, so our screen could only send them to Settings.
    A person who declined once and is then shown a screen about it has been
    nagged, and the notification they might have wanted is not worth the
    relationship. If this is ever revisited, it belongs somewhere the user
    navigated to deliberately — the account screen — not somewhere they landed.
  */
  if (input.permission === 'denied') return false;

  // Nothing to notify about yet.
  if (input.vehicleCount < PRIMER_MIN_VEHICLES) return false;

  if (input.dismissedOn === null) return true;

  const days = daysBetween(input.dismissedOn, input.today);

  /*
    An unparseable stored date suppresses the primer rather than showing it.
    The same direction as the sweep's cooldown, for the same reason: reading
    "we cannot tell, so ask" turns one corrupt value into a screen that appears
    every single launch, and there is no dedupe that recovers from it.
  */
  if (days === null) return false;

  return days >= PRIMER_COOLDOWN_DAYS;
}

/**
 * Whether to register the device without asking anything.
 *
 * Someone who granted permission — on a previous version, or on another
 * install — still needs their token filed against the account, and that must
 * not wait behind a screen they will never be shown.
 */
export function shouldRegisterSilently(permission: PushPermission): boolean {
  return permission === 'granted';
}

/** Whole days from `from` to `to`, or `null` if either is not a date. */
function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return Math.floor((end - start) / 86_400_000);
}

/**
 * ⚠ **PLACEHOLDER COPY — David's, in Phase 5.5.**
 *
 * This is the text on the screen that decides whether the one irreversible iOS
 * prompt gets a considered answer. It is product copy about what the app
 * promises before it asks for something, which is exactly the category Phase
 * 5.5 exists for.
 *
 * It lives here, as one object, so replacing it is a single edit in a single
 * file and needs no build — Metro reloads JS, so David can iterate on the
 * wording for free (see the roadmap's Track D note on cheap vs. expensive).
 *
 * Written to the house voice per `cc-marketing-0001`: plain and direct, no
 * cocky or cheeky lines. It states what arrives and how often, because the
 * honest objection to notifications is "how much will this bother me" and a
 * primer that does not answer it is decoration.
 */
export const PUSH_PRIMER_COPY = {
  title: 'Two kinds of alert, and nothing else',
  body: 'CrewChief can tell you when a service is coming due for your car, and when a safety recall is issued for it. Nothing else — no offers, no news, no reminders to open the app.',
  detail: 'A service reminder arrives at most once a month per car. A recall arrives when the manufacturer issues one, which for most cars is never.',
  accept: 'Turn on alerts',
  decline: 'Not now',
  /**
   * Shown under the decline button. The reassurance is load-bearing: a primer
   * that feels like a trap gets declined, and the decline is the outcome that
   * costs nothing *only* if the person believes they can change their mind.
   */
  reassurance: 'You can turn these on later from your account.',
} as const;
