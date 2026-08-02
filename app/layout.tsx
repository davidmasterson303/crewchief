import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from 'next-themes';
import { QueryProvider } from '@/components/QueryProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import DemoBanner from '@/components/DemoBanner';
import { AuthProvider } from '@/components/AuthProvider';
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
     otherwise point at the live site's image. The literal is the fallback so
     production is right whether or not the variable is set — an unset
     variable degrades to "correct for prod", never back to localhost.
  */
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'https://crewchief-demo.davidmasterson.co'
  ),
  title: 'CrewChief — Your Personal Auto Ownership Consultant',
  description:
    'Track your vehicles, log service history, and get answers from an AI consultant that knows your car — its issues, schedule, and history.',
  openGraph: {
    title: 'CrewChief — Your Personal Auto Ownership Consultant',
    description:
      'An AI consultant that knows your car. Live demo with sample vehicles — no signup required.',
    url: 'https://crewchief-demo.davidmasterson.co',
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
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <AuthProvider>
          <QueryProvider>
            <DemoBanner />
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
        </ThemeProvider>
      </body>
    </html>
  );
}
