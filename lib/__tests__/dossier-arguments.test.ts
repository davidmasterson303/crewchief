/**
 * `generateVehicleDossier` is never called without the vehicle.
 *
 * @jest-environment node
 *
 * ── The outage this pins ────────────────────────────────────────────────────
 *
 * From 27 Jul (`8e9fafd`) to 21 Aug, `enrichVehicle` called
 * `generateVehicleDossier(vehicleId)` — no second argument — having fetched the
 * vehicle row three lines earlier and thrown it away. The callee's guard
 * returned `{ success: false, error: 'Vehicle data is required' }`.
 *
 * So **every vehicle added in that window silently got no research**: an empty
 * knowledge-base stub, no NHTSA record, and a dashboard retry button that could
 * never succeed, because retry called the same broken function. It surfaced
 * only when Apple's reviewer account was created and somebody added a car.
 *
 * ── Why a source scan as well as the type ───────────────────────────────────
 *
 * The parameter is required now, so the original defect is a build error —
 * verified by removing the argument and watching `tsc` report
 * "Expected 2 arguments, but got 1". That is the better guard of the two.
 *
 * This one exists because a type is one edit away from `?: any`, which is
 * exactly what it was. A scan cannot be relaxed by accident in the same motion.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** Source with comments stripped — docblocks here discuss the broken call. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every .ts/.tsx under the app's own roots. */
function sources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry === 'node_modules' || entry === '__tests__') return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const files = ['app', 'components', 'hooks', 'lib'].flatMap((r) => sources(join(ROOT, r)));

describe('every dossier call carries the vehicle', () => {
  it('is scanning a real source tree', () => {
    // Anti-vacuous: a walk that found nothing would report a clean app forever.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(join('app', 'actions.ts')))).toBe(true);
  });

  it('finds the call sites it is meant to be checking', () => {
    /*
      The second half of anti-vacuous, and the one that matters here: if the
      function were renamed, the assertion below would pass against zero calls.
    */
    const calls = files.flatMap((f) =>
      (withoutComments(readFileSync(f, 'utf8')).match(/generateVehicleDossier\s*\(/g) ?? []).map(
        () => f
      )
    );

    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('never invokes it with the id alone', () => {
    /*
      The defect, as a pattern: `generateVehicleDossier(<something>)` with no
      comma before the closing bracket. Matching on the absence of a second
      argument rather than on a specific caller, so a fourth call site added
      later is covered without anyone remembering this file exists.
    */
    const offenders: string[] = [];

    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      // Skip the declaration itself.
      const calls = source.match(/(?<!function\s)generateVehicleDossier\s*\([^)]*\)/g) ?? [];
      for (const call of calls) {
        const args = call.slice(call.indexOf('(') + 1);
        if (!args.includes(',')) {
          offenders.push(`${file.replace(ROOT + '/', '')}: ${call.replace(/\s+/g, ' ')}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('enrichVehicle passes the row it already fetched', () => {
    /*
      Named specifically because it is the path that broke, and it is the one
      users reach two ways — automatically after adding a car, and through the
      dashboard's retry button, which is why retry could never clear the banner.
    */
    const actions = withoutComments(readFileSync(join(ROOT, 'app', 'actions.ts'), 'utf8'));
    const enrich = actions.slice(actions.indexOf('export async function enrichVehicle'));
    const call = enrich.slice(
      enrich.indexOf('generateVehicleDossier'),
      enrich.indexOf('generateVehicleDossier') + 220
    );

    expect(call).toMatch(/year:/);
    expect(call).toMatch(/make:/);
    expect(call).toMatch(/model:/);
  });
});
