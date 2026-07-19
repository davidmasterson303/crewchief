import {
  formatCurrency,
  formatDate,
  formatMileage,
  formatHours,
  formatPercentage,
  truncateString,
  capitalizeWords,
  slugify
} from '../formatting-utils';

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
