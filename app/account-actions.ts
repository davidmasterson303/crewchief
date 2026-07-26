'use server';

/**
 * Server-action surface for account data export and deletion.
 *
 * The implementation lives in `lib/account-data.ts` as a plain module so it
 * can be unit tested: jest's SWC transform does not inherit the
 * `experimental.serverActions` flag from next.config.js, so a file marked
 * 'use server' cannot be imported by a test at all.
 *
 * Same shape as `middleware.ts` — the logic is testable, the framework
 * boundary is a thin wrapper over it.
 */

export { exportAccountData, deleteAccount } from '@/lib/account-data';
