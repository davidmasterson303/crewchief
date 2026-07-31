'use client';

import CollapsibleSection from './CollapsibleSection';
import VehicleInsights from './VehicleInsights';
import { WishlistSection } from './WishlistSection';
import { useWishlistData } from '@/hooks/useWishlistData';

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
