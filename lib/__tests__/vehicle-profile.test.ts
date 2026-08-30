/**
 * The four answers, and the rules for changing them.
 *
 * @jest-environment node
 *
 * ── Why these are checked at all ────────────────────────────────────────────
 *
 * They look like a settings page and are not. Three of the four change what the
 * product *does*: `performanceMindedness` gates the whole modifications surface,
 * `avgMilesPerMonth` feeds every mileage-based service projection, and
 * `vehicleStatus` is the usage profile the dossier is written against. A bad
 * value here is not cosmetic.
 */

import {
  AVG_MILES_MAX,
  MINDEDNESS,
  OBJECTIVE_MAX,
  validateProfileUpdate,
} from '@wellkept/core/vehicle-profile';

describe('what may be written', () => {
  it('takes only the fields that were supplied', () => {
    /*
      ⚠ Partial by design. A caller sends what changed, and a PATCH carrying
      every field would rewrite three columns to their own values on every save
      — harmless today, and exactly what makes an audit log useless later.
    */
    const decision = validateProfileUpdate({ avgMilesPerMonth: 800 });

    expect(decision.ok).toBe(true);
    expect(decision.changes).toEqual({ avg_miles_per_month: 800 });
  });

  it('maps every field onto its own column', () => {
    const decision = validateProfileUpdate({
      avgMilesPerMonth: 500,
      vehicleStatus: 'weekend',
      performanceMindedness: 'aggressive',
      ownershipObjective: '  Keep it sharp for track days.  ',
    });

    expect(decision.changes).toEqual({
      avg_miles_per_month: 500,
      vehicle_status: 'weekend',
      performance_mindedness: 'aggressive',
      // Trimmed — trailing whitespace reaches a model prompt otherwise.
      ownership_objective: 'Keep it sharp for track days.',
    });
  });

  it('refuses an empty update rather than reporting success', () => {
    /*
      ⚠ A PATCH that writes nothing and returns 200 is indistinguishable from
      one that worked — which is how a screen ends up saying "saved" for a body
      the server did not understand, after a field was renamed on one side.
    */
    expect(validateProfileUpdate({}).ok).toBe(false);
    expect(validateProfileUpdate({ vehicleId: 'v1' }).ok).toBe(false);
  });
});

describe('the values it will not take', () => {
  it('accepts a stored car at zero miles but refuses the impossible', () => {
    // 0 is a real answer — a car under a cover — so the floor is not 1.
    expect(validateProfileUpdate({ avgMilesPerMonth: 0 }).ok).toBe(true);

    expect(validateProfileUpdate({ avgMilesPerMonth: -1 }).ok).toBe(false);
    expect(validateProfileUpdate({ avgMilesPerMonth: 1.5 }).ok).toBe(false);
    expect(validateProfileUpdate({ avgMilesPerMonth: 'lots' }).ok).toBe(false);

    // The ceiling is a mistyped odometer landing in a monthly field.
    const tooMuch = validateProfileUpdate({ avgMilesPerMonth: AVG_MILES_MAX + 1 });
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.message).toMatch(/more than any car covers/);
  });

  it('takes only the four usage profiles core defines', () => {
    expect(validateProfileUpdate({ vehicleStatus: 'daily_driver' }).ok).toBe(true);
    expect(validateProfileUpdate({ vehicleStatus: 'for_sale' }).ok).toBe(true);
    // Anti-vacuous: something plausible but not in the set is still refused.
    expect(validateProfileUpdate({ vehicleStatus: 'garage_queen' }).ok).toBe(false);
    expect(validateProfileUpdate({ vehicleStatus: 42 }).ok).toBe(false);
  });

  it('takes every mindedness including the off switch', () => {
    /*
      ⚠ `stock` must be settable, and that is the entire point of this screen.
      It hides the Build route, and `mod-progression.ts` says the answer *"owes
      the owner a way to turn it back on"* — which it did not have until there
      was a write path.
    */
    for (const value of MINDEDNESS) {
      expect(validateProfileUpdate({ performanceMindedness: value }).ok).toBe(true);
    }
    expect(validateProfileUpdate({ performanceMindedness: 'insane' }).ok).toBe(false);
  });

  it('bounds the objective, because it reaches a model prompt', () => {
    expect(validateProfileUpdate({ ownershipObjective: 'Keep it reliable.' }).ok).toBe(true);

    // Blank is not an answer — every car has something it is for.
    expect(validateProfileUpdate({ ownershipObjective: '   ' }).ok).toBe(false);

    const tooLong = validateProfileUpdate({ ownershipObjective: 'x'.repeat(OBJECTIVE_MAX + 1) });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.message).toMatch(new RegExp(String(OBJECTIVE_MAX)));
  });

  it('reports the first thing wrong and writes nothing', () => {
    // A partial write on a rejected body would leave the row half-updated.
    const decision = validateProfileUpdate({ avgMilesPerMonth: 900, vehicleStatus: 'nope' });

    expect(decision.ok).toBe(false);
    expect(decision.changes).toBeUndefined();
  });
});
