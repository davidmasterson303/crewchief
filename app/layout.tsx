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
