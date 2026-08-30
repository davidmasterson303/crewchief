/**
 * A recall notice, turned into something an owner can act on.
 *
 * @jest-environment node
 *
 * Two things here can hurt someone and both are ordering or truthiness bugs
 * rather than anything that looks dangerous in a diff:
 *
 *   1. **`parkIt` means do not drive the vehicle.** NHTSA sends it as a
 *      boolean from the API and as a string in some stored payloads, and the
 *      string `"false"` is truthy in JavaScript — which is exactly how a "do
 *      not drive" banner ends up on every recall in the list, and how it stops
 *      meaning anything.
 *   2. **Severity has to outrank recency.** A two-year-old "do not drive"
 *      notice is more urgent than last month's trim-clip recall, and sorting
 *      by date alone buries it.
 *
 * The third theme is absence. The live `nhtsa_data.recalls` rows carry five
 * fields and **no `Remedy`** — the seeded demo rows were written by hand as a
 * subset, while the API returns `Remedy`, `Notes` and the two flags as well. So
 * every consumer has to cope with a field that is simply not there, and a
 * "How it gets fixed" section rendered empty says "nobody knows how to fix
 * this", which is worse than saying nothing.
 */

import {
  hasRemedy,
  inferDateOrder,
  normaliseRecall,
  normaliseRecalls,
  parseRecallDate,
  severityOf,
  worstSeverity,
} from '@wellkept/core/recalls';

/** The shape the API actually returns, verified against NHTSA on 7 Aug 2026. */
const FROM_API = {
  Manufacturer: 'Subaru of America, Inc.',
  NHTSACampaignNumber: '20V123000',
  parkIt: false,
  parkOutSide: false,
  overTheAirUpdate: false,
  ReportReceivedDate: '06/15/2020',
  Component: 'ENGINE AND ENGINE COOLING',
  Summary: 'The engine may have been assembled with insufficient bearing oil clearance.',
  Consequence: 'Engine bearing failure could result in a loss of engine power.',
  Remedy: 'Dealers will inspect and replace the engine short block, free of charge.',
  Notes: 'Owners may contact Subaru customer service.',
};

/** The shape actually stored today — five fields, no remedy. */
const FROM_STORAGE = {
  Summary: 'The rearview camera image may fail to display.',
  Component: 'BACK OVER PREVENTION',
  Consequence: 'Reduced rear visibility increases the risk of a crash.',
  ReportReceivedDate: '03/02/2019',
  NHTSACampaignNumber: '19V098000',
};

describe('severityOf', () => {
  it('escalates a do-not-drive recall', () => {
    expect(severityOf({ ...FROM_API, parkIt: true })).toBe('do-not-drive');
  });

  it('escalates a park-outside recall', () => {
    expect(severityOf({ ...FROM_API, parkOutSide: true })).toBe('park-outside');
  });

  it('ranks do-not-drive above park-outside when both are set', () => {
    expect(severityOf({ parkIt: true, parkOutSide: true })).toBe('do-not-drive');
  });

  it('reads NHTSA booleans sent as strings', () => {
    // Stored payloads carry strings where the API sends booleans.
    expect(severityOf({ parkIt: 'true' })).toBe('do-not-drive');
  });

  it('does NOT escalate on the string "false"', () => {
    // The bug this function exists to prevent: `"false"` is truthy, so a naive
    // check puts a do-not-drive banner on every recall, and the banner stops
    // meaning anything.
    expect(severityOf({ parkIt: 'false', parkOutSide: 'false' })).toBe('standard');
  });

  it('treats a missing flag as standard', () => {
    expect(severityOf(FROM_STORAGE)).toBe('standard');
  });
});

