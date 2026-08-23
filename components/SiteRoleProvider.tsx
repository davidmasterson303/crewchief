'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Which of the two sites this build is serving, made readable from the client.
 *
 * ── Why a provider, and why this was the blocking detail ────────────────────
 *
 * `CREWCHIEF_DEMO_SITE` is a **server** variable. `app/layout.tsx` already
 * resolves it once, and `DemoBanner` is gated on it there — that works because
 * the layout is a server component.
 *
 * The landing page is not. `app/page.tsx` carries `'use client'`, and so does
 * `LandingHero` beneath it, so neither can read the variable at all: server
 * env is not inlined into the client bundle unless it is `NEXT_PUBLIC_`, and
 * making it public to solve this would put the flag in the browser for every
 * visitor and every site.
 *
 * ⚠ **The tempting shortcut is a hostname check in the browser, and it is
 * wrong in a way that looks right.** `window.location.hostname` is undefined
 * during server rendering and hydration, so the first paint would pick a
 * default and then swap — a visible flip of the primary call to action, and a
 * hydration mismatch besides. It would also tie the copy to a hostname string
 * rather than to the deploy's own configuration, which is the coupling
 * `lib/site-role.ts` exists to avoid.
 *
 * So the value crosses the boundary the way values are supposed to: resolved
 * on the server, passed as a prop, published through context for the client
 * tree that needs it.
 *
 * ── The default direction ───────────────────────────────────────────────────
 *
 * ⚠ `false` — **unset means product**, the same direction `lib/site-role.ts`
 * takes and for the same reason. The failure that direction prevents is demo
 * framing appearing on `crewchief.davidmasterson.co`, which is the App Store
 * listing's URL. That already happened once with the masthead. The opposite
 * default fails toward "the product looks like a toy on the page Apple reads",
 * which is strictly worse than "the demo site is missing a demo label".
 */
const SiteRoleContext = createContext<boolean>(false);

export function SiteRoleProvider({
  isDemo,
  children,
}: {
  isDemo: boolean;
  children: ReactNode;
}) {
  return <SiteRoleContext.Provider value={isDemo}>{children}</SiteRoleContext.Provider>;
}

/**
 * True on the recruiter/portfolio host, false on the product host.
 *
 * Named for the question callers actually ask. A component deciding what to
 * say should not be reading an environment variable's name.
 */
export function useIsDemoSite(): boolean {
  return useContext(SiteRoleContext);
}
