import {
  VISITOR_COOKIE,
  decideVisitor,
  formatVisitorId,
  isPrefetchRequest,
  isRecordableVisitorId,
  visitorCookieOptions,
} from '@wellkept/core/funnel';

/**
 * Reading and issuing the anonymous visitor id.
 *
 * Phase 2.97d. Glue only — every decision is in `packages/core/src/funnel.ts`
 * and is tested there. This module exists because that one may not import
 * `next/headers` or `node:crypto`, and is the same split as `lib/ai-usage.ts`
 * against `packages/core/src/ai/usage.ts`.
 *
 * ── Why issuing has to happen in middleware ─────────────────────────────────
 *
 * `cookies()` from `next/headers` is **read-only during a Server Component
 * render** on Next 13.5. Calling `.set()` there throws. So the id cannot be
 * minted by the page that needs it, and the two halves below are not stylistic:
 *
 *   `readVisitorId()`     server actions and server components — read only
 *   `resolveVisitor()`    middleware — read, and decide whether to issue
 *
 * The alternative was a client component firing a server action on mount, which
 * costs a round trip before `landed` can be recorded and loses every visitor
 * who leaves inside it — precisely the visitors the bounce number is about.
 */

/**
 * The visitor id on the current request, or `null`.
 *
 * For server actions and server components: read-only, and it never issues.
 * `null` means the event is not recordable, which `recordFunnelStep` already
 * treats as a drop — see the note there about why a step that cannot be joined
 * is worse than a missing one.
 */
export function readVisitorId(): string | null {
  try {
    const { cookies } = require('next/headers');
    const value = cookies().get(VISITOR_COOKIE)?.value;
    return isRecordableVisitorId(value) ? value : null;
  } catch {
    /*
      `cookies()` throws outside a request scope. Returning null rather than
      propagating keeps the fire-and-forget contract intact all the way up: no
      instrumentation call may turn a working answer into an error.
    */
    return null;
  }
}

/**
 * Decide this request's visitor id, for middleware.
 *
 * Pure apart from the id it mints — the caller writes the cookie, because only
 * the caller holds the response. Returns `issue: true` with the id to set.
 *
 * `crypto.randomUUID` rather than `node:crypto`: middleware runs on the Edge
 * runtime, where the Web Crypto global is available and the Node built-in is
 * not.
 */
export function resolveVisitor(request: {
  cookies: { get(name: string): { value: string } | undefined };
  headers: { get(name: string): string | null };
}) {
  return decideVisitor({
    existing: request.cookies.get(VISITOR_COOKIE)?.value,
    prefetch: isPrefetchRequest((name) => request.headers.get(name)),
    newId: formatVisitorId(crypto.randomUUID()),
  });
}

export { VISITOR_COOKIE, visitorCookieOptions };
