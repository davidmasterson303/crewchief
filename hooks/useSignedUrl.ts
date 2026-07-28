'use client';

import { useQuery } from '@tanstack/react-query';
import { getSignedStorageUrl } from '@/app/actions';
import { storagePathFromStoredUrl } from '@crewchief/core/storage-paths';

/**
 * The client half of the private-bucket convention.
 *
 * Columns that used to hold a URL now hold a storage path (`storedUrl` in
 * `@crewchief/core/storage-paths`). Nothing renderable can be persisted: a
 * public URL never resolves against a private bucket, and a signed one
 * expires. So the exchange happens per read, here.
 *
 * ── Why a query and not a `useEffect` ───────────────────────────────────────
 *
 * The garage renders one card per vehicle, each holding its own photo URL.
 * With an effect that is N server round trips per mount and N more on every
 * remount. React Query keys the exchange on the stored URL, so the cache is
 * shared across cards and survives navigation between the garage and a
 * dashboard — the same photo is signed once, not once per component.
 *
 * `staleTime` is deliberately well under the hour a signed URL lives. A cached
 * entry handed out at 55 minutes would be technically fresh and about to break
 * in the user's hands; refreshing at 30 leaves the whole second half of the
 * window as slack.
 */
const SIGNED_URL_STALE_MS = 30 * 60 * 1000;

/**
 * Resolve a stored URL for rendering.
 *
 * Returns:
 *   - the input unchanged, if it is not a stored path (demo `/vehicles/…`
 *     assets, external image URLs, and `null`/`undefined` pass straight
 *     through — no request is made);
 *   - `undefined` while a stored path is being signed, and if signing fails.
 *
 * Pending and failed collapse into `undefined` on purpose. Call sites render a
 * photo or they don't; there is no third state a broken `<img>` improves on,
 * and the alternative — showing a fallback for the ~200ms before the real
 * photo arrives — is a visible swap on every page load.
 */
export function useSignedUrl(url: string | null | undefined): string | undefined {
  const isStored = storagePathFromStoredUrl(url) !== null;

  const { data } = useQuery({
    queryKey: ['signed-url', url],
    enabled: isStored,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_STALE_MS,
    // A failure here is an authorization answer far more often than a network
    // blip — the caller does not own the vehicle, or the object is gone.
    // Retrying re-asks a question already answered.
    retry: false,
    queryFn: async () => {
      const result = await getSignedStorageUrl(url as string);
      if (!result.success || !result.url) {
        throw new Error(result.error || 'Could not sign storage URL');
      }
      return result.url;
    },
  });

  if (!isStored) return url ?? undefined;
  return data;
}

interface VehicleImageFields {
  /** The owner's uploaded photo, stored as a path. */
  custom_image_url?: string | null;
  /** The stock photo — a local `/vehicles/…` asset, already renderable. */
  image_url?: string | null;
}

/**
 * The photograph to render for a vehicle, resolved and ready for an `<img>`.
 *
 * Every surface that shows a car was writing `custom_image_url || image_url`
 * inline. That expression is now wrong in two ways at once — the first operand
 * needs signing, and the `||` picks the stock photo during the moment the
 * owner's is still resolving, producing a visible swap from a stranger's car
 * to theirs on every load. So the precedence rule lives here instead: an owner
 * photo, once one exists, is the only thing that surface will ever show.
 *
 * Accepts a nullable vehicle so callers can satisfy the rules of hooks before
 * their loading and error branches.
 */
export function useVehicleImage(
  vehicle: VehicleImageFields | null | undefined
): string | undefined {
  const signed = useSignedUrl(vehicle?.custom_image_url);

  if (vehicle?.custom_image_url) return signed;
  return vehicle?.image_url ?? undefined;
}