describe('parseRecallDate', () => {
  /*
    ── ⚠ The stored corpus holds **both** date orders ─────────────────────────

    Counted across the live `nhtsa_data` rows on 23 Aug: of 29 dates in
    `d/d/YYYY` form, 17 can only be day-first, 3 can only be month-first, and 9
    are ambiguous. So a fixed reading is wrong for part of the data whichever
    one is chosen — which is how the M235i's card came to render
    `Issued 2025-17-12`, a month that does not exist, from `17/12/2025`.
  */

  it('reads a date that can only be month-first', () => {
    // 15 is not a month. `new Date("06/15/2020")` is also locale-dependent in
    // exactly the way that turns 6 June into 15 June, so it is parsed here.
    expect(parseRecallDate('06/15/2020')).toBe('2020-06-15');
  });

  it('reads a date that can only be day-first — the M235i case', () => {
    expect(parseRecallDate('17/12/2025')).toBe('2025-12-17');
    expect(parseRecallDate('24/04/2024')).toBe('2024-04-24');
  });

  it('refuses an ambiguous date rather than flipping a coin', () => {
    /*
      §10. Both fields under 13 and no batch to learn from: this date is
      readable two ways and we cannot say which. A missing "Issued" line costs
      an owner nothing; a transposed one tells them a 2019 campaign was issued
      last month.
    */
    expect(parseRecallDate('3/2/2019')).toBeNull();
    expect(parseRecallDate('01/01/2026')).toBeNull();
  });

  it('takes the order from its batch when it cannot tell alone', () => {
    expect(parseRecallDate('3/2/2019', 'day-first')).toBe('2019-02-03');
    expect(parseRecallDate('3/2/2019', 'month-first')).toBe('2019-03-02');
  });

  it('lets a record overrule the batch when it can only read one way', () => {
    // A 17 in the first field is a day whatever the rest of the batch said.
    expect(parseRecallDate('17/12/2025', 'month-first')).toBe('2025-12-17');
  });

  it('passes an ISO date through', () => {
    expect(parseRecallDate('2020-06-15T00:00:00Z')).toBe('2020-06-15');
  });

  it('rejects a date that is not a day, however it was assembled', () => {
    /*
      ⚠ Round-tripped rather than range-checked, and this is the assertion that
      would have stopped `2025-17-12` leaving this file at all. Every layer
      downstream rendered that string faithfully; none of them could have
      caught it.
    */
    expect(parseRecallDate('2025-17-12')).toBeNull();
    expect(parseRecallDate('2025-02-31')).toBeNull();
    expect(parseRecallDate('31/02/2025', 'day-first')).toBeNull();
  });

  it.each([['nonsense', 'sometime in 2020'], ['empty', ''], ['a number', 20200615], ['null', null]])(
    'returns null rather than guessing at %s',
    (_label, value) => {
      expect(parseRecallDate(value)).toBeNull();
    }
  );
});

describe('inferDateOrder', () => {
  it('learns the order from the records that can only read one way', () => {
    expect(inferDateOrder(['06/03/2019', '24/04/2024'])).toBe('day-first');
    expect(inferDateOrder(['06/03/2019', '06/15/2020'])).toBe('month-first');
  });

  it('says unknown when nothing in the batch disambiguates', () => {
    expect(inferDateOrder(['01/01/2026', '03/02/2019'])).toBe('unknown');
    expect(inferDateOrder([])).toBe('unknown');
  });

  it('says unknown when the batch disagrees with itself', () => {
    /*
      ⚠ Not a majority vote. Two formats in one response means the assumption
      that a response has *a* format is already false, and voting would produce
      a confident answer out of evidence that has contradicted itself.
    */
    expect(inferDateOrder(['24/04/2024', '06/15/2020'])).toBe('unknown');
  });
});

