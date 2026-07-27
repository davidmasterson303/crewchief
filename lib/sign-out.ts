/**
 * The one way out of a session.
 *
 * There are two paths that end a session — the account menu and the
 * delete-account dialog — and each of them has to do the same two things:
 * drop the Supabase session, then drop everything TanStack Query is holding.
 * The second half is the one that gets forgotten. It was missing from the
 * delete-account path while the account menu had it, which is exactly the
 * shape of bug a shared helper prevents: not a wrong implementation, a
 * second implementation that fell behind the first.
 *
 * **Why this is a privacy defect and not polish.** The query client is a
 * module-level singleton (`lib/query-client.ts`) with a 30-minute `gcTime`.
 * Signing out without clearing it leaves the previous user's vehicles,
 * documents, wishlist and consultant transcripts resident in memory in that
 * tab. The next account to sign in renders from that cache before its own
 * refetch resolves — so on a shared or family machine, one person's garage is
 * briefly served to the next. Nothing about the session boundary stops it;
 * the data is already client-side.
 *
 * **`clear()` rather than targeted `removeQueries`.** There are twelve
 * distinct query keys across `app/`, `hooks/` and `components/`, and an
 * allowlist of keys-to-clear is a list someone forgets to extend when they add
 * the thirteenth. That is the same failure mode as the 63 unauthorized server
 * actions: a policy that depends on remembering. `clear()` needs no
 * maintenance and its worst case is a refetch.
 *
 * Cookie state is Supabase's own responsibility here — `signOut()` on the
 * `@supabase/ssr` browser client expires the auth cookies as well as clearing
 * local storage, which is what the plan means by "clears cookies". The
 * `router.refresh()` each caller issues afterwards is what makes the server
 * re-read the now-absent cookie.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * End the session and drop every cached query.
 *
 * The cache is cleared whether or not the Supabase call succeeds. A failed
 * round trip must not strand someone in a session they asked to leave, and it
 * certainly must not leave their data cached for the next person.
 */
export async function signOutAndClearCache(
  client: SupabaseClient,
  queryClient: QueryClient
): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {
    // Sign out locally regardless — see above.
  } finally {
    queryClient.clear();
  }
}
