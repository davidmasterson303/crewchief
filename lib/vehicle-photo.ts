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
  // One demo car is unphotographed on purpose and still carries a seeded
  // image_url; honoured here so every surface answers the same way.
  if (isUnphotographedDemoVehicle(vehicleId)) return null;

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

    return passthrough || vehicle.image_url || null;
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
    return vehicle.image_url || null;
  }

  try {
    const { data, error } = await client.storage
      .from('vehicle-documents')
      .createSignedUrl(storedPath, SIGNED_URL_TTL_SECONDS);

    if (error || !data) {
      logger.warn('VEHICLE_PHOTO', 'Could not sign stored photo', { vehicleId });
      return vehicle.image_url || null;
    }

    return data.signedUrl;
  } catch (error) {
    logger.warn('VEHICLE_PHOTO', 'Signing threw', { vehicleId, error });
    return vehicle.image_url || null;
  }
}
