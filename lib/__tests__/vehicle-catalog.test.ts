/**
 * The add-a-car catalogue.
 *
 * @jest-environment node
 *
 * ── What is worth asserting here, and what is not ───────────────────────────
 *
 * Not "the make list contains Toyota". A list is data, and a test that restates
 * data fails when the data is corrected, which trains people to edit the test.
 *
 * What is worth asserting is every place this module makes a **judgement**:
 * which suggestion comes first, which VIN is refused and which is only warned
 * about, and what is kept out of a third-party JSON body that arrives in four
 * different shapes depending on how much NHTSA knows. Each case below is either
 * a mistake this form has already made with free-text fields or a shape vPIC
 * genuinely returns — the fixtures are trimmed copies of live responses, taken
 * on 23 Aug 2026 rather than written from memory.
 */

import {
  COMMON_MAKES,
  MODEL_YEAR_FLOOR,
  VIN_LENGTH,
  canonicalName,
  catalogKey,
  isPlausibleModelYear,
  modelYears,
  parseVpicDecode,
  parseVpicModels,
  suggestNames,
  vinCheckDigitMatches,
  vinProblem,
  vpicDecodeUrl,
  vpicModelsUrl,
} from '@wellkept/core/vehicle-catalog';

const AUGUST = new Date('2026-08-23T12:00:00Z');

describe('model years', () => {
  it('runs one year ahead of the calendar, because forecourts do', () => {
    // A list that stopped at 2026 would tell somebody who has just bought a
    // 2027 car that their car does not exist.
    expect(modelYears(AUGUST)[0]).toBe(2027);
  });

  it('stops at the first standardised VIN year rather than at a round number', () => {
    const years = modelYears(AUGUST);
    expect(years[years.length - 1]).toBe(MODEL_YEAR_FLOOR);
    expect(years).toHaveLength(2027 - MODEL_YEAR_FLOOR + 1);
  });

  it('refuses what a four-character check would have let through', () => {
    // The three the old free-text field accepted: a typo, an overflow, and a
    // year that has not happened.
    expect(isPlausibleModelYear(205, AUGUST)).toBe(false);
    expect(isPlausibleModelYear(20155, AUGUST)).toBe(false);
    expect(isPlausibleModelYear(2029, AUGUST)).toBe(false);

    // Anti-vacuous: a predicate that refused everything would pass all three.
    expect(isPlausibleModelYear(2015, AUGUST)).toBe(true);
    expect(isPlausibleModelYear(2027, AUGUST)).toBe(true);
  });
});

