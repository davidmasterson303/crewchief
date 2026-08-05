/**
 * Drilling into a vehicle must not lose facts the list already showed.
 *
 * @jest-environment node
 *
 * `/api/v1/vehicles` selects `nhtsa_data(recalls)` and
 * `vehicle_health_summary(...)`. `/api/v1/load-vehicle` selected neither — so
 * `VehicleDetailScreen` declared both, derived a band and a recall count from
 * them, and rendered a Health card and a recall card **that could never
 * appear**. Tapping a garage card reading "70 · FAIR · 2 recalls" opened a
 * screen showing no score and no recalls.
 *
 * Every check in this repo passed while that was true. Both fields are
 * optional, so it typechecked; the screen degrades silently by design, so
 * nothing threw; and no test rendered the screen. It became visible the first
 * time a human opened it, on 5 Aug, which was itself only possible because
 * deep links had just been added.
 *
 * ── The rule, stated once ──────────────────────────────────────────────────
 *
 * A detail endpoint is a superset of the list endpoint for the same entity.
 * Not a style preference: the list is what the user was looking at a moment
 * ago, so anything it knew and the detail does not reads as data that
 * *disappeared*. The direction only ever fails one way, which is why this
 * compares sets rather than pinning an exact list — `load-vehicle` may return
 * more (`vin`, `updated_at`) and that is fine.
 *
 * ── Why source and not a request ───────────────────────────────────────────
 *
 * Both routes would need a live Supabase, and the property is which columns
 * are *asked for* — a string constant in each file. The 5 Aug fix was verified
 * separately against the real database (the demo Accord returns
 * `health_score: 74`), but that is a one-off measurement and this is the part
 * that has to keep being true.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = join(__dirname, '..', '..', 'app', 'api', 'v1');

/**
 * The columns a route asks Supabase for.
 *
 * Both are built as adjacent string literals concatenated with `+`, so the
 * declaration is read whole and then stripped of quotes and whitespace rather
 * than matched line by line.
 */
function selectedColumns(route: string, constant: string): string[] {
  const source = readFileSync(join(API, route, 'route.ts'), 'utf8');

  const start = source.indexOf(`const ${constant} =`);
  expect(start).toBeGreaterThan(-1);

  const end = source.indexOf(';', start);
  expect(end).toBeGreaterThan(start);

  const literal = source
    .slice(start, end)
    .replace(/^[^=]*=/, '')
    .replace(/['"+\s]/g, '');

  /*
    Embedded selects look like `nhtsa_data(recalls)`. Only the relation name
    matters here — which *facts* travel — not which of its columns, so the
    parenthesised part is dropped rather than parsed.
  */
  return literal
    .split(',')
    .map((column) => column.replace(/\(.*$/, '').trim())
    .filter(Boolean);
}

describe('the vehicle detail endpoint', () => {
  const list = selectedColumns('vehicles', 'GARAGE_COLUMNS');
  const detail = selectedColumns('load-vehicle', 'VEHICLE_COLUMNS');

  it('parses both column lists', () => {
    // Guards the guard: a parser that silently returned nothing would make the
    // superset assertion below pass vacuously, which is the same class of
    // failure this file exists to pin.
    expect(list.length).toBeGreaterThan(5);
    expect(detail.length).toBeGreaterThan(5);
  });

  it('asks for everything the garage list asks for', () => {
    const missing = list.filter((column) => !detail.includes(column));
    expect(missing).toEqual([]);
  });

  it('carries the two the detail screen actually renders', () => {
    // Named explicitly because these are the two that were missing, and the
    // superset rule above would also be satisfied by deleting them from the
    // list route — which would "fix" the test by making both screens poorer.
    expect(detail).toContain('vehicle_health_summary');
    expect(detail).toContain('nhtsa_data');
    expect(list).toContain('vehicle_health_summary');
    expect(list).toContain('nhtsa_data');
  });
});
