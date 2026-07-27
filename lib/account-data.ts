import { getServiceRoleClient } from '@/lib/supabase';
import { requireSession } from '@/lib/api-auth';
import { vehicleStoragePrefixes } from '@/lib/storage-paths';
import { logger } from '@/lib/logger';

const DOCUMENTS_BUCKET = 'vehicle-documents';

/**
 * Account data export and deletion.
 *
 * Deletion satisfies App Store Guideline 5.1.1(v), which requires an in-app
 * path that removes the account itself — not a deactivation flag, not an
 * email-support workflow, and available to every user regardless of region.
 *
 * The ordering in `deleteAccount` is the whole problem. See the comment there
 * before changing anything.
 */

// ---------------------------------------------------------------------------
// Inventory — shared by export and deletion
// ---------------------------------------------------------------------------

/**
 * Every table holding data for a user, and how to reach it from their id.
 *
 * Export and deletion read the same list on purpose: if a table is missing
 * here, the export is incomplete AND the deletion audit is wrong, and the two
 * are far more likely to be noticed together than apart.
 *
 * Only `vehicles` carries a user_id. Everything else hangs off vehicle_id.
 */
const VEHICLE_SCOPED_TABLES = [
  'vehicle_knowledge_base',
  'vehicle_health_summary',
  'vehicle_health_history',
  'nhtsa_data',
  'service_items',
  'maintenance_line_items',
  'invoice_line_items',
  'vehicle_documents',
  'wishlist_items',
  'modification_tracking',
  'modification_details',
  'known_issue_tracking',
  'consultant_conversations',
  'consultant_documents',
  'quote_requests',
  'labor_bundles',
  'maintenance_dismissals',
  'recall_actions',
] as const;

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_storage_path: string | null;
  distance_unit: 'mi' | 'km';
  currency: string;
  notification_preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Fields a user is allowed to change. Deliberately not the whole row. */
export interface ProfileUpdate {
  display_name?: string | null;
  distance_unit?: 'mi' | 'km';
  currency?: string;
  notification_preferences?: Record<string, unknown>;
}

/**
 * How many vehicles the signed-in user owns.
 *
 * `head: true` with an exact count — the rows themselves are never needed,
 * only whether there are any. Used by the `/onboard` guard, which runs on
 * every visit to that route and should not pull a garage's worth of columns
 * to answer a yes/no question.
 *
 * Returns 0 for a caller with no session. That is the safe direction: an
 * unauthenticated visitor never reaches `/onboard` anyway (the middleware
 * redirects first), and if one somehow did, showing onboarding is better than
 * bouncing them somewhere on the strength of a count we could not read.
 */
export async function countUserVehicles(): Promise<number> {
  const session = await requireSession();
  if (!session.ok) return 0;

  const client = getServiceRoleClient();
  const { count, error } = await client
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (error) {
    logger.error('ONBOARD:VEHICLE_COUNT', new Error(error.message), {
      userId: session.userId,
    });
    return 0;
  }

  return count ?? 0;
}

export async function getProfile() {
  const session = await requireSession();
  if (!session.ok) {
    return { success: false, error: session.error, profile: null };
  }

  const client = getServiceRoleClient();

  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', session.userId)
    .maybeSingle();

  if (error) {
    logger.error('PROFILE:READ', new Error(error.message), { userId: session.userId });
    return { success: false, error: 'Failed to load profile', profile: null, vehicleCount: 0 };
  }

  // Returned alongside the profile so the delete confirmation can state what
  // will actually be destroyed without the settings page making a second
  // round trip, or worse, only knowing after an export has been run.
  const { count } = await client
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  return {
    success: true,
    profile: (data as Profile) ?? null,
    vehicleCount: count ?? 0,
  };
}

export async function updateProfile(updates: ProfileUpdate) {
  const session = await requireSession();
  if (!session.ok) {
    return { success: false, error: session.error };
  }

  // Allowlist rather than spreading the caller's object: a server action
  // takes whatever the client sends, so passing it straight through would
  // let someone rewrite id or created_at.
  const patch: ProfileUpdate = {};
  if ('display_name' in updates) patch.display_name = updates.display_name?.trim() || null;
  if ('distance_unit' in updates) patch.distance_unit = updates.distance_unit;
  if ('currency' in updates) patch.currency = updates.currency;
  if ('notification_preferences' in updates) {
    patch.notification_preferences = updates.notification_preferences;
  }

  if (patch.distance_unit && !['mi', 'km'].includes(patch.distance_unit)) {
    return { success: false, error: 'Invalid distance unit' };
  }

  const { error } = await getServiceRoleClient()
    .from('profiles')
    .update(patch)
    .eq('id', session.userId);

  if (error) {
    logger.error('PROFILE:UPDATE', new Error(error.message), { userId: session.userId });
    return { success: false, error: 'Failed to save changes' };
  }

  return { success: true };
}