describe('matching a name somebody is typing', () => {
  it('collapses the four spellings of one make onto one key', () => {
    // The defect the whole module exists for: these are four different cars to
    // every downstream join, and one car to the person holding it.
    const keys = ['BMW', 'bmw', 'Bmw', 'B.M.W.'].map(catalogKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('offers prefixes before contained matches', () => {
    /*
      Typing "m" must offer Maserati before Aston Martin. One relevance score
      cannot express that without being a number nobody can explain; two passes
      can, and this is the assertion that keeps them two.
    */
    const suggestions = suggestNames('m', COMMON_MAKES, 20);
    expect(suggestions).toContain('Maserati');
    expect(suggestions).toContain('Aston Martin');
    expect(suggestions.indexOf('Maserati')).toBeLessThan(suggestions.indexOf('Aston Martin'));
  });

  it('finds a make through the punctuation nobody types the same way twice', () => {
    expect(suggestNames('mercedes benz', COMMON_MAKES)).toContain('Mercedes-Benz');
    expect(suggestNames('landrover', COMMON_MAKES)).toContain('Land Rover');
  });

  it('opens with the whole list rather than with nothing', () => {
    // The field shows suggestions on focus, and somebody who does not know how
    // their make is spelled is exactly the person who has not typed yet.
    expect(suggestNames('', COMMON_MAKES, 5)).toHaveLength(5);
  });

  it('takes the catalogue spelling but never refuses an unlisted make', () => {
    expect(canonicalName('bmw', COMMON_MAKES)).toBe('BMW');
    expect(canonicalName('  mercedes-benz ', COMMON_MAKES)).toBe('Mercedes-Benz');

    /*
      ⚠ The rule that makes this a catalogue and not a gate. A grey import, a
      kit car and a marque younger than this list all have to get through, and
      the answer for them is their own spelling, unaltered.
    */
    expect(canonicalName('Koenigsegg', COMMON_MAKES)).toBe('Koenigsegg');
  });
});

describe('VIN', () => {
  /** A real, clean VIN — the M235i in the fixtures, check digit and all. */
  const CLEAN = 'WBA1J7C51FV253855';

  it('names the three characters a VIN cannot contain', () => {
    /*
      I, O and Q are the characters an owner is *most* likely to type, because
      they are the ones that look like 1 and 0 on a stamped plate. Saying so
      beats a decode that fails at NHTSA with "invalid VIN".
    */
    expect(vinProblem('WBA1J7C51FV25385O')).toMatch(/I, O or Q/);
  });

  it('counts down rather than just saying no', () => {
    expect(vinProblem('WBA1J7C51')).toMatch(/8 to go/);
    expect(vinProblem(`${CLEAN}9`)).toMatch(/18 characters/);
    expect(vinProblem(CLEAN)).toBeNull();
    // Nothing typed yet is not a problem — an empty field is not an error.
    expect(vinProblem('')).toBeNull();
  });

  it('checks position 9 without refusing over it', () => {
    expect(vinCheckDigitMatches(CLEAN)).toBe(true);

    /*
      ⚠ The same VIN with one digit moved. `vinCheckDigitMatches` is false and
      `vinProblem` is **null** — that pairing is the whole design: position 9 is
      only mandatory for North American builds, and NHTSA itself decodes a
      failing VIN rather than refusing it. A client stricter than the authority
      it is about to ask answers questions it was not asked.
    */
    const mistyped = 'WBA1J7C52FV253855';
    expect(vinCheckDigitMatches(mistyped)).toBe(false);
    expect(vinProblem(mistyped)).toBeNull();
  });

  it('builds the endpoints against the normalised number', () => {
    expect(vpicDecodeUrl(' wba1j7c51fv253855 ')).toContain(`/DecodeVinValues/${CLEAN}?`);
    expect(vpicModelsUrl('Mercedes-Benz', 2015, 'mpv')).toContain(
      '/make/Mercedes-Benz/modelyear/2015/vehicletype/mpv'
    );
    expect(vpicModelsUrl('Land Rover', 2015, 'car')).toContain('/make/Land%20Rover/');
    expect(CLEAN).toHaveLength(VIN_LENGTH);
  });
});

describe('reading vPIC, which is a third party over a network', () => {
  it('survives the shape a make with nothing for that year returns', () => {
    // ⚠ `Results` is `null`, not `[]`. Scion in 2021 answers exactly this, and
    // a shape assumption here is a crash on the add-a-car screen.
    expect(parseVpicModels({ Count: 0, Results: null })).toEqual([]);
    expect(parseVpicModels(null)).toEqual([]);
    expect(parseVpicModels({})).toEqual([]);
  });

  it('de-duplicates and sorts the models it is given', () => {
    const models = parseVpicModels({
      Results: [
        { Model_Name: 'X5' },
        { Model_Name: 'M235i' },
        { Model_Name: 'X5' },
        { Model_Name: '  ' },
        { Model_Name: 328 },
        { Model_Name: '328i' },
      ],
    });

    // The two junk rows are gone, the duplicate is one, and the order is a
    // human's rather than the API's row order.
    expect(models).toEqual(['328i', 'M235i', 'X5']);
  });

  it('keeps a decode that NHTSA complained about', () => {
    /*
      ⚠ The case that decides the whole branch. This is a live response for a
      VIN with a bad check digit: `ErrorCode` is 1 **and the car is identified
      anyway**. Discarding it on the error code would throw away make, model and
      trim over the one character the owner can fix by looking again.
    */
    const decoded = parseVpicDecode({
      Results: [
        {
          ErrorCode: '1',
          ErrorText: '1 - Check Digit (9th position) does not calculate properly',
          ModelYear: '2003',
          Make: 'HONDA',
          Model: 'Accord',
          Trim: 'LX',
        },
      ],
    });

    expect(decoded).toEqual({
      year: 2003,
      // Title-cased through the catalogue, so a decoded car and a typed one
      // do not sit in one garage looking like two products.
      make: 'Honda',
      model: 'Accord',
      trim: 'LX',
      confidence: 'suspect',
    });
  });

  it('treats an empty trim as normal rather than as a failure', () => {
    /*
      A genuine 2015 M235i decodes with `Trim: ''` and its series in a field
      this product does not read. An absent trim is the common case, not a bad
      decode, and the screen must not blank a value the owner already typed.
    */
    const decoded = parseVpicDecode({
      Results: [{ ErrorCode: '0', ModelYear: '2015', Make: 'BMW', Model: 'M235i', Trim: '' }],
    });

    expect(decoded).toMatchObject({ make: 'BMW', model: 'M235i', trim: null, confidence: 'clean' });
  });

  it('returns null only when nothing was identified', () => {
    // No make and no model is the one answer worth discarding. Anything else
    // is partial information, which this product prefers to a guess.
    expect(parseVpicDecode({ Results: [{ ErrorCode: '11', Make: '', Model: '' }] })).toBeNull();
    expect(parseVpicDecode({ Results: [] })).toBeNull();
    expect(parseVpicDecode(null)).toBeNull();
  });
});
