/**
 * What a service-history row claims, and on whose word.
 *
 * @jest-environment node
 *
 * A history list is where provenance stops being an abstraction: four rows in
 * one column, identical in weight, read as four equally solid facts. One of
 * them may be a recollection given on a sign-up screen.
 *
 * `20260808150000` added `'owner-onboarding'` rather than reusing `'manual'`
 * for exactly this reason — *"An invoice is evidence. 'I think it was around
 * 85,000' is a recollection."* These tests are that distinction surviving
 * contact with a UI.
 */

import {
  RECORD_SOURCE_LABELS,
  describeRecord,
  describeRemoval,
  formatRecordDate,
  isRecollection,
  recordSourceLabel,
  totalRecorded,
} from '@wellkept/core/service-record';

describe('recordSourceLabel', () => {
  it('names every source the schema permits', () => {
    /*
      Anchored to the CHECK constraint's vocabulary. A migration widening it
      without widening this map would otherwise ship a row the UI silently
      declines to attribute.
    */
    for (const source of ['vision', 'manual', 'seed', 'owner-onboarding']) {
      expect(recordSourceLabel(source)).toBeTruthy();
    }
  });

  it('says nothing rather than guessing when the source is absent', () => {
    /*
      Rows predate the column — `20260801120000` added it — so an unattributed
      row is *old*, not suspicious. Inventing an attribution for it is the exact
      failure the column exists to prevent.
    */
    expect(recordSourceLabel(null)).toBeNull();
    expect(recordSourceLabel(undefined)).toBeNull();
  });

  it('says nothing for a value it does not recognise', () => {
    // Better an unlabelled row than a confident wrong label.
    expect(recordSourceLabel('imported-from-somewhere')).toBeNull();
    expect(recordSourceLabel('')).toBeNull();
  });

  it('does not let a prototype key masquerade as a source', () => {
    // `RECORD_SOURCE_LABELS` is an object literal, so `['constructor']` is a
    // truthy function. A membership test by truthiness would return it.
    expect(recordSourceLabel('constructor')).toBeNull();
    expect(recordSourceLabel('toString')).toBeNull();
  });

  it('distinguishes an invoice from a recollection in the words themselves', () => {
    /*
      The load-bearing assertion. If these two ever read alike, the UI has
      stopped making the distinction the schema went to the trouble of storing.
    */
    expect(RECORD_SOURCE_LABELS.vision).not.toBe(RECORD_SOURCE_LABELS['owner-onboarding']);
    expect(RECORD_SOURCE_LABELS.vision.toLowerCase()).toContain('invoice');
    expect(RECORD_SOURCE_LABELS['owner-onboarding'].toLowerCase()).toContain('told us');
  });

  it('says plainly when a row is example data', () => {
    // The demo garage is the recruiter-facing surface. Fiction presented as
    // record is worse there than anywhere else.
    expect(RECORD_SOURCE_LABELS.seed.toLowerCase()).toContain('example');
  });
});

describe('isRecollection', () => {
  it('is true only for the onboarding answer', () => {
    expect(isRecollection('owner-onboarding')).toBe(true);
    expect(isRecollection('vision')).toBe(false);
    expect(isRecollection('manual')).toBe(false);
    expect(isRecollection(null)).toBe(false);
  });
});

describe('describeRecord', () => {
  it('reads as when, at what mileage, and by whom', () => {
    expect(
      describeRecord({
        service_date: '2026-02-10',
        mileage_at_service: 58_000,
        shop_name: "Ken's Auto",
      })
    ).toBe("10 Feb 2026 · 58,000 miles · Ken's Auto");
  });

  it('omits an absent fact rather than filling it', () => {
    expect(describeRecord({ service_date: '2026-02-10' })).toBe('10 Feb 2026');
    expect(describeRecord({})).toBe('');
  });

  it("does not print 'Unknown' as though it were a shop", () => {
    /*
      The completion route defaults `shop_name` to `'Unknown'` when none was
      given. Printed in a list that reads as a fact about the shop rather than
      as the absence of one — so it is treated as absence, which is what it is.
    */
    expect(describeRecord({ service_date: '2026-02-10', shop_name: 'Unknown' })).toBe(
      '10 Feb 2026'
    );
    expect(describeRecord({ service_date: '2026-02-10', shop_name: 'unknown' })).toBe(
      '10 Feb 2026'
    );
  });

  it('omits a zero or missing mileage rather than claiming the odometer read zero', () => {
    expect(describeRecord({ service_date: '2026-02-10', mileage_at_service: 0 })).toBe(
      '10 Feb 2026'
    );
    expect(describeRecord({ service_date: '2026-02-10', mileage_at_service: null })).toBe(
      '10 Feb 2026'
    );
  });
});

