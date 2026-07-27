import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { countUserVehicles } from '@/lib/account-data';
import { resolveOnboardingEntry } from '@crewchief/core/onboarding';
import OnboardVinForm from './OnboardVinForm';

/**
 * `/onboard` — the returning-user guard, then the form.
 *
 * Task 1.6's third done-condition. This is a server component so the decision
 * is made before anything is sent: a client-side redirect would render the
 * onboarding form to someone who has already onboarded and then replace it,
 * which is the flash the done-condition is really about.
 *
 * The policy — why vehicle count and not the profiles row, and why an
 * explicit visit from the garage is exempt — is in `lib/onboarding.ts`.
 *
 * Anonymous visitors do not get here: `/onboard` is in `PROTECTED_ROUTES` and
 * the middleware sends them to `/login` with a redirect back.
 */
export default async function OnboardPage({
  searchParams,
}: {
  searchParams?: { from?: string };
}) {
  const vehicleCount = await countUserVehicles();
  const entry = resolveOnboardingEntry({
    vehicleCount,
    from: searchParams?.from,
  });

  if (entry.type === 'redirect') {
    redirect(entry.location);
  }

  // The form reads `from` through useSearchParams, which needs a Suspense
  // boundary above it or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <OnboardVinForm />
    </Suspense>
  );
}
