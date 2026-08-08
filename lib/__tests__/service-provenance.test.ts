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
    expect(serviceBasis('records')).toBe('service-history');
    expect(serviceBasis(null)).toBe('mileage-estimate');
  });

  it('does not let a remembered date pass as a record', () => {
    // Track A2a. An invoice is evidence; an onboarding answer is a
    // recollection. Both beat nothing, and only one is a document.
    expect(serviceBasis('owner-reported')).toBe('owner-reported');
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
    const [fromOwner] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => 58_000,
      lastServiceEvidence: () => 'owner-reported',
    });

    expect(serviceBasis(fromHistory.evidence)).toBe('service-history');
    expect(serviceBasis(fromOdometer.evidence)).toBe('mileage-estimate');
    expect(serviceBasis(fromOwner.evidence)).toBe('owner-reported');
  });

  it('reports no evidence when nothing was found, whatever the caller says', () => {
    /*
      The failure this rules out: a caller that supplies `lastServiceEvidence`
      for every service in the schedule, including the ones whose mileage and
      date lookups came back empty. Reading the evidence unconditionally would
      stamp a provenance label onto a figure resting on nothing — a badge
      asserting a source that does not exist, which is the defect
      `provenance-claims.test.ts` was written after.
    */
    const [nothingFound] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => null,
      lastServiceEvidence: () => 'owner-reported',
    });

    expect(nothingFound.evidence).toBeNull();
    expect(serviceBasis(nothingFound.evidence)).toBe('mileage-estimate');
  });

  it('defaults to records, so callers written before A2a do not get downgraded', () => {
    // Every caller that existed before the baseline question supplied history
    // from invoice-extracted rows. Treating a missing `lastServiceEvidence` as
    // "no evidence" would silently weaken every claim already shipping.
    const [legacy] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => 58_000,
    });

    expect(legacy.evidence).toBe('records');
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

  it('reports owner-reported when an invoice is mixed with a recollection', () => {
    /*
      Track A2a, and the same "weakest link" rule with a third rung on the
      ladder. A visit resting partly on a document and partly on what someone
      remembered at sign-up cannot claim to come from records — but calling it
      a bare estimate would throw away a real baseline the owner gave us. The
      middle claim is the only true one.
    */
    const services = evaluateSchedule({
      schedule: [OIL, PLUGS],
      currentMileage: 60_000,
      lastServiceMileage: () => 55_000,
      lastServiceEvidence: (service) =>
        service === 'Spark plugs' ? 'owner-reported' : 'records',
    });

    expect(milestoneBasis(services)).toBe('owner-reported');
  });

  it('still falls to an estimate when one service rests on nothing', () => {
    // A remembered baseline does not rescue a service that has neither. One
    // unknown drags the whole visit down, exactly as before.
    const services = evaluateSchedule({
      schedule: [OIL, PLUGS],
      currentMileage: 60_000,
      lastServiceMileage: (service) => (service === 'Spark plugs' ? 30_000 : null),
      lastServiceEvidence: () => 'owner-reported',
    });

    expect(milestoneBasis(services)).toBe('mileage-estimate');
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
    for (const basis of ['service-history', 'owner-reported', 'mileage-estimate'] as const) {
      expect(SERVICE_BASIS_LABELS[basis]).toEqual(expect.any(String));
      expect(SERVICE_BASIS_LABELS[basis].length).toBeGreaterThan(0);
    }
  });
});

describe('isServiceBasis', () => {
  it('accepts every real value', () => {
    /*
      All three, and `owner-reported` matters most here: it is the newest, and
      the narrowing is what stands between the phone and an undefined label.
      A value the server can send that this cannot recognise renders as
      nothing — correct behaviour for an *unknown* basis, and silent data loss
      for one we shipped and forgot to list.
    */
    expect(isServiceBasis('service-history')).toBe(true);
    expect(isServiceBasis('owner-reported')).toBe(true);
    expect(isServiceBasis('mileage-estimate')).toBe(true);
  });

  it('recognises exactly the values that have labels', () => {
    // Guards the pairing rather than either side. The failure it pins is a
    // basis added to the union and the labels but not to the narrowing — the
    // phone would then drop a chip the server considers valid, which looks
    // like a rendering bug and is a missing `||`.
    for (const basis of Object.keys(SERVICE_BASIS_LABELS)) {
      expect(isServiceBasis(basis)).toBe(true);
    }
  });

  it.each([['an unknown value', 'dealer-records'], ['undefined', undefined], ['null', null], ['a number', 1]])(
    'rejects %s',
    (_label, value) => {
      // A server that has shipped a third basis to a phone that has not been
      // updated must render nothing, not an undefined label.
      expect(isServiceBasis(value)).toBe(false);
    }
  );
});
