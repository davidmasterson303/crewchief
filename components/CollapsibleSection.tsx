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
 *     back open on every navigation. Keyed storage, following the idiom already
 *     in `UpcomingMaintenance` (`localStorage`, read in a lazy initialiser,
 *     writes wrapped in try/catch because storage can be unavailable outright).
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
    <section className="rounded-2xl border border-white/8 bg-card/40 overflow-hidden">
      <h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-3 px-5 py-4 text-left min-h-[56px] hover:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-inset"
        >
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-white/40 transition-transform duration-200 ${
              open ? '' : '-rotate-90'
            }`}
            aria-hidden="true"
          />
          <span className="text-[15px] font-semibold text-white tracking-tight flex-1 min-w-0">
            {title}
          </span>
          {/* Truncates rather than wraps — a summary that grows a second line
              defeats the point of the section being folded. */}
          {summary && !open && (
            <span className="text-[13px] text-white/50 truncate max-w-[45%]">{summary}</span>
          )}
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
