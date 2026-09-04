'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A dashboard section that can be folded away, and remembers that it was.
 *
 * The dashboard grew by stacking: hero, recalls, research status, health
 * report, health history, dossier, wishlist — every one of them expanded, all
 * of the time, on a screen whose first job is to tell you whether the car needs
 * attention. Most of that is reference material you consult occasionally and
 * scroll past constantly.
 *
 * Three things this deliberately does:
 *
 *   - **Remembers per section and per vehicle.** Collapsing the dossier on one
 *     car should not collapse it on another, and it certainly should not come
 *     back open on every navigation. Keyed storage: `localStorage`, read in a
 *     lazy initialiser, with writes wrapped in try/catch because storage can be
 *     unavailable outright — Safari private browsing throws on `setItem`.
 *   - **Renders children only when open.** These sections mount charts, run
 *     count-up animations and fire queries; keeping a collapsed one mounted
 *     would pay for work nobody asked to see. The trade is that expanding is a
 *     fresh mount rather than an instant reveal, which is the right way round.
 *   - **Says what is inside when closed.** A collapsed section with only a title
 *     is a mystery box. `summary` is the one line that survives folding — a
 *     score, a count, "3 open items" — so the fold still carries information.
 */

interface CollapsibleSectionProps {
  title: string;
  /** Stable key for the persisted open/closed state. Include the vehicle. */
  storageKey: string;
  /** Whether this starts open the *first* time, before any stored preference. */
  defaultOpen?: boolean;
  /** One line that stays visible when collapsed. Keep it short. */
  summary?: ReactNode;
  /**
   * DOM id, so something elsewhere on the page can link to this section.
   *
   * ⚠ Giving it an id also makes it open when the hash names it — see the
   * effect below. A link that scrolls someone to a collapsed drawer is a link
   * that did not work, and the stored preference means collapsed is the state
   * a returning reader is most likely to be in.
   */
  anchorId?: string;
  /** Rendered only while open — see the note above about mounting cost. */
  children: ReactNode;
}

function storedOpenState(key: string): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : raw === 'true';
  } catch (_) {
    return null;
  }
}

export default function CollapsibleSection({
  title,
  storageKey,
  defaultOpen = true,
  summary,
  anchorId,
  children,
}: CollapsibleSectionProps) {
  /*
    Starts from `defaultOpen` on both server and client so hydration matches,
    then adopts the stored preference in an effect. Reading storage in the
    initialiser would render different markup on the client than the server sent
    for anyone who had ever collapsed the section.
  */
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  useEffect(() => {
    const stored = storedOpenState(storageKey);
    if (stored !== null) setOpen(stored);
  }, [storageKey]);

  /*
    ── Being linked to opens the section ─────────────────────────────────────

    `#health-report` in the URL is a request to read the health report, and
    honouring the scroll while leaving the panel shut answers it with a closed
    drawer. The hero's "What's driving this score" link is exactly that case.

    ⚠ Ordered after the effect above deliberately: both run on mount, and this
    one has to win. A reader who collapsed the section last week has `false` in
    storage, and following a link to it now is the more recent instruction.

    `hashchange` covers the second click. The browser does not re-fire it for a
    hash that is already current, so a link followed twice would otherwise
    scroll and do nothing — which is fine here, because by then the section is
    already open.
  */
  useEffect(() => {
    if (!anchorId) return;
    const openIfNamed = () => {
      if (window.location.hash === `#${anchorId}`) setOpen(true);
    };
    openIfNamed();
    window.addEventListener('hashchange', openIfNamed);
    return () => window.removeEventListener('hashchange', openIfNamed);
  }, [anchorId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch (_) {
      // Session-only folding is a smaller loss than a crash on click.
    }
  };

  return (
    <section
      id={anchorId}
      /*
        `scroll-mt` clears the sticky nav. Without it a fragment link puts the
        section's header underneath the bar and the reader lands on its second
        row, which reads as having missed.
      */
      className="scroll-mt-28 rounded-2xl border border-white/8 bg-card/40 overflow-hidden"
    >
      <h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-start gap-3 px-5 py-4 text-left min-h-[56px] hover:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-inset"
        >
          <ChevronDown
            className={`h-4 w-4 mt-0.5 flex-shrink-0 text-white/40 transition-transform duration-200 ${
              open ? '' : '-rotate-90'
            }`}
            aria-hidden="true"
          />
          {/*
            ⚠ Beside the title from `sm` up, under it on a phone.

            It was always beside, truncating at 45% of the row — which on a
            390px screen is about 130px, so "5 known issues · 7 service
            intervals" rendered as "5 known issues · 7 s…". An ellipsis in a
            summary line is the cheapest possible answer: the whole job of that
            line is to say what is inside without opening it, and half of it
            says nothing.

            Given its own line it fits whole, and the truncation stays as the
            backstop for a summary longer than anything written so far — a
            folded section growing a third line would defeat the fold.
          */}
          <span className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3">
            <span className="text-[15px] font-semibold text-white tracking-tight sm:flex-1 sm:min-w-0 truncate">
              {title}
            </span>
            {summary && !open && (
              <span className="text-[13px] text-white/50 truncate sm:max-w-[45%]">{summary}</span>
            )}
          </span>
        </button>
      </h2>

      {open && (
        <div id={panelId} className="px-5 pb-5">
          {children}
        </div>
      )}
    </section>
  );
}
