/**
 * A service-due figure has to say what it rests on.
 *
 * @jest-environment node
 *
 * This app has rendered a provenance claim it could not substantiate twice —
 * `ae45710`'s fabricated "AI Verified" records, and the unconditional "AI
 * Extracted" badge that survived that clean-up and shipped to the public demo
 * on hand-typed and seeded rows. `provenance-claims.test.ts` holds the line on
 * that page; this holds it on the milestone screen, and it does so by deriving
 * every claim from `evaluateSchedule`'s own `basedOnHistory` flag rather than
 * letting a badge be written next to the data.
 *
 * The rule worth protecting is the mixed case: a milestone is only as
 * well-founded as its weakest service.
 */

import {
  SCHEDULE_BASIS_LABELS,
  SERVICE_BASIS_LABELS,
  isServiceBasis,
  milestoneBasis,
  serviceBasis,
} from '@crewchief/core/service-provenance';
import { evaluateSchedule, type ScheduleEntry } from '@crewchief/core/service-due';

const OIL: ScheduleEntry = {
  service: 'Engine oil and filter',
  interval_miles: 7_500,
  priority: 'Critical',
};

const PLUGS: ScheduleEntry = { service: 'Spark plugs', interval_miles: 30_000 };

describe('serviceBasis', () => {
  it('claims service records only when there are service records', () => {
    expect(serviceBasis(true)).toBe('service-history');
    expect(serviceBasis(false)).toBe('mileage-estimate');
  });

  it('derives from what evaluateSchedule actually computed', () => {
    // The point of the whole module: the claim is a function of the data, so
    // there is no second place a badge could assert something else.
    const [fromHistory] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => 58_000,
    });
    const [fromOdometer] = evaluateSchedule({ schedule: [OIL], currentMileage: 60_000 });

    expect(serviceBasis(fromHistory.basedOnHistory)).toBe('service-history');
    expect(serviceBasis(fromOdometer.basedOnHistory)).toBe('mileage-estimate');
  });
});

describe('milestoneBasis', () => {
  it('claims service records when every service has them', () => {
    const services = evaluateSchedule({
      schedule: [OIL, PLUGS],
      currentMileage: 60_000,
      lastServiceMileage: () => 55_000,
    });

    expect(milestoneBasis(services)).toBe('service-history');
  });

  it('falls back to estimated when even one service lacks them', () => {
    // The case this exists for. Three logged and one estimated must not read
    // as "from your service records" — a reader takes that as covering the lot.
    const services = evaluateSchedule({
      schedule: [OIL, PLUGS],
      currentMileage: 60_000,
      lastServiceMileage: (service) => (service === 'Spark plugs' ? 30_000 : null),
    });

    expect(services.some((s) => s.basedOnHistory)).toBe(true);
    expect(milestoneBasis(services)).toBe('mileage-estimate');
  });

  it('reports the weaker claim for an empty milestone', () => {
    expect(milestoneBasis([])).toBe('mileage-estimate');
  });
});

describe('the wording', () => {
  it('does not claim a manufacturer document the app does not hold', () => {
    // The prompt asks the model for "manufacturer-recommended" intervals and
    // the model will happily claim them. We hold a model's account of one, not
    // the document. The weaker word is the true one.
    const label = SCHEDULE_BASIS_LABELS['generated-schedule'];

    expect(label).not.toMatch(/manufacturer/i);
    expect(label).toMatch(/AI-generated/i);
  });

  it('says out loud that an estimate is an estimate', () => {
    expect(SERVICE_BASIS_LABELS['mileage-estimate']).toMatch(/estimated/i);
  });

  it('gives every basis a label, so a client can never render a blank chip', () => {
    for (const basis of ['service-history', 'mileage-estimate'] as const) {
      expect(SERVICE_BASIS_LABELS[basis]).toEqual(expect.any(String));
      expect(SERVICE_BASIS_LABELS[basis].length).toBeGreaterThan(0);
    }
  });
});

describe('isServiceBasis', () => {
  it('accepts the two real values', () => {
    expect(isServiceBasis('service-history')).toBe(true);
    expect(isServiceBasis('mileage-estimate')).toBe(true);
  });

  it.each([['a third value', 'dealer-records'], ['undefined', undefined], ['null', null], ['a number', 1]])(
    'rejects %s',
    (_label, value) => {
      // A server that has shipped a third basis to a phone that has not been
      // updated must render nothing, not an undefined label.
      expect(isServiceBasis(value)).toBe(false);
    }
  );
});
