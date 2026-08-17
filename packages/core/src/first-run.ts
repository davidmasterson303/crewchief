/**
 * Whether to show someone the app's opening explanation.
 *
 * ── What was actually missing, which is narrower than "onboarding" ──────────
 *
 * The native app had a sign-up, an empty-garage call to action, a deliberately
 * short add-a-car flow and push priming. What it did not have was **any
 * statement of what the product does before it asks you to add a car**: a new
 * account landed on "No vehicles yet", which is a description of a database
 * rather than an invitation.
 *
 * That is the first screen a TestFlight reviewer meets.
 *
 * ── ⚠ Why there is no "dismissed" flag, and no Skip ─────────────────────────
 *
 * The obvious build is a flag set when the screen is shown or dismissed. It is
 * wrong in a way that only appears in use: someone who opens the app, reads
 * half of it, taps into the add-a-car form and backs out has "seen" it — and
 * comes back to the bare empty state, having lost the explanation they were
 * still reading. The flag records that pixels were displayed, which is not the
 * question anyone cares about.
 *
 * The question is **has this person ever got a car into the product**, and that
 * has an honest answer that needs no dismissal UI:
 *
 * - Never added a car → they are still at the beginning, whatever they have
 *   already scrolled past. Show it.
 * - Has a car → the garage has something in it. Nothing to explain.
 * - Had a car and removed it → they know what this is. A year-old account that
 *   sold its last car should not be greeted with "Start with one car".
 *
 * So the stored fact is `everHadVehicle`, written the first time a garage loads
 * with something in it. Named for what it means rather than for what it gates,
 * because a flag called `seenOnboarding` invites exactly the reasoning above.
 */

export interface FirstRunState {
  /**
   * Has this install ever seen a garage with a car in it?
   *
   * ⚠ Per install, not per account — it is written to device storage. Someone
   * signing in on a new phone with cars already on their account will not see
   * the explanation, because `vehicleCount` settles it before this is read.
   * The two conditions cover each other, which is why neither needs to be
   * exact.
   */
  everHadVehicle: boolean;
  /** Cars in the garage right now. */
  vehicleCount: number;
}

/**
 * `true` only for someone who has never had a car in this product.
 *
 * ⚠ **`vehicleCount` is checked first and is decisive.** Storage can fail —
 * `secureStorage` swallows its own errors and reports `null` — and the failure
 * mode has to be "the explanation reappears for someone with an empty garage",
 * never "the explanation covers a garage that has cars in it".
 */
export function shouldShowFirstRun({ everHadVehicle, vehicleCount }: FirstRunState): boolean {
  if (vehicleCount > 0) return false;

  return !everHadVehicle;
}