/**
 * Export everything belonging to the caller as one JSON document.
 *
 * Deliberately built before deletion: it is the practical way to verify the
 * table inventory is complete, and each acts as a check on the other.
 */
export async function exportAccountData() {
  const session = await requireSession();
  if (!session.ok) {
    return { success: false, error: session.error };
  }

  const client = getServiceRoleClient();
  const userId = session.userId;

  try {
    const { data: profile } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const { data: vehicles, error: vehiclesError } = await client
      .from('vehicles')
      .select('*')
      .eq('user_id', userId);

    if (vehiclesError) {
      logger.error('ACCOUNT_EXPORT:VEHICLES', new Error(vehiclesError.message), { userId });
      return { success: false, error: 'Failed to read vehicles' };
    }

    const vehicleIds = (vehicles ?? []).map((v) => v.id);
    const related: Record<string, unknown[]> = {};

    if (vehicleIds.length > 0) {
      for (const table of VEHICLE_SCOPED_TABLES) {
        const { data, error } = await client
          .from(table)
          .select('*')
          .in('vehicle_id', vehicleIds);

        if (error) {
          logger.warn('ACCOUNT_EXPORT:TABLE_FAILED', 'Table read failed', {
            table,
            message: error.message,
          });
          continue;
        }
        related[table] = data ?? [];
      }
    }

    return {
      success: true,
      data: {
        exported_at: new Date().toISOString(),
        user_id: userId,
        profile: profile ?? null,
        vehicles: vehicles ?? [],
        ...related,
      },
    };
  } catch (error) {
    logger.error('ACCOUNT_EXPORT:EXCEPTION', error as Error, { userId });
    return { success: false, error: 'Failed to export account data' };
  }
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Prefixes under which a vehicle's files can live.
 *
 * The prefixes come from `lib/storage-paths.ts`, which is the module that
 * writes them. This file used to carry its own identical copy — two
 * definitions of where a user's data lives, which is the arrangement that
 * makes a deletion sweep quietly stop matching the uploader.
 */

/**
 * List every object under a prefix, descending into subfolders.
 *
 * Supabase's list() returns one level at a time, and consultant documents sit
 * two levels deep (`consultant-docs/{vehicleId}/{sessionId}/{file}`). A
 * single-level list silently returns the session folders as if they were
 * files, so nothing gets removed and nothing reports an error.
 */
async function listObjectsRecursive(
  client: ReturnType<typeof getServiceRoleClient>,
  prefix: string,
  depth = 0
): Promise<{ paths: string[]; failures: string[] }> {
  // Guard against a pathological tree; real paths are at most 3 deep.
  if (depth > 4) return { paths: [], failures: [] };

  const { data: entries, error } = await client.storage
    .from(DOCUMENTS_BUCKET)
    .list(prefix, { limit: 1000 });

  if (error) return { paths: [], failures: [`${prefix}: ${error.message}`] };
  if (!entries || entries.length === 0) return { paths: [], failures: [] };

  const paths: string[] = [];
  const failures: string[] = [];

  for (const entry of entries) {
    const full = `${prefix}/${entry.name}`;
    // Supabase marks folders by returning a null id.
    if (entry.id === null) {
      const nested = await listObjectsRecursive(client, full, depth + 1);
      paths.push(...nested.paths);
      failures.push(...nested.failures);
    } else {
      paths.push(full);
    }
  }

  return { paths, failures };
}

/**
 * Remove every storage object belonging to a set of vehicles.
 *
 * Was previously a single-level list of `{vehicleId}/` only, which missed
 * vehicle photos and consultant documents entirely — they survived account
 * deletion as orphaned blobs holding exactly the personal data the user asked
 * to have removed. The unit tests did not catch it because they mocked
 * storage with one flat convention.
 */
async function purgeVehicleStorage(
  client: ReturnType<typeof getServiceRoleClient>,
  vehicleIds: string[]
): Promise<{ removed: number; failures: string[] }> {
  let removed = 0;
  const failures: string[] = [];

  for (const vehicleId of vehicleIds) {
    for (const prefix of vehicleStoragePrefixes(vehicleId)) {
      const { paths, failures: listFailures } = await listObjectsRecursive(client, prefix);
      failures.push(...listFailures);
      if (paths.length === 0) continue;

      const { error: removeError } = await client.storage
        .from(DOCUMENTS_BUCKET)
        .remove(paths);

      if (removeError) {
        failures.push(`${prefix}: ${removeError.message}`);
        continue;
      }
      removed += paths.length;
    }
  }

  return { removed, failures };
}

/**
 * Permanently delete the caller's account and all associated data.
 *
 * ORDER IS LOAD-BEARING — do not reorder:
 *
 *   1. Resolve the user's vehicle ids.
 *   2. Purge storage objects, which have NO foreign key to anything. They are
 *      untouched by the database cascade, so once step 3 runs their paths are
 *      unrecoverable and the files are orphaned in the bucket forever.
 *   3. Delete the auth user. `vehicles.user_id` cascades from `auth.users`,
 *      and every child table cascades from `vehicle_id`, so the entire
 *      relational footprint goes with it — including the profile row.
 *
 * If the storage purge partially fails we still proceed, and report it. The
 * user asked to be deleted; leaving the account alive because a blob could
 * not be removed is the wrong trade. The failures are logged so orphans can
 * be swept later.
 */
export async function deleteAccount() {
  const session = await requireSession();
  if (!session.ok) {
    return { success: false, error: session.error };
  }

  const userId = session.userId;
  const client = getServiceRoleClient();

  try {
    // ---- 1. inventory, while it is still reachable -------------------------
    const { data: vehicles, error: vehiclesError } = await client
      .from('vehicles')
      .select('id')
      .eq('user_id', userId);

    if (vehiclesError) {
      logger.error('ACCOUNT_DELETE:INVENTORY', new Error(vehiclesError.message), { userId });
      return { success: false, error: 'Could not read account contents. Nothing was deleted.' };
    }

    const vehicleIds = (vehicles ?? []).map((v) => v.id);

    // ---- 2. storage first --------------------------------------------------
    const purge = await purgeVehicleStorage(client, vehicleIds);
    if (purge.failures.length > 0) {
      logger.error('ACCOUNT_DELETE:STORAGE_PARTIAL', new Error('Some objects survived'), {
        userId,
        failures: purge.failures,
      });
    }

    // ---- 3. the cascade ----------------------------------------------------
    const { error: deleteError } = await client.auth.admin.deleteUser(userId);

    if (deleteError) {
      logger.error('ACCOUNT_DELETE:AUTH_USER', new Error(deleteError.message), { userId });
      return {
        success: false,
        error: 'Could not delete the account. Please try again.',
      };
    }

    // Tombstone for our own audit trail. Deliberately carries no personal
    // data — an id and counts, nothing that would defeat the deletion.
    logger.info('ACCOUNT_DELETE:COMPLETE', 'Account deleted', {
      userId,
      vehiclesDeleted: vehicleIds.length,
      storageObjectsRemoved: purge.removed,
      storageFailures: purge.failures.length,
    });

    /*
      The gap this used to warn about is closed.

      `uploadInvoiceForCompletion` wrote to `invoices/{file}` with no vehicle
      or user in the path, so those objects could not be attributed to an
      account and could not be purged with it — a real hole in the deletion
      guarantee the privacy policy makes. Task 0.3 moved all four upload sites
      onto `vehicleStoragePath`, so every object written now begins with a
      vehicle id and is reachable by the sweep above.

      Confirmed 27 Jul against the live bucket: `vehicle-documents` holds zero
      objects, so no legacy unattributable blobs survive from before the
      unification either. The warning that stood here was describing a state
      that no longer existed, which is worse than no warning — it would have
      kept the privacy policy unpublished on stale evidence.

      What would reopen it: any new `.upload()` call that does not build its
      path with `vehicleStoragePath`. `lib/__tests__/storage-paths.test.ts`
      covers the builder; the sweep depends on every writer using it.
    */

    return {
      success: true,
      deleted: {
        vehicles: vehicleIds.length,
        storageObjects: purge.removed,
      },
    };
  } catch (error) {
    logger.error('ACCOUNT_DELETE:EXCEPTION', error as Error, { userId });
    return { success: false, error: 'Could not delete the account. Please try again.' };
  }
}
