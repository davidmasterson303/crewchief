'use client';

import { useAuth } from '@/components/AuthProvider';
import { DEMO_GARAGE_ROUTE, SIGNED_IN_HOME } from '@wellkept/core/routes';

/**
 * Where the Well Kept mark should take you.
 *
 * Every nav in the app pointed its logo at `/`, which is the demo garage. For a
 * signed-in user that meant the most obvious control on the screen led out of
 * their own garage and into three cars belonging to nobody — and because the two
 * surfaces look alike, it read as their vehicles having disappeared. The
 * "Garage" breadcrumb on every vehicle page did the same thing under a label
 * that actively promised otherwise.
 *
 * `AuthProvider` redirects a signed-in user off `/` regardless, so this is not
 * what makes the separation correct — it is what makes it feel deliberate rather
 * than like a bounce. A link should go where it says it goes the first time.
 *
 * While the session is resolving this returns the demo route, because anonymous
 * is the common case on the public pages this appears on and a wrong href for a
 * few hundred milliseconds costs nothing: the redirect still catches it.
 */
export function useHomeHref(): string {
  const { user, loading } = useAuth();
  return !loading && user ? SIGNED_IN_HOME : DEMO_GARAGE_ROUTE;
}
