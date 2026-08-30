/**
 * Reading a model's JSON, in whichever spelling it arrived in.
 *
 * The module exists because **every health score Well Kept ever generated was
 * 70**: the prompt asked for `healthScore`, the parser read `health_score`, and
 * the difference was absorbed by a fallback that was defensible in isolation.
 * These cases pin the two properties that stop that recurring — absence is
 * `null` rather than a default, and a value that is not a score is `null`
 * rather than a clamped one.
 */

import {
  firstNumber,
  firstString,
  firstStringArray,
  scoreInRange,
} from '@wellkept/core/model-json';

describe('firstNumber', () => {
  it('takes the first spelling that is actually there', () => {
    expect(firstNumber(undefined, 72)).toBe(72);
    expect(firstNumber(72, 9)).toBe(72);
  });

  it('accepts a numeric string, because models return them', () => {
    // Refusing `"72"` would reintroduce the silent fallback this replaces.
    expect(firstNumber('72')).toBe(72);
    expect(firstNumber(' 72 ')).toBe(72);
  });

  it('returns null rather than a default when nothing is a number', () => {
    /*
      ⚠ The whole point. A caller that wants 70 has to write 70, at a site where
      somebody reading it can ask whether 70 is honest there.
    */
    expect(firstNumber(undefined, null)).toBeNull();
    expect(firstNumber('not a number')).toBeNull();
    expect(firstNumber('')).toBeNull();
    expect(firstNumber(NaN, Infinity)).toBeNull();
  });

  it('does not mistake a boolean for a number', () => {
    // `Number(true)` is 1, which would be a score.
    expect(firstNumber(true)).toBeNull();
  });
});

describe('firstString', () => {
  it('trims, and treats whitespace as absent', () => {
    expect(firstString('  Fair  ')).toBe('Fair');
    expect(firstString('   ', 'Fair')).toBe('Fair');
    expect(firstString('   ')).toBeNull();
  });
});

describe('firstStringArray', () => {
  it('distinguishes "it said none" from "it did not say"', () => {
    /*
      ⚠ The distinction the health summary needs. An empty `redFlags` is the
      model answering "none"; a missing one is the model not answering, and only
      one of those may be rendered as a clean bill.
    */
    expect(firstStringArray([])).toEqual([]);
    expect(firstStringArray(undefined)).toBeNull();
  });

  it('drops entries that are not usable strings', () => {
    expect(firstStringArray(['Coolant leak', '', null, 42, '  Oil seep '])).toEqual([
      'Coolant leak',
      'Oil seep',
    ]);
  });
});

describe('scoreInRange', () => {
  it('keeps a score that is one', () => {
    expect(scoreInRange(72)).toBe(72);
    expect(scoreInRange(1)).toBe(1);
    expect(scoreInRange(100)).toBe(100);
  });

  it('rounds, because the prompt asks for an integer', () => {
    expect(scoreInRange(71.6)).toBe(72);
  });

  it('refuses an out-of-range value rather than clamping it', () => {
    /*
      ⚠ `430` is not a slightly-too-high score, it is not a score — and
      clamping it to 100 would write a **perfect reading** out of a broken
      response, on the gauge this whole module exists to keep honest.
    */
    expect(scoreInRange(430)).toBeNull();
    expect(scoreInRange(0)).toBeNull();
    expect(scoreInRange(-5)).toBeNull();
  });

  it('passes null through', () => {
    expect(scoreInRange(null)).toBeNull();
  });
});
