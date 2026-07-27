/**
 * The demo-mode cookie — browser only.
 *
 * Split out of `lib/demo.ts` for Phase 2.4. These three functions were the
 * only reason that module touched `document`, and because `lib/routes.ts`
 * imports it and `lib/auth-session.ts` imports routes, three modules were
 * pinned to the browser by one cookie. Separating them frees all three for the
 * shared package — see `lib/__tests__/portability.test.ts`.
 *
 * Nothing here is portable and nothing here should become portable. A React
 * Native client has no cookie jar; it signals demo intent some other way, and
 * `isDemoVehicleId` in `lib/demo.ts` is the check that matters on the server
 * regardless.
 *
 * The guards are real rather than defensive noise: these are called from
 * client components that Next also renders on the server.
 */

import { DEMO_COOKIE } from '@/lib/demo';

export function setDemoMode(): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${DEMO_COOKIE}=1; path=/; max-age=86400; SameSite=Lax`;
  }
}

export function clearDemoMode(): void {
  if (typeof document !== 'undefined') {
    document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0`;
  }
}

export function isDemoMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${DEMO_COOKIE}=1`));
}
