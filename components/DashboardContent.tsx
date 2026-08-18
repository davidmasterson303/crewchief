'use client';

import dynamic from 'next/dynamic';
import CollapsibleSection from './CollapsibleSection';
import { Skeleton } from '@/components/ui/skeleton';
import { useWishlistData } from '@/hooks/useWishlistData';

/*
  ── Both of these load when the fold opens, not before ──────────────────────

  `CollapsibleSection` already refuses to *render* a closed section's children,
  and its docblock makes the case for that: these subtrees mount dialogs and
  fire queries, and a fold nobody opened should not pay for them. What it could
  not do is stop the code being *downloaded* — a static import puts the whole
  tree in the route's first load whether or not anything renders it.

  Both of these sections are `defaultOpen={false}`, and both were pulling their
  entire dialog stacks into the initial bundle:

    WishlistSection  -> QuoteRequestDialogV2 -> QuoteGenerationProgress
                     -> framer-motion, an animation library the dashboard
                        otherwise has no use for at all
                     plus MarkCompleteDialog, AddWishlistItemDialog,
                        QuoteDetailDialog
    VehicleInsights  -> IssueFixDialog, MaintenanceHistoryDialog and three
                        tab panels (Issues, Maintenance, Modifications)

  So the dashboard was shipping — and hydrating — a quote-request flow and a
  628-line dossier in order to render two collapsed headers with a one-line
  summary on each. Two `next build` runs over the same tree, this file being
  the only difference:

                          route chunk    First Load JS
    static imports          30.4 kB         341 kB
    dynamic                 13.9 kB         261 kB

  80 kB less to download, parse and hydrate on every dashboard load, for
  content most visitors never unfold.

  That JavaScript is the reported symptom: switching tabs on the deployed
  dashboard was slow, in the sense of the whole client boot having to finish
  before the strip responded. This is aimed squarely at the cause. It is NOT
  the fix that was tried first — the tab strip was briefly turned into native
  anchors, which traded ~2.7s of client boot per switch for a full page load
  and was reverted to `Link` + `prefetch`. Shrinking the boot is the version of
  that idea which does not cost a navigation.

  What made the first attempt wrong is worth keeping: the diagnosis behind it
  came from a reproduction taken in a BACKGROUND browser tab, where
  `document.visibilityState` is `hidden` and prefetch is deprioritised. The
  original root cause was never actually established, so this is an attack on a
  measured cost, not a confirmed culprit — it should be verified against the
  deployed site rather than assumed to have closed the ticket.

  `ssr: false` is honest rather than merely convenient: with `defaultOpen`
  false these never render on the server anyway, so there is no server output
  to lose, and it keeps them out of the server bundle too.

  Both are used *only* here, so nothing else on any other route changes.

  The trade is a fetch on first open. It is one chunk against a warm connection
  and it happens while the section is already expanding, where a brief skeleton
  is expected — as against a cost every visitor paid on every load for content
  most of them never unfolded.
*/
const VehicleInsights = dynamic(() => import('./VehicleInsights'), {
  ssr: false,
  loading: () => <FoldSkeleton />,
});

const WishlistSection = dynamic(
  () => import('./WishlistSection').then((m) => m.WishlistSection),
  { ssr: false, loading: () => <FoldSkeleton /> }
);

/** Placeholder for a fold whose contents are still arriving. */
function FoldSkeleton() {
  return (
    <div className="space-y-3 py-2">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[70%]" />
    </div>
  );
}

interface DashboardContentProps {
  vehicle: any;
  knowledge: any;
  /**
   * The vehicle whose fold state these sections remember. Passed rather than
   * taken from `vehicle.id` so the caller's route param is the one key — the
   * two are the same id, and one of them is the one the URL guarantees.
   */
  vehicleId: string;
}

/** How many entries a knowledge field holds, whatever shape it arrived in. */
function count(field: unknown): number {
  if (Array.isArray(field)) return field.length;
  if (typeof field === 'string') {
    const trimmed = field.trim();
    if (!trimmed) return 0;
    // Some knowledge fields are newline-delimited prose rather than arrays.
    return trimmed.split('\n').filter((line) => line.trim().length > 0).length;
  }
  return 0;
}

function pluralise(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

/**
 * What the dossier says while folded.
 *
 * Research state first when it is not done, because a dossier that is empty
 * *because nothing has been researched yet* is a different thing from one that
 * is simply empty, and the fold is exactly where that distinction gets lost.
 *
 * The states are the `research_status` enum's own — `pending`, `completed`,
 * `failed`, `unsupported` — matched positively rather than by testing "not
 * done". Written first as `!== 'complete'`, which is not a value the enum has,
 * so every fully-researched car reported "Research pending". Reading the enum
 * beats guessing its spelling.
 */
function dossierSummary(knowledge: any): string | undefined {
  if (!knowledge) return 'Not researched';

  switch (knowledge.research_status) {
    case 'pending':
      return 'Research pending';
    case 'failed':
      return 'Research failed';
    case 'unsupported':
      return 'Not supported';
  }

  const issues = count(knowledge.known_issues);
  const intervals = count(knowledge.maintenance_schedule);
  const parts: string[] = [];
  if (issues) parts.push(pluralise(issues, 'known issue'));
  if (intervals) parts.push(pluralise(intervals, 'service interval'));

  return parts.length ? parts.join(' · ') : 'Researched';
}

/**
 * The two reference sections, both folded by default.
 *
 * Neither answers "does my car need attention", which is what the dashboard
 * opens to say. The dossier is a long read you consult when deciding something;
 * the wishlist is a working list you visit when planning.
 *
 * ── On the cost of a folded summary ─────────────────────────────────────────
 *
 * Summarising the wishlist while it is closed means fetching it while it is
 * closed, so "folded costs nothing" is no longer strictly true here. It is one
 * request the section would make the moment you opened it, and `useWishlistData`
 * shares the exact query key `['wishlist', vehicleId]` that `WishlistSection`
 * uses — so this reads the same cache rather than adding a second fetch.
 *
 * The expensive things still do not mount while folded: the item list, the quote
 * history query, and the dossier's whole tree.
 */
export default function DashboardContent({ vehicle, knowledge, vehicleId }: DashboardContentProps) {
  const { data: wishlistItems } = useWishlistData(vehicleId);

  const wishlistSummary = (() => {
    if (!wishlistItems) return undefined;
    if (wishlistItems.length === 0) return 'Empty';

    const total = wishlistItems.reduce(
      (sum: number, item: any) => sum + (Number(item.estimated_cost) || 0),
      0
    );

    const items = pluralise(wishlistItems.length, 'item');
    // Only claim a total when there is one — every item priced at zero should
    // not read as "~$0", which looks like a bug rather than an absence.
    return total > 0 ? `${items} · ~$${Math.round(total).toLocaleString()}` : items;
  })();

  return (
    <div className="space-y-3">
      <CollapsibleSection
        title="Vehicle dossier"
        storageKey={`dash:dossier:${vehicleId}`}
        defaultOpen={false}
        summary={dossierSummary(knowledge)}
      >
        <VehicleInsights vehicle={vehicle} knowledge={knowledge} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Wishlist"
        storageKey={`dash:wishlist:${vehicleId}`}
        defaultOpen={false}
        summary={wishlistSummary}
      >
        <WishlistSection vehicleId={vehicle.id} />
      </CollapsibleSection>
    </div>
  );
}
