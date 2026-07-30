'use client';

import CollapsibleSection from './CollapsibleSection';
import VehicleInsights from './VehicleInsights';
import { WishlistSection } from './WishlistSection';

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

/**
 * The two reference sections, both folded by default.
 *
 * Neither answers "does my car need attention", which is what the dashboard
 * opens to say. The dossier is a long read you consult when deciding something;
 * the wishlist is a working list you visit when planning. Both were expanded
 * permanently, contributing most of the page's scroll.
 */
export default function DashboardContent({ vehicle, knowledge, vehicleId }: DashboardContentProps) {
  return (
    <div className="space-y-6">
      <CollapsibleSection
        title="Vehicle dossier"
        storageKey={`dash:dossier:${vehicleId}`}
        defaultOpen={false}
        summary={knowledge?.research_status === 'complete' ? 'Researched' : undefined}
      >
        <VehicleInsights vehicle={vehicle} knowledge={knowledge} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Wishlist"
        storageKey={`dash:wishlist:${vehicleId}`}
        defaultOpen={false}
      >
        <WishlistSection vehicleId={vehicle.id} />
      </CollapsibleSection>
    </div>
  );
}
