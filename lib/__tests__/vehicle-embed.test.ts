/**
 * The garage reads PostgREST's embeds in the shape PostgREST actually sends.
 *
 * @jest-environment node
 *
 * ── ⚠ What was broken, and why nothing noticed ──────────────────────────────
 *
 * PostgREST embeds a **to-one** relation as an object and a **to-many** as an
 * array. `nhtsa_data` and `vehicle_health_summary` are one row per vehicle, so
 * they arrive as objects — while `hooks/useVehicles.ts` types them as arrays
 * and both garage pages read `vehicle.vehicle_health_summary?.[0]`.
 *
 * `({}) [0]` is `undefined`. It does not throw and it does not warn: the card
 * simply takes its no-data path and renders without a health ring. So every
 * health score this product computed was discarded on the way to the garage,
 * and `activeRecalls` was permanently `0` — meaning **an open safety recall on
 * a car in the garage raised no alert ribbon**, because the count came from
 * `undefined?.length || 0`.
 *
 * Found by querying PostgREST as the anonymous browser does and comparing the
 * response shape to the code that reads it. The page renders perfectly either
 * way, which is exactly why no rendered test and no type could catch it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { firstEmbed } from '@wellkept/core/vehicle-embed';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('firstEmbed takes either shape', () => {
  it('unwraps the object PostgREST sends for a to-one relation', () => {
    /*
      The real response, copied from a live anonymous query on 3 Sep:
      `"vehicle_health_summary": { "health_score": 74, "summary": "…" }`.
    */
    expect(firstEmbed({ health_score: 74 })).toEqual({ health_score: 74 });
  });

  it('still unwraps an array, because the cardinality is a database fact', () => {
    /*
      Not "fixed" to expect an object. A migration can change a relation's
      cardinality, and a reader that only understands today's shape is the same
      bug pointed the other way.
    */
    expect(firstEmbed([{ health_score: 74 }, { health_score: 12 }])).toEqual({
      health_score: 74,
    });
  });

  it('answers undefined for absent, empty and null', () => {
    // A car with no summary row is the ordinary case, not an error.
    expect(firstEmbed(undefined)).toBeUndefined();
    expect(firstEmbed(null)).toBeUndefined();
    expect(firstEmbed([])).toBeUndefined();
  });
});

describe('both garages actually use it', () => {
  /*
    The helper being correct is half of it. The defect was at the call sites,
    and a helper nobody calls is the shape of fix this repo has shipped before
    — `RECALL_MATCH_CAVEAT` was exported, asserted for its wording, and
    rendered by nothing.
  */
  it.each([
    ['the landing garage', 'app/page.tsx'],
    ['the signed-in garage', 'app/garage/page.tsx'],
  ])('%s reads the embeds through firstEmbed', (_name, file) => {
    const source = read(file);

    expect(source).toMatch(/firstEmbed\(vehicle\.vehicle_health_summary\)/);
    expect(source).toMatch(/firstEmbed\(vehicle\.nhtsa_data\)/);
  });

  it.each([
    ['the landing garage', 'app/page.tsx'],
    ['the signed-in garage', 'app/garage/page.tsx'],
  ])('%s no longer indexes an embed with [0]', (_name, file) => {
    /*
      ⚠ The assertion that would have failed before the fix, and the one that
      catches somebody "simplifying" the helper back out. Comments are stripped
      because this file's own explanation quotes the broken expression.
    */
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/vehicle_health_summary\??\.\[0\]/);
    expect(code).not.toMatch(/nhtsa_data\??\.\[0\]/);
  });
});
