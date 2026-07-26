import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from 'next-themes';
import { QueryProvider } from '@/components/QueryProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import DemoBanner from '@/components/DemoBanner';
import { AuthProvider } from '@/components/AuthProvider';

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
  title: 'CrewChief — Your Personal Auto Ownership Consultant',
  description:
    'Track your vehicles, log service history, and get answers from an AI consultant that knows your car — its issues, schedule, and history.',
  openGraph: {
    title: 'CrewChief — Your Personal Auto Ownership Consultant',
    description:
      'An AI consultant that knows your car. Live demo with sample vehicles — no signup required.',
    url: 'https://crewchief-demo.davidmasterson.co',
    siteName: 'CrewChief',
    images: [{ url: '/dark-roomb.jpeg', width: 1920, height: 1280 }],
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
