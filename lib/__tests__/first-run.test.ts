/**
 * @jest-environment node
 *
 * Who gets the opening explanation.
 *
 * Three people meet an empty garage and only one of them is new. These pin
 * which is which, because the wrong answer is invisible in testing — you only
 * ever see your own account, and yours has cars in it.
 */

import { shouldShowFirstRun } from '@crewchief/core/first-run';

describe('an empty garage has two readings', () => {
  it('explains the product to someone who has never had a car', () => {
    expect(shouldShowFirstRun({ everHadVehicle: false, vehicleCount: 0 })).toBe(true);
  });

  it('says nothing to someone who has used it and sold the car', () => {
    /*
      ⚠ The case a "seen onboarding" flag gets wrong in the other direction.
      A year-old account that removes its last car is not a new user, and
      greeting it with "Start with one car" is the product forgetting them.
    */
    expect(shouldShowFirstRun({ everHadVehicle: true, vehicleCount: 0 })).toBe(false);
  });

  it('never covers a garage that has cars in it', () => {
    expect(shouldShowFirstRun({ everHadVehicle: false, vehicleCount: 1 })).toBe(false);
    expect(shouldShowFirstRun({ everHadVehicle: true, vehicleCount: 3 })).toBe(false);
  });

  it('lets the car count win when storage disagrees with it', () => {
    /*
      ⚠ The ordering is load-bearing, not incidental. `secureStorage` swallows
      its own errors and reports a miss as `null`, so `everHadVehicle` can be
      wrong. The failure has to land on "the explanation reappears for an empty
      garage" — mildly redundant — and never on "the explanation covers a
      garage with cars in it", which would hide the user's own vehicles behind
      a marketing screen.
    */
    expect(shouldShowFirstRun({ everHadVehicle: false, vehicleCount: 2 })).toBe(false);
  });
});