describe('formatRecordDate', () => {
  it('renders a stored date without shifting the day', () => {
    /*
      Formatted in UTC on purpose. `new Date('2026-02-10')` is midnight UTC, and
      rendering it in a timezone behind UTC prints the 9th — a service record
      that moves a day depending on where it is read.
    */
    expect(formatRecordDate('2026-02-10')).toBe('10 Feb 2026');
    expect(formatRecordDate('2026-02-10T23:30:00Z')).toBe('10 Feb 2026');
  });

  it('returns null rather than echoing something that is not a date', () => {
    expect(formatRecordDate('last spring')).toBeNull();
    expect(formatRecordDate('')).toBeNull();
    expect(formatRecordDate(null)).toBeNull();
  });
});

describe('totalRecorded', () => {
  it('reports how many rows the total covers, not just the total', () => {
    /*
      A total over four of nine rows is a different number from a total over
      nine. Returning the count is what lets the UI avoid presenting the first
      as though it were the second.
    */
    const result = totalRecorded([
      { total_cost: 152 },
      { total_cost: 678 },
      { total_cost: null },
      {},
    ]);

    expect(result).toEqual({ total: 830, counted: 2 });
  });

  it('skips a zero rather than counting it as a recorded cost', () => {
    // A completion with no cost stores 0. Counting it would claim the job was
    // free and drag an average down with a figure nobody entered.
    expect(totalRecorded([{ total_cost: 0 }, { total_cost: 100 }])).toEqual({
      total: 100,
      counted: 1,
    });
  });

  it('is zero over nothing rather than NaN', () => {
    expect(totalRecorded([])).toEqual({ total: 0, counted: 0 });
  });
});

describe('describeRemoval', () => {
  /*
    Removing a service record is irreversible, and none of its consequences are
    visible on the row. "Are you sure?" asks a question the person has no way to
    answer; these sentences are the answer.
  */

  it('always says the schedule reads these rows', () => {
    /*
      The consequence that reaches beyond the list. A service's next due date is
      counted from the last record of it, so removing the only record makes the
      job look never-done.
    */
    expect(describeRemoval({}).toLowerCase()).toContain('due date');
  });

  it('reassures that a scanned invoice survives', () => {
    /*
      The difference between a correction and a loss. `delete-maintenance-item`
      touches `maintenance_line_items` only — `vehicle_documents` is untouched,
      so the row can be recreated by re-scanning.
    */
    const text = describeRemoval({ source: 'vision', source_document_id: 'doc-1' });
    expect(text.toLowerCase()).toContain('invoice');
    expect(text.toLowerCase()).toContain('again');
  });

  it('does not promise an invoice that is not there', () => {
    // A manually completed row has no document behind it. Saying one survives
    // would be a reassurance about something that never existed.
    expect(describeRemoval({ source: 'manual' }).toLowerCase()).not.toContain('invoice');
    expect(describeRemoval({ source: 'vision' }).toLowerCase()).not.toContain('invoice');
  });

  it('warns that a combined row takes its parts with it', () => {
    /*
      Invoice extraction merges a labour line with its matching parts into one
      record, so a £678 row titled "Front brake pads & rotors, replace" may be
      labour plus three parts lines. Removing it removes all of them.
    */
    expect(describeRemoval({ is_combined: true }).toLowerCase()).toContain('parts');
  });

  it('says nothing about parts for an ordinary row', () => {
    expect(describeRemoval({ is_combined: false }).toLowerCase()).not.toContain('labour and its parts');
  });
});
