import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@crewchief/core/logger';
import {
  STORED_URL_SCHEME,
  storagePathFromStoredUrl,
  vehicleIdFromStoragePath,
} from '@crewchief/core/storage-paths';
import { isUnphotographedDemoVehicle } from '@crewchief/core/demo';

/** Matches the web's signed-URL lifetime (app/actions.ts). */
export const SIGNED_URL_TTL_SECONDS = 3600;

export interface VehiclePhotoColumns {
  image_url?: string | null;
  custom_image_url?: string | null;
}

/**
 * Turn a vehicle's stored image columns into one renderable URL.
 *
 * `custom_image_url` holds `placeholder://{vehicleId}/{kind}/{file}` — a
 * storage path in a private bucket, not a URL. The web client exchanges it for
 * a signed URL per read (`hooks/useSignedUrl.ts`). An API client handed the raw
 * column would have nothing it could render and no obvious way to find out why,
 * so the exchange happens server-side and the wire format carries a URL or
 * null — never a scheme the caller has to know about.
 *
 * Precedence matches `useVehicleImage` deliberately: the owner's photo wins
 * outright once one exists, rather than falling back to the stock image while
 * it resolves. Web and mobile disagreeing about which photo a car has would be
 * the same class of bug this codebase keeps finding — a second implementation
 * of a rule that already had one.
 *
 * Never throws and never returns a `placeholder://` value. Every failure path
 * degrades to the stock photo or to null, because the caller renders a photo
 * or it doesn't; a broken URL is worse than no URL.
 */
export async function resolveVehiclePhoto(
  vehicleId: string,
  vehicle: VehiclePhotoColumns,
  client: SupabaseClient
): Promise<string | null> {
  const plan = planVehiclePhoto(vehicleId, vehicle);

  if (plan.kind === 'resolved') return plan.url;

  try {
    const { data, error } = await client.storage
      .from('vehicle-documents')
      .createSignedUrl(plan.path, SIGNED_URL_TTL_SECONDS);

    if (error || !data) {
      logger.warn('VEHICLE_PHOTO', 'Could not sign stored photo', { vehicleId });
      return plan.fallback;
    }

    return data.signedUrl;
  } catch (error) {
    logger.warn('VEHICLE_PHOTO', 'Signing threw', { vehicleId, error });
    return plan.fallback;
  }
}

/**
 * The same rule, for a list.
 *
 * A garage is many vehicles and each stored photo needs its own signed URL.
 * Calling `resolveVehiclePhoto` in a loop costs one storage round trip per car,
 * which on a phone connection is the difference between a garage that loads and
 * one that appears broken. `createSignedUrls` takes the whole list at once.
 *
 * Deliberately *not* a second implementation of the rule: both functions decide
 * what to do via `planVehiclePhoto` and differ only in how they sign. The rule
 * about which photo a vehicle has is the thing that must never fork.
 *
 * Returns a map keyed by vehicle id. Every input id is present in the output,
 * with null where there is nothing renderable.
 */
export async function resolveVehiclePhotos(
  vehicles: Array<{ id: string } & VehiclePhotoColumns>,
  client: SupabaseClient
): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>();
  const toSign: { id: string; path: string; fallback: string | null }[] = [];

  for (const vehicle of vehicles) {
    const plan = planVehiclePhoto(vehicle.id, vehicle);
    if (plan.kind === 'resolved') resolved.set(vehicle.id, plan.url);
    else toSign.push({ id: vehicle.id, path: plan.path, fallback: plan.fallback });
  }

  if (toSign.length === 0) return resolved;

  try {
    const { data, error } = await client.storage
      .from('vehicle-documents')
      .createSignedUrls(
        toSign.map((entry) => entry.path),
        SIGNED_URL_TTL_SECONDS
      );

    if (error || !data) {
      logger.warn('VEHICLE_PHOTO', 'Could not batch-sign stored photos', {
        count: toSign.length,
      });
      for (const entry of toSign) resolved.set(entry.id, entry.fallback);
      return resolved;
    }

    /*
      Positional, because that is the correspondence the API guarantees: results
      come back in request order. Matching on the returned `path` instead would
      break on two vehicles pointing at the same object, which is rare but is
      exactly the case a lookup-by-key would silently collapse.
    */
    toSign.forEach((entry, index) => {
      const signed = data[index];
      resolved.set(entry.id, signed?.signedUrl && !signed.error ? signed.signedUrl : entry.fallback);
    });

    return resolved;
  } catch (error) {
    logger.warn('VEHICLE_PHOTO', 'Batch signing threw', { error });
    for (const entry of toSign) resolved.set(entry.id, entry.fallback);
    return resolved;
  }
}

type PhotoPlan =
  | { kind: 'resolved'; url: string | null }
  | { kind: 'sign'; path: string; fallback: string | null };

/**
 * Decide what a vehicle's photo should be, without doing any I/O.
 *
 * Pure, so the rule can be tested directly instead of through a storage mock —
 * and so the single and batch resolvers above cannot drift apart.
 */
function planVehiclePhoto(vehicleId: string, vehicle: VehiclePhotoColumns): PhotoPlan {
  // One demo car is unphotographed on purpose and still carries a seeded
  // image_url; honoured here so every surface answers the same way.
  if (isUnphotographedDemoVehicle(vehicleId)) return { kind: 'resolved', url: null };

  const storedPath = storagePathFromStoredUrl(vehicle.custom_image_url);

  if (!storedPath) {
    /*
      Not a resolvable stored path — but "not resolvable" and "not ours" are
      different, and conflating them is how the scheme leaks. A malformed
      value that still carries the prefix (`placeholder://` with an empty
      path, which storagePathFromStoredUrl reports as null) must not be passed
      through as though it were a renderable URL. Caught by the contract test
      rather than by reasoning, which is the point of having one.
    */
    const isMalformedStored = vehicle.custom_image_url?.startsWith(STORED_URL_SCHEME);
    const passthrough = isMalformedStored ? null : vehicle.custom_image_url;

    return { kind: 'resolved', url: passthrough || vehicle.image_url || null };
  }

  /*
    Ownership was proven for `vehicleId`, not for whatever this column happens
    to point at. A signed URL bypasses RLS for its lifetime, so a row whose
    custom_image_url referenced another vehicle's object would otherwise get
    that object signed under this vehicle's authorization. Cheap to check, and
    it is the only thing standing between a column value and a credential.
  */
  if (vehicleIdFromStoragePath(storedPath) !== vehicleId) {
    logger.warn('VEHICLE_PHOTO', 'Stored photo path is not scoped to this vehicle', {
      vehicleId,
    });
    return { kind: 'resolved', url: vehicle.image_url || null };
  }

  return { kind: 'sign', path: storedPath, fallback: vehicle.image_url || null };
}
