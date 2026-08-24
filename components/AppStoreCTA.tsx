'use client';

import { Smartphone } from 'lucide-react';
import { isDemoSite } from '@/lib/site-role';

/**
 * Where the iOS app lives — and the honest answer while it does not live
 * anywhere yet.
 *
 * Set this to the App Store listing once the app is live. Format:
 * `https://apps.apple.com/app/id<numeric-id>`. The numeric ID is issued by App
 * Store Connect when the record is created — it exists *before* review, so this
 * can be filled in as soon as the listing is reserved rather than waiting on
 * approval.
 *
 * It lives here rather than in `lib/` on purpose: its only consumer is the
 * component below, and a one-constant module in `lib/` is a module
 * `portability.test.ts` has to classify for no benefit.
 */
export const APP_STORE_URL: string | null = null;

/** Whether the app can actually be downloaded today. */
export function appIsListed(): boolean {
  return typeof APP_STORE_URL === 'string' && APP_STORE_URL.startsWith('https://apps.apple.com/');
}

/**
 * "Get the app" — the web's primary call to action after the mobile-first
 * pivot.
 *
 * ── Two states, because one of them is the truth today ──────────────────────
 *
 * Listed: a link to the App Store.
 * Not listed: a statement that it is coming, which is not a control at all.
 *
 * The second state is the point. A disabled-looking button still reads as a
 * button and still gets pressed; a line of text that says "coming to iPhone"
 * gets read and believed. Nothing here is ever a link to nowhere.
 *
 * ── ⚠ The Apple badge artwork is not in this file, deliberately ─────────────
 *
 * Apple's marketing guidelines require the *official* "Download on the App
 * Store" badge, downloaded from their marketing resources, at or above a
 * minimum size and with defined clear space around it. Recreating it in SVG —
 * which is what a coding agent naturally reaches for — is a guidelines
 * violation and a trademark problem, and it is the sort of thing that gets
 * flagged in review rather than caught here.
 *
 * So this renders a plain typographic control now. **Before launch, drop the
 * official badge into `public/` and swap it in here.** The `lucide` glyph below
 * is a generic icon and not the Apple logo mark; it goes when the badge lands.
 *
 * ── Sizing ─────────────────────────────────────────────────────────────────
 *
 * `h-14` matches `LandingHero`'s other two CTAs so the row keeps one baseline,
 * and clears RB0 rule 3's 44px touch floor with room to spare.
 */

interface Props {
  /** `hero` is the large landing treatment; `nav` is the compact bar version. */
  variant?: 'hero' | 'nav';
  className?: string;
}

export function AppStoreCTA({ variant = 'hero', className = '' }: Props) {
  const hero = variant === 'hero';

  /*
    `whitespace-nowrap` is load-bearing, not tidiness.

    The nav variant shipped without it for about ten minutes and broke at 375
    exactly the way R3 did: "iPhone app coming soon" wrapped to two lines, the
    `h-9` box grew to contain them, and the sign-in link beside it split into
    "Sign" / "in". No horizontal overflow — the page reported `scrollWidth`
    375 — which is precisely why an overflow check would not have caught it.
    A fixed-height control next to text that can wrap is a control with a
    conditional height.
  */
  const shell = hero
    ? 'h-14 px-7 text-base gap-2.5 whitespace-nowrap'
    : 'h-9 px-4 text-sm gap-2 whitespace-nowrap';

  if (!appIsListed()) {
    /*
      ── ⚠ LEG-10 · a reviewer must not be told the app is unavailable ────────

      This renders *"iPhone app coming soon"* on `crewchief.davidmasterson.co`,
      which is the **marketing URL on the App Store listing** — the page an App
      Review reviewer opens while reviewing the binary. Reading that the iPhone
      app is *coming* while holding it is at best confusing and at worst reads
      as a premature submission.

      It is honest and it is right for the **demo**, which is a portfolio piece
      whose visitors genuinely cannot download anything yet. So the state stays
      and its audience narrows: on the product hostname the CTA renders nothing
      at all until `APP_STORE_URL` is set, and setting it turns the real link on
      everywhere at once.

      ⚠ **Nothing, rather than different words.** Every alternative — "in
      review", "launching soon", "available shortly" — is a claim about a date
      nobody controls, on the page Apple reads. Silence says nothing false.
    */
    if (!isDemoSite(process.env.NEXT_PUBLIC_SITE_ROLE)) return null;

    /*
      Not a button, not a link, no hover state, no focus ring — there is
      nothing to press. Giving it any of those would be the dead-CTA this
      component exists to avoid, dressed slightly differently.

      `text-white/70` rather than a fainter grey: `text-contrast-floor` holds
      this file to the AA body floor like any other, and 70% white on the hero
      backdrop clears it. This is live text, so no exemption applies.
    */
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-white/[0.14] bg-white/[0.04] font-medium text-white/70 ${shell} ${className}`}
      >
        <Smartphone className={hero ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
        {/*
          Two labels in the nav, one in the hero.

          Nowrap alone is not enough at 375: the full phrase is ~161px, and the
          bar also has to hold a 125px wordmark, a sign-in link and its own
          padding. Something had to give, and it is four words of copy rather
          than the sign-in link — an anonymous visitor still needs a way in.

          The hero has the whole width of the page and keeps the full sentence.
        */}
        {hero ? (
          <span>iPhone app coming soon</span>
        ) : (
          <>
            <span className="sm:hidden">Coming soon</span>
            <span className="hidden sm:inline">iPhone app coming soon</span>
          </>
        )}
      </div>
    );
  }

  return (
    <a
      href={APP_STORE_URL ?? undefined}
      className={`flex items-center justify-center rounded-xl bg-white font-semibold text-black transition-colors duration-200 hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${shell} ${className}`}
    >
      <Smartphone className={hero ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
      {hero ? (
        <span>Download for iPhone</span>
      ) : (
        <>
          <span className="sm:hidden">Get the app</span>
          <span className="hidden sm:inline">Download for iPhone</span>
        </>
      )}
    </a>
  );
}

export default AppStoreCTA;
