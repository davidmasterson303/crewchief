/**
 * An odometer goes up, except when the owner mistyped.
 *
 * @jest-environment node
 *
 * Phase 5.6's service notification opens on a mileage confirmation, which makes
 * this the first value a push asks someone to type. Two rules here are not
 * obvious and both were chosen against the simpler alternative:
 *
 *   1. **A decrease is refused by default and allowed as a correction.** Pure
 *      monotonicity is the obvious rule and it is a trap: enter 160000 for
 *      16000 once and every later reading is below the stored value, so the car
 *      is locked at a wrong number permanently — with no support channel to
 *      undo it, and that number then feeds every service-due calculation.
 *   2. **A huge jump is gated the same way**, because unlike a decrease it is
 *      silently plausible. Nothing about 16000 → 160000 looks wrong to a
 *      server that only checks the direction of travel.
 */

import { validateMileageUpdate } from '@crewchief/core/mileage-tracking';

describe('validateMileageUpdate', () => {
  it('accepts a reading that moved forward', () => {
    expect(validateMileageUpdate({ current: 60_000, next: 60_300 })).toEqual({ ok: true });
  });

  it('accepts an unchanged reading, which is what confirming one is', () => {
    // The notification asks "still around 60,300?" and the common answer is
    // yes. That must not be an error.
    expect(validateMileageUpdate({ current: 60_300, next: 60_300 }).ok).toBe(true);
  });

  it('accepts a first reading against a car with none recorded', () => {
    expect(validateMileageUpdate({ current: 0, next: 42_000 }).ok).toBe(true);
  });

  describe('going backwards', () => {
    it('is refused by default', () => {
      const decision = validateMileageUpdate({ current: 60_000, next: 16_000 });

      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe('went-backwards');
    });

    it('is allowed as an explicit correction', () => {
      // The escape hatch that stops a typo being permanent.
      expect(
        validateMileageUpdate({ current: 160_000, next: 16_000, isCorrection: true }).ok
      ).toBe(true);
    });

    it('tells the owner what is already recorded, and asks the right question', () => {
      // This message is shown to a person who just typed a number, so it names
      // the conflict and offers the way out rather than only refusing.
      const { message } = validateMileageUpdate({ current: 60_000, next: 16_000 });

      expect(message).toContain('60,000');
      expect(message).toMatch(/correct/i);
    });
  });

  describe('an implausible jump', () => {
    it('is refused by default', () => {
      const decision = validateMileageUpdate({ current: 16_000, next: 160_000 });

      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe('implausible-jump');
    });

    it('is allowed as an explicit correction', () => {
      expect(
        validateMileageUpdate({ current: 16_000, next: 160_000, isCorrection: true }).ok
      ).toBe(true);
    });

    it('does not fire on a large but ordinary year of driving', () => {
      // 30k in one update is a lot and is not a typo. The threshold has to sit
      // above real driving or it teaches people to tick "correction" reflexively,
      // which disables the check that matters.
      expect(validateMileageUpdate({ current: 60_000, next: 90_000 }).ok).toBe(true);
    });
  });

  describe('values that are not readings', () => {
    it.each([
      ['a string', '60300'],
      ['null', null],
      ['undefined', undefined],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a fraction', 60_300.5],
    ])('refuses %s', (_label, next) => {
      const decision = validateMileageUpdate({ current: 60_000, next });

      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe('not-a-number');
    });

    it('refuses a negative reading even as a correction', () => {
      // `isCorrection` forgives a direction, not a value that cannot exist.
      const decision = validateMileageUpdate({ current: 60_000, next: -5, isCorrection: true });

      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe('out-of-range');
    });

    it('refuses a reading past any real odometer, even as a correction', () => {
      const decision = validateMileageUpdate({
        current: 60_000,
        next: 9_000_000,
        isCorrection: true,
      });

      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe('out-of-range');
    });
  });

  it('gives every rejection something to show the person who typed it', () => {
    // A rule that refuses without explaining sends someone back to the same
    // field with the same number.
    const rejections = [
      validateMileageUpdate({ current: 60_000, next: 'x' }),
      validateMileageUpdate({ current: 60_000, next: -1 }),
      validateMileageUpdate({ current: 60_000, next: 100 }),
      validateMileageUpdate({ current: 100, next: 900_000 }),
    ];

    for (const decision of rejections) {
      expect(decision.ok).toBe(false);
      expect(decision.message).toEqual(expect.any(String));
      expect(decision.message!.length).toBeGreaterThan(0);
    }
  });
});
