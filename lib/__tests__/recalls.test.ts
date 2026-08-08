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
  normaliseRecall,
  normaliseRecalls,
  parseRecallDate,
  severityOf,
  worstSeverity,
} from '@crewchief/core/recalls';

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
  it('reads NHTSA’s MM/DD/YYYY without letting the runtime guess', () => {
    // `new Date("06/15/2020")` is locale-dependent in exactly the way that
    // turns 6 June into 15 June, and the date is how the list is ordered.
    expect(parseRecallDate('06/15/2020')).toBe('2020-06-15');
  });

  it('pads a single-digit month and day', () => {
    expect(parseRecallDate('3/2/2019')).toBe('2019-03-02');
  });

  it('passes an ISO date through', () => {
    expect(parseRecallDate('2020-06-15T00:00:00Z')).toBe('2020-06-15');
  });

  it.each([['nonsense', 'sometime in 2020'], ['empty', ''], ['a number', 20200615], ['null', null]])(
    'returns null rather than guessing at %s',
    (_label, value) => {
      expect(parseRecallDate(value)).toBeNull();
    }
  );
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
      { ...FROM_STORAGE, Summary: 'Older', ReportReceivedDate: '01/01/2019' },
      { ...FROM_STORAGE, Summary: 'Newer', ReportReceivedDate: '01/01/2026' },
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
