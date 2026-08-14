import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import Logo from '@/components/brand/Logo';
import { LAST_UPDATED } from '@/lib/legal';

/**
 * The shell both legal documents sit in.
 *
 * ── Why these read differently to the rest of the app ───────────────────────
 *
 * Every other surface is dark, dense and built for glancing. These are the two
 * pages somebody reads in full, slowly, usually because they are deciding
 * whether to trust the product with a photograph of their driveway. So the
 * measure is narrow, the line height is loose, and there is nothing in the
 * margin competing for attention.
 *
 * `cc-marketing-0001` — plain and direct — governs the words. It applies here
 * more than anywhere: a privacy policy written in the register of a privacy
 * policy is one nobody finishes, and an unread policy is not consent.
 *
 * ── The date is shown, deliberately ─────────────────────────────────────────
 *
 * A legal page with no date cannot be checked against anything. Showing it
 * invites the reader to notice when it last moved, which is the point.
 */
export default function LegalDocument({
  title,
  summary,
  children,
}: {
  title: string;
  /** One sentence, in plain words, before any of the formal text. */
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen service-bay service-bay-dim">
      <div className="mx-auto w-full max-w-2xl px-5 py-14">
        <Link href="/" className="inline-flex mb-10" aria-label="CrewChief home">
          <Logo variant="stacked" size={52} />
        </Link>

        <h1 className="text-3xl font-bold text-white mb-3">{title}</h1>

        <p className="text-white/70 text-base leading-relaxed mb-2">{summary}</p>

        {/*
          The first draft set this date below the contrast floor and the scan
          caught it. It was right twice over: this is the one line on the page a
          reader checks deliberately, and it was already the smallest type on
          it. Quiet was the wrong instinct for a date whose whole job is to be
          verifiable.
        */}
        <p className="text-white/55 text-xs mb-10">Last updated {LAST_UPDATED}</p>

        {/*
          Spacing lives here rather than on every heading and paragraph in the
          two documents, so the rhythm cannot drift between them.
        */}
        <div className="legal-prose text-white/65 text-[15px] leading-7 space-y-5">
          {children}
        </div>

        <div className="mt-14 pt-8 border-t border-white/10">
          <Link
            href="/"
            className="inline-flex items-center text-white/50 hover:text-white/80 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
            Back to CrewChief
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A section heading, so the two documents cannot style theirs differently. */
export function LegalSection({ children }: { children: React.ReactNode }) {
  return <h2 className="text-white font-semibold text-lg pt-6">{children}</h2>;
}
