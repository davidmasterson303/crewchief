import { extractJSON, VehicleDataSchema } from '@wellkept/core/vehicle-utils';

describe('Vehicle Utils', () => {
  describe('extractJSON', () => {
    it('should extract JSON from plain object', () => {
      const input = '{"key": "value"}';
      const result = extractJSON(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('should extract JSON from code block', () => {
      const input = '```json\n{"name": "test"}\n```';
      const result = extractJSON(input);
      expect(result).toEqual({ name: 'test' });
    });

    it('should extract JSON with surrounding text', () => {
      const input = 'Here is the data: {"status": "ok"} and that\'s it';
      const result = extractJSON(input);
      expect(result).toEqual({ status: 'ok' });
    });

    it('should extract array JSON', () => {
      const input = '[1, 2, 3]';
      const result = extractJSON(input);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should throw error on invalid JSON', () => {
      const input = 'no json here';
      expect(() => extractJSON(input)).toThrow();
    });
  });

  describe('VehicleDataSchema', () => {
    it('should validate correct vehicle data', () => {
      const data = {
        known_issues: [
          {
            part: 'engine',
            mileage_range: '100k-150k',
            severity: 'High',
            description: 'Timing belt wear'
          }
        ],
        maintenance_schedule: [
          {
            item: 'oil change',
            interval: 'every 5k miles',
            priority: 'Critical'
          }
        ],
        fluid_specs: {
          engine_oil: '5W-30',
        },
        reliability_score: 8
      };

      const result = VehicleDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should provide defaults for missing fields', () => {
      const data = {};
      const result = VehicleDataSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.known_issues).toEqual([]);
        expect(result.data.maintenance_schedule).toEqual([]);
      }
    });

    it('should reject invalid severity', () => {
      const data = {
        known_issues: [
          {
            part: 'engine',
            mileage_range: '100k-150k',
            severity: 'Invalid',
            description: 'test'
          }
        ]
      };

      const result = VehicleDataSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
