import { notFound } from 'next/navigation';

/**
 * Nothing under `/dev` exists in production.
 *
 * ── ⚠ The defect this replaces (SEC-10, 24 Aug) ─────────────────────────────
 *
 * `app/dev/rls-check/page.tsx` is a **Client Component** — `'use client'` on
 * line 1 — and its guard was:
 *
 *     if (process.env.NODE_ENV === 'production') notFound();
 *
 * inside that component. In a client bundle that runs in the **browser**, after
 * the page has already been served, and `process.env.NODE_ENV` is inlined at
 * build time into a value the server never consults. So the route returned
 * **200 in production** while `/dev/funnel` — a Server Component with the
 * identical line — correctly 404'd. Two files, the same guard, opposite
 * behaviour, and nothing said why.
 *
 * `/dev/vehicle-illustrations` had no gate at all.
 *
 * ── Why a layout, and why it is the only correct place ──────────────────────
 *
 * A layout is a **Server Component by default** and it runs before any page
 * beneath it renders — including client ones, whose own guards run too late by
 * construction. Putting the check here means:
 *
 *   - it cannot be forgotten on a new dev route, because there is nothing to
 *     remember;
 *   - it cannot be defeated by a page adding `'use client'`, which is exactly
 *     how `rls-check` came to be open;
 *   - there is **one** copy of the rule, so the two spellings cannot drift.
 *
 * The per-page guards below it stay. They are harmless, they document intent at
 * the file somebody is reading, and defence in depth on a route that lists RLS
 * probe results is cheap.
 *
 * ── What was actually exposed ───────────────────────────────────────────────
 *
 * `/dev/rls-check` renders the result of eight live RLS probes — which tables
 * an anonymous browser can read — on `crewchief.davidmasterson.co`, the
 * hostname **Apple's reviewer opens**. There was also no `robots.txt`, so it
 * was crawlable. `app/robots.ts` now excludes it, and this is what makes the
 * exclusion true rather than a request.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  /*
    ⚠ `NODE_ENV`, not a bespoke flag. Netlify sets it to `production` for every
    deployed build of both sites, and a custom variable would be one more thing
    that has to be set correctly on two Netlify projects — which CLAUDE.md §7
    records going wrong before, in both places it can.
  */
  if (process.env.NODE_ENV === 'production') notFound();

  return <>{children}</>;
}
