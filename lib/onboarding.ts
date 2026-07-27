/**
 * Who sees the onboarding flow.
 *
 * Task 1.6's third done-condition: `/onboard` should not re-run for someone
 * who has already been through it. Two decisions are worth writing down,
 * because both have a wrong answer that looks right.
 *
 * **The predicate is vehicle count, not "has a profiles row."**
 * `supabase/migrations/20260726120000_create_profiles.sql` creates the profile
 * from an `AFTER INSERT ON auth.users` trigger, so the row exists before the
 * app has ever seen the user. "Has a profile" is therefore true of a
 * brand-new signup, and a guard built on it would skip onboarding for exactly
 * the person who needs it. Task 1.1 also backfilled profiles for existing
 * users, so the column carries no signal about who has finished onboarding.
 * Owning a vehicle does: it is the thing onboarding produces.
 *
 * **"Returning user" is not the same as "arrived here on purpose."**
 * `app/garage/page.tsx` links to `/onboard` from its Add-vehicle buttons, and
 * every user who clicks one already has a vehicle. A guard that redirects on
 * vehicle count alone would make it impossible to add a second car — turning
 * a polish task into a functional regression on the app's main flow. So the
 * garage links carry `?from=garage`, and that marks the visit as deliberate.
 * The automatic entry the done-condition is about — `app/signup/page.tsx`
 * pushing `/onboard` after signup, or a returning user with a bookmark —
 * carries no such marker and is the case that gets redirected.
 */

export type OnboardingEntry =
  /** Show the VIN form. */
  | { type: 'onboard' }
  /** Already onboarded and did not ask for this. Send them here instead. */
  | { type: 'redirect'; location: string };

export interface OnboardingEntryInput {
  /** How many vehicles the signed-in user owns. */
  vehicleCount: number;
  /** The `from` query param, if any. */
  from?: string | null;
}

/**
 * Where a signed-in visitor to `/onboard` should actually land.
 *
 * Anonymous visitors never reach this — `/onboard` is in `PROTECTED_ROUTES`,
 * so the middleware sends them to `/login` first.
 */
export function resolveOnboardingEntry({
  vehicleCount,
  from,
}: OnboardingEntryInput): OnboardingEntry {
  if (vehicleCount < 1) return { type: 'onboard' };
  if (from === 'garage') return { type: 'onboard' };

  // The garage, not `/demo`, even for someone who came from the demo: the
  // reason they are being redirected is that they have vehicles of their own.
  return { type: 'redirect', location: '/garage' };
}
