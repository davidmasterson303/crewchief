'use client';

import VehicleInsights from './VehicleInsights';
import { WishlistSection } from './WishlistSection';

interface DashboardContentProps {
  vehicle: any;
  knowledge: any;
}

export default function DashboardContent({ vehicle, knowledge }: DashboardContentProps) {
  return (
    <div className="space-y-6">
      <VehicleInsights
        vehicle={vehicle}
        knowledge={knowledge}
      />
      <WishlistSection vehicleId={vehicle.id} />
    </div>
  );
}
