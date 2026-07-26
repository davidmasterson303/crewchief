'use server';

import * as account from '@/lib/account-data';
import type { ProfileUpdate } from '@/lib/account-data';

/**
 * Server-action surface for profile, data export and account deletion.
 *
 * The implementation lives in `lib/account-data.ts` as a plain module so it
 * can be unit tested: jest's SWC transform does not inherit the
 * `experimental.serverActions` flag from next.config.js, so a file marked
 * 'use server' cannot be imported by a test at all.
 *
 * These are explicit async wrappers rather than `export { … } from`. A
 * 'use server' file may only export async *function declarations* — a
 * re-export typechecks cleanly and then fails at build time with "Only async
 * functions are allowed to be exported in a 'use server' file", which does
 * not surface until the route is actually rendered.
 *
 * Same shape as `middleware.ts`: testable logic, thin framework boundary.
 */

export async function getProfile() {
  return account.getProfile();
}

export async function updateProfile(updates: ProfileUpdate) {
  return account.updateProfile(updates);
}

export async function exportAccountData() {
  return account.exportAccountData();
}

export async function deleteAccount() {
  return account.deleteAccount();
}
