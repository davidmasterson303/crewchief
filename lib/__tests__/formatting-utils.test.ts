import {
  formatCurrency,
  formatDate,
  formatMileage,
  formatHours,
  formatPercentage,
  truncateString,
  capitalizeWords,
  slugify
} from '@wellkept/core/formatting-utils';

describe('Formatting Utils', () => {
  describe('formatCurrency', () => {
    it('should format currency correctly', () => {
      expect(formatCurrency(1000)).toBe('$1,000');
      expect(formatCurrency(1500.50)).toBe('$1,500.5');
      expect(formatCurrency(0)).toBe('$0');
    });

    it('should handle negative numbers', () => {
      expect(formatCurrency(-100)).toBe('-$100');
    });
  });

  describe('formatMileage', () => {
    it('should format mileage with commas', () => {
      expect(formatMileage(1000)).toBe('1,000');
      expect(formatMileage(50000)).toBe('50,000');
      expect(formatMileage(1234567)).toBe('1,234,567');
    });
  });

  describe('formatHours', () => {
    it('should format hours correctly', () => {
      expect(formatHours(1)).toBe('1 hour');
      expect(formatHours(2.5)).toBe('2.5 hours');
      expect(formatHours(10)).toBe('10.0 hours');
    });
  });

  describe('formatPercentage', () => {
    it('should format percentage correctly', () => {
      expect(formatPercentage(50)).toBe('50%');
      expect(formatPercentage(33.333, 2)).toBe('33.33%');
      expect(formatPercentage(100)).toBe('100%');
    });
  });

  describe('truncateString', () => {
    it('should truncate long strings', () => {
      expect(truncateString('Hello World', 5)).toBe('Hello...');
      expect(truncateString('Hi', 5)).toBe('Hi');
      expect(truncateString('Testing truncation', 10)).toBe('Testing tr...');
    });
  });

  describe('capitalizeWords', () => {
    it('should capitalize words correctly', () => {
      expect(capitalizeWords('hello world')).toBe('Hello World');
      expect(capitalizeWords('MAINTENANCE SCHEDULE')).toBe('Maintenance Schedule');
      expect(capitalizeWords('test')).toBe('Test');
    });
  });

  describe('slugify', () => {
    it('should convert strings to slugs', () => {
      expect(slugify('Hello World')).toBe('hello-world');
      expect(slugify('Test  Multiple Spaces')).toBe('test-multiple-spaces');
      expect(slugify('Special@Characters#Here')).toBe('specialcharactershere');
    });
  });
});

describe('a calendar date renders as the day it names', () => {
  /*
    ── ⚠ The defect, and why it never showed up as an error ──────────────────

    `new Date('2025-01-20')` is parsed by the spec as **UTC midnight**, and
    `toLocaleDateString` renders it in the reader's zone — so anywhere west of
    Greenwich it printed *Jan 19*. `service_date` is a `date` column: the
    invoice says the 20th and the app said the 19th, silently, off by exactly
    one, for every service record in the product.

    `garage-next-service.ts` hit it, fixed it for its own row, and wrote down
    that the general case was still broken. This is the general case.

    ⚠ The zone is pinned rather than left to the machine. Run in UTC — which is
    what CI does — the bug is invisible, so a test that did not set a
    negative-offset zone would pass against the broken implementation.
  */
  const inZone = (tz: string, run: () => string) => {
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try {
      return run();
    } finally {
      process.env.TZ = previous;
    }
  };

  it('does not shift a date-only string west of Greenwich', () => {
    expect(inZone('America/Los_Angeles', () => formatDate('2025-01-20'))).toBe('Jan 20, 2025');
    expect(inZone('America/New_York', () => formatDate('2025-01-20'))).toBe('Jan 20, 2025');
  });

  it('does not shift it east of Greenwich either', () => {
    // The other direction rolls a date *forward* — 1 Jan would render as 2 Jan
    // in Tokyo if the parts were taken from a UTC instant.
    expect(inZone('Asia/Tokyo', () => formatDate('2025-01-01'))).toBe('Jan 1, 2025');
  });

  it('still treats a full timestamp as an instant', () => {
    /*
      The half that must not change. A timestamp genuinely is a moment, and
      rendering it in the reader's zone is correct — trading one off-by-one for
      another would be no fix at all. 02:00 UTC is the previous evening in Los
      Angeles, and that is the right answer.
    */
    expect(inZone('America/Los_Angeles', () => formatDate('2025-01-20T02:00:00Z'))).toBe(
      'Jan 19, 2025'
    );
  });
});