describe('normaliseRecall', () => {
  it('carries every field the API provides', () => {
    const recall = normaliseRecall(FROM_API)!;

    expect(recall.campaignNumber).toBe('20V123000');
    expect(recall.remedy).toContain('short block');
    expect(recall.manufacturer).toContain('Subaru');
    expect(recall.reportedOn).toBe('2020-06-15');
  });

  it('copes with the poorer stored shape', () => {
    const recall = normaliseRecall(FROM_STORAGE)!;

    expect(recall.summary).toContain('rearview camera');
    expect(recall.remedy).toBeNull();
    expect(recall.severity).toBe('standard');
  });

  it('reads the older lowercase spellings the demo rows use', () => {
    // `app/actions.ts` already reads `Summary || description`; dropping one
    // would empty the demo cars' recall list.
    const recall = normaliseRecall({ description: 'Something', component: 'BRAKES' })!;

    expect(recall.summary).toBe('Something');
    expect(recall.component).toBe('BRAKES');
  });

  it('drops a record with nothing to say', () => {
    // A blank card with a campaign number is not information, and "3 open
    // recalls" should mean three things worth reading.
    expect(normaliseRecall({ NHTSACampaignNumber: '20V123000' })).toBeNull();
  });

  it.each([['null', null], ['a string', 'recall'], ['a number', 7]])(
    'returns null for %s',
    (_label, raw) => {
      expect(normaliseRecall(raw)).toBeNull();
    }
  );

  it('treats a whitespace-only field as absent', () => {
    const recall = normaliseRecall({ Summary: 'Real', Remedy: '   ' })!;

    expect(recall.remedy).toBeNull();
  });
});

describe('normaliseRecalls', () => {
  it('puts a do-not-drive recall first even when it is the oldest', () => {
    // The ordering mistake that gets someone hurt.
    const list = normaliseRecalls([
      { ...FROM_STORAGE, Summary: 'Trim clip', ReportReceivedDate: '01/01/2026' },
      { ...FROM_API, Summary: 'Fuel pump', parkIt: true, ReportReceivedDate: '01/01/2019' },
    ]);

    expect(list[0].summary).toBe('Fuel pump');
    expect(list[0].severity).toBe('do-not-drive');
  });

  it('orders by recency within a severity band', () => {
    const list = normaliseRecalls([
      /*
        ⚠ Unambiguous on purpose. `01/01/2019` reads identically either way, so
        both dates would be refused and this would be asserting insertion order
        under the name of recency — vacuous in exactly the shape §5 warns about.
      */
      { ...FROM_STORAGE, Summary: 'Older', ReportReceivedDate: '15/01/2019' },
      { ...FROM_STORAGE, Summary: 'Newer', ReportReceivedDate: '15/01/2026' },
    ]);

    expect(list.map((r) => r.summary)).toEqual(['Newer', 'Older']);
  });

  it('drops unusable entries without losing the good ones', () => {
    const list = normaliseRecalls([FROM_API, null, { NHTSACampaignNumber: 'x' }, FROM_STORAGE]);

    expect(list).toHaveLength(2);
  });

  it.each([['undefined', undefined], ['null', null], ['an object', {}]])(
    'returns an empty list for %s',
    (_label, raw) => {
      expect(normaliseRecalls(raw)).toEqual([]);
    }
  );
});

describe('hasRemedy', () => {
  it('is true when the remedy survived', () => {
    expect(hasRemedy(normaliseRecall(FROM_API)!)).toBe(true);
  });

  it('is false for a stored row that predates the field', () => {
    // The screen asks this before drawing "How it gets fixed". An empty
    // section reads as "nobody knows how to fix this".
    expect(hasRemedy(normaliseRecall(FROM_STORAGE)!)).toBe(false);
  });
});

describe('worstSeverity', () => {
  it('reports the most severe recall on the vehicle', () => {
    const list = normaliseRecalls([FROM_STORAGE, { ...FROM_API, parkOutSide: true }]);

    expect(worstSeverity(list)).toBe('park-outside');
  });

  it('returns null for a car with no recalls', () => {
    // Not a reassuring badge. "No recalls" is a claim about NHTSA's
    // completeness that this app cannot make.
    expect(worstSeverity([])).toBeNull();
  });
});
