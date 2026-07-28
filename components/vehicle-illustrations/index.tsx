'use client';

import type { ComponentType } from 'react';
import {
  resolveBodyStyle,
  type VehicleBodyStyle,
} from '@crewchief/core/vehicle-body-style';
import type { VehicleIllustrationProps } from './VehicleIllustration';
import {
  SedanIllustration,
  CoupeIllustration,
  SportsIllustration,
  WagonIllustration,
  SmallSuvIllustration,
  LargeSuvIllustration,
  Pickup2DoorIllustration,
  Pickup4DoorIllustration,
  MinivanIllustration,
  VanIllustration,
  MotorcycleIllustration,
  GenericVehicleIllustration,
} from './shapes';

export { VEHICLE_BODY_STYLES, BODY_STYLE_LABEL } from '@crewchief/core/vehicle-body-style';
export type { VehicleBodyStyle } from '@crewchief/core/vehicle-body-style';
export type { VehicleIllustrationProps } from './VehicleIllustration';

/**
 * Every style to its component. Exhaustive by construction — `Record` over the
 * union means adding a style to `VehicleBodyStyle` fails to compile until it
 * is drawn, which is the point of keeping the union in the shared package.
 */
export const ILLUSTRATION_BY_STYLE: Record<
  VehicleBodyStyle,
  ComponentType<VehicleIllustrationProps>
> = {
  sedan: SedanIllustration,
  coupe: CoupeIllustration,
  sports: SportsIllustration,
  wagon: WagonIllustration,
  'suv-small': SmallSuvIllustration,
  'suv-large': LargeSuvIllustration,
  'pickup-2door': Pickup2DoorIllustration,
  'pickup-4door': Pickup4DoorIllustration,
  minivan: MinivanIllustration,
  van: VanIllustration,
  motorcycle: MotorcycleIllustration,
  generic: GenericVehicleIllustration,
};

/**
 * The illustration for a vehicle, from its vPIC decode.
 *
 * Derived, never stored: nothing is persisted per vehicle until a real photo
 * exists, so a corrected decode immediately yields a corrected illustration
 * and there is no migration when the set changes.
 *
 * @param bodyClass vPIC `BodyClass`, already captured at onboarding.
 * @param doors     vPIC `Doors`. Separates sedan from coupe and crew cab from
 *                  regular cab.
 */
export function getDefaultVehicleImage(
  bodyClass: string | null | undefined,
  doors?: string | number | null
): ComponentType<VehicleIllustrationProps> {
  return ILLUSTRATION_BY_STYLE[resolveBodyStyle(bodyClass, doors)];
}
