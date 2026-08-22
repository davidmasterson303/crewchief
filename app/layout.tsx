import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from 'next-themes';
import { QueryProvider } from '@/components/QueryProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import DemoBanner from '@/components/DemoBanner';
import { isDemoSite, shareDescription, siteOrigin } from '@/lib/site-role';

/** Resolved once: this build is either the demo or the product, never both. */
const IS_DEMO = isDemoSite(process.env.CREWCHIEF_DEMO_SITE);
import { AuthProvider } from '@/components/AuthProvider';
import { SiteRoleProvider } from '@/components/SiteRoleProvider';
import { INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE } from '@crewchief/core/intro-gate';

const inter = Inter({ subsets: ['latin'] });

/*
 * Newsreader — the editorial serif, exposed as --font-display.
 *
 * Loaded with a stylesheet link rather than next/font. next/font would be
 * preferable (self-hosted, no third-party request), but Next 13.5.1 has no
 * font-override metadata for Newsreader — it is a variable font with optical
 * sizing — and the build fails with "Failed to find font override values",
 * hanging compilation rather than degrading. Revisit if Next is upgraded.
 */

export const metadata: Metadata = {
  /*
     Without this, every relative URL in this object — the og:image most of all
     — resolves against `http://localhost:3000`. Not a warning and not a build
     failure: Next 13.5 substitutes localhost silently, so the deployed HTML
     has been telling every scraper to fetch the preview image from its own
     machine. That is the link David's portfolio shares, and it has never
     produced a card.

     NEXT_PUBLIC_SITE_URL lets deploy previews describe themselves rather than
     claiming to be production, which matters because a preview's card would
     otherwise point at the live site's image.

     ⚠ The fallback was the demo host as a literal, and that was right while
     there was one site. After the 17 Aug split it meant the **App Store's
     hostname served the demo's og:image and og:url** — invisible on the page,
     read by every scraper and by Apple. It is derived from the site role now,
     so each deployment claims itself.
  */
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || siteOrigin(IS_DEMO)),
  title: 'CrewChief — Your Personal Auto Ownership Consultant',
  /*
     The favicon, apple-touch-icon and SVG icon are NOT declared here — they
     are app/favicon.ico, app/icon.svg and app/apple-icon.png, served by the
     same filename convention as opengraph-image.tsx below. All of them, and
     the manifest's two PNGs, are generated from the Sweep 1024 master
     (public/brand/crewchief-icon-1024.svg); regenerate together, never
     hand-edit one.
  */
  manifest: '/manifest.json',
  description:
    'Track your vehicles, log service history, and get answers from an AI consultant that knows your car — its issues, schedule, and history.',
  /*
     Canonical, cheap insurance. `og:url` is treated as a canonicalisation hint
     by search engines, and the product site previously had no `<link rel=
     "canonical">` to outrank the demo URL it was advertising.
  */
  alternates: { canonical: '/' },
  openGraph: {
    title: 'CrewChief — Your Personal Auto Ownership Consultant',
    // Per-deployment. The product must never describe itself as a demo — see
    // `lib/site-role.ts` for why that sentence is expensive on this hostname.
    description: shareDescription(IS_DEMO),
    url: siteOrigin(IS_DEMO),
    siteName: 'CrewChief',
    /*
       No `images` key. `app/opengraph-image.tsx` is the card now, and Next
       emits its tags — absolute URL, real dimensions, correct content-type —
       from the file itself. Declaring images here as well would override it
       and put the old problem back.
    */
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap"
          rel="stylesheet"
        />
        {/*
          Decides the garage-door intro before the first paint. See
          components/GarageDoor.tsx and @crewchief/core/intro-gate.

          It has to be a blocking inline script, and the two alternatives are
          both visibly wrong. Deciding in an effect means the page paints
          first and the curtain drops *onto* it — which is exactly what the
          old GarageDoorAnimation did, with its inverted `if (!shouldRender)
          return null`. Rendering the curtain unconditionally and hiding it on
          the client means every returning visitor gets a flash of door.

          Same technique next-themes already uses two lines below to avoid a
          flash of the wrong theme, for the same reason.

          The catch is not defensive padding: sessionStorage throws outright,
          not returns null, in a partitioned or storage-blocked context. Any
          failure resolves to 'skip', so the worst case is no intro rather
          than a stuck curtain.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;try{var p=sessionStorage.getItem('${INTRO_PLAYED_KEY}')==='${INTRO_PLAYED_VALUE}';var r=window.matchMedia('(prefers-reduced-motion: reduce)').matches;d.setAttribute('data-intro',(p||r||document.hidden)?'skip':'play')}catch(e){d.setAttribute('data-intro','skip')}})()`,
          }}
        />
      </head>
      {/*
        A flex column so a page can ask for "the rest of the viewport" and get
        it. `DemoBanner` renders here, outside the route tree, and the
        consultant's app-shell (R4) was sizing itself to `100dvh` *below* that
        banner — 53px taller than the space available, so the page scrolled by
        exactly the banner's height and the shell's whole promise leaked.

        Every other page is `min-h-screen` and sizes to its content, which is
        unchanged by being a flex item.
      */}
      {/*
        `h-[100dvh]`, not `min-h-`. A `flex-1` child divides its parent's
        *definite* height, and a min-height is not definite — body grew to fit
        the thread, the thread grew to fit the messages, and the shell's
        "remaining space" resolved to all of it. The first version of this
        change did exactly that: 749px of page scroll and the composer further
        off-screen than before it was fixed.

        Ordinary pages are unaffected. They are `min-h-screen` flex items with
        the default `flex: 0 1 auto`, so content taller than the viewport
        overflows body — whose overflow is visible — and the document scrolls
        exactly as it always has.
      */}
      <body className={`${inter.className} h-[100dvh] flex flex-col`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {/*
            Resolved on the server, published to the client tree.

            `IS_DEMO` is already computed above from `CREWCHIEF_DEMO_SITE`, and
            `DemoBanner` below reads it directly because this file is a server
            component. The landing page cannot: `app/page.tsx` and
            `LandingHero` are both `'use client'`, and server env is not in the
            client bundle. See `SiteRoleProvider` for why a hostname check in
            the browser is the wrong answer.
          */}
          <SiteRoleProvider isDemo={IS_DEMO}>
          <AuthProvider>
          <QueryProvider>
            {/*
              Gated 20 Aug. This rendered unconditionally, which was right while
              there was one site and it was the demo — and wrong from the moment
              `crewchief.davidmasterson.co` became the App Store listing's URL,
              because the privacy policy Apple reads carried a "PORTFOLIO DEMO"
              masthead. Unset means product; see `lib/site-role.ts` for why that
              direction rather than the other.

              The flex column above is unaffected by its absence: the consultant
              shell takes "the rest of the viewport", and there is simply more
              of it.
            */}
            {isDemoSite(process.env.CREWCHIEF_DEMO_SITE) && <DemoBanner />}
            <ErrorBoundary context="ROOT_LAYOUT">
              {children}
            </ErrorBoundary>
            <Toaster
              theme="dark"
              toastOptions={{
                style: {
                  background: '#0f172a',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: '#f8fafc',
                  borderRadius: '12px',
                  fontSize: '14px',
                },
              }}
            />
          </QueryProvider>
          </AuthProvider>
          </SiteRoleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
