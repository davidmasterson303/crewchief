/**
 * The next service a car needs, and where it is written down.
 *
 * @jest-environment node
 *
 * Two halves. `nextService` is a fact and is executed; the sweep's write-back
 * is a static read of the route, for the reason `create-vehicle-route.test.ts`
 * gives — running it needs a live Supabase, and the property worth pinning is
 * an **ordering** that is invisible at runtime until most of a garage is blank.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { evaluateSchedule, nextService } from '@crewchief/core/service-due';

const ROOT = join(__dirname, '..', '..');

const SCHEDULE = [
  { service: 'Engine oil and filter', interval_miles: 7_500, priority: 'Critical' as const },
  { service: 'Brake fluid', interval_months: 24, priority: 'Recommended' as const },
  { service: 'Cabin filter', interval_miles: 20_000, priority: 'Optional' as const },
];

const evaluate = (currentMileage: number, lastByService: Record<string, number> = {}) =>
  evaluateSchedule({
    schedule: SCHEDULE,
    currentMileage,
    today: '2026-08-15',
    lastServiceMileage: (service) => lastByService[service] ?? null,
  });

describe('nextService', () => {
  it('answers even when nothing is due for a very long time', () => {
    /*
      ⚠ The reason this is not `nextMilestone` with a bigger horizon. That
      returns null past its window, which is right for a notification and wrong
      for a garage row — a card reading "Next service" must not go blank
      because the answer is reassuring.
    */
    const services = evaluate(100, { 'Engine oil and filter': 0 });
    const next = nextService(services);

    expect(next).not.toBeNull();
    expect(next?.service).toBe('Engine oil and filter');
    expect(next?.dueAtMiles).toBe(7_500);
  });

  it('puts the most urgent service first, not the nearest one', () => {
    // An overdue critical outranks a cabin filter that happens to fall sooner.
    const services = evaluate(30_000, {
      'Engine oil and filter': 20_000,
      'Cabin filter': 29_000,
    });

    expect(nextService(services)?.service).toBe('Engine oil and filter');
  });

  it('never names a service it has no record to count from', () => {
    /*
      A time-only service with no date has no due point. Calling it "next"
      would invent one — the same lie `nextMilestone` refuses, and the reason
      `unknown` is excluded rather than sorted last.
    */
    const services = evaluateSchedule({
      schedule: [{ service: 'Brake fluid', interval_months: 24 }],
      currentMileage: 50_000,
      today: '2026-08-15',
    });

    expect(services[0].status).toBe('unknown');
    expect(nextService(services)).toBeNull();
  });

  it('returns null rather than a zero for a car with no usable schedule', () => {
    // The caller must render this as "no schedule yet", never "nothing due".
    expect(nextService([])).toBeNull();
  });
});

/**
 * Source with comments removed — this route's own comments discuss the ordering
 * at length, which is good writing and a bad substring.
 */
const sweep = readFileSync(
  join(ROOT, 'app', 'api', 'internal', 'notify-sweep', 'route.ts'),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

describe('the sweep stores the next service', () => {
  it('writes it at all', () => {
    expect(sweep).toMatch(/next_service_label/);
    expect(sweep).toMatch(/next_service_at_miles/);
    expect(sweep).toMatch(/next_service_updated_at/);
  });

  it('writes it BEFORE the notification gate', () => {
    /*
      ⚠ The property this file exists for, and it is invisible at runtime until
      someone notices most of the garage has no next service.

      `shouldRaiseService` decides whether a notification is worth sending, and
      the function returns early when it is not. A write placed after that gate
      would only ever run for cars that earned a notification — which is most of
      the garage left blank, by a one-line ordering mistake nothing else catches.
    */
    // The **call**, not the import at the top of the file — which is what the
    // first version of this assertion measured against, and it passed.
    const write = sweep.indexOf('next_service_label');
    const gate = sweep.indexOf('shouldRaiseService({');

    expect(write).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(write).toBeLessThan(gate);
  });

  it('asks what is next rather than what is worth raising', () => {
    // `nextMilestone` is the notification judgement and keeps its horizon; the
    // stored row is a fact and must not inherit that window.
    expect(sweep).toMatch(/nextService\(services\)/);
  });

  it('does not let a failed write cost a notification', () => {
    // The sweep's actual job is reaching people. A storage failure is logged
    // and stepped over, never thrown.
    expect(sweep).toMatch(/nextServiceError/);
    expect(sweep).not.toMatch(/throw new Error\(nextServiceError/);
  });
});

describe('the migration that makes room for it', () => {
  const migration = readFileSync(
    join(
      ROOT,
      'supabase',
      'migrations',
      '20260815190000_the_garage_row_needs_a_next_service.sql'
    ),
    'utf8'
  );

  it('is additive and nullable — a car with no schedule has no next service', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS next_service_label text/);
    expect(migration).not.toMatch(/NOT NULL/);
    expect(migration).not.toMatch(/DROP|DELETE|TRUNCATE/);
  });

  it('makes no prediction about the dashboard modal', () => {
    /*
      Four headers have predicted it and all four were wrong. The rule since
      15 Aug is to state what the migration *does* and leave the vendor
      heuristic to whoever is watching the screen.
    */
    expect(migration).not.toMatch(/modal will (not )?fire/i);
  });
});
