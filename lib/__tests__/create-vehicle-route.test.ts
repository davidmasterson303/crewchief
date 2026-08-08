/**
 * Adding a car from the phone.
 *
 * @jest-environment node
 *
 * `createVehicle` in `app/actions.ts` authenticates with
 * `createServerActionClient()` — cookies and nothing else — so a React Native
 * client could never call it. Until 8 Aug that was tolerable, because mobile
 * was a companion and enrollment happened on the web. It stopped being
 * tolerable the moment the product went mobile-first: **a person could not
 * create a car on the phone at all.**
 *
 * This is a static read of the route rather than an execution of it, for the
 * reason `auth-posture.test.ts` sets out — running it needs a live Supabase, and
 * the properties worth pinning are which helper authorizes, what is refused, and
 * what is never trusted from the caller. All three are on disk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Source with comments removed.
 *
 * `push-token-registration.test.ts` learned this three times: a docblock
 * explaining what a route does *not* do is good writing and a bad substring.
 * This route's own header names `createServerActionClient` to record that it
 * cannot use it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const route = code(readFileSync(join(ROOT, 'app', 'api', 'v1', 'vehicles', 'route.ts'), 'utf8'));
const post = route.slice(route.indexOf('export async function POST'));

describe('POST /api/v1/vehicles', () => {
  it('exists at all — the gap that blocked mobile-first', () => {
    expect(route).toMatch(/export async function POST/);
  });

  it('authorizes with requireCaller, so a bearer token works', () => {
    // The whole point. `createServerActionClient` reads next/headers cookies,
    // which a native client does not have.
    expect(post).toMatch(/requireCaller\(\)/);
    expect(post).not.toMatch(/createServerActionClient/);
  });

  it('never takes user_id from the request body', () => {
    /*
      Ownership comes from the verified session. A client-supplied `user_id`
      reads as authoritative even when the handler ignores it, which is one
      careless edit from being trusted — `createVehicle`'s own comment makes
      the point and it holds harder on a route.
    */
    expect(post).toMatch(/user_id:\s*caller\.userId/);
    expect(post).not.toMatch(/body\.user_?[iI]d/);
  });

  it('reuses the mileage rule rather than growing a second opinion', () => {
    // A first reading is an increase from nothing, so the correction path does
    // not apply and the bounds do.
    expect(post).toMatch(/validateMileageUpdate\(\{\s*current:\s*0/);
  });

  it('does not await the dossier research', () => {
    /*
      Measured at ~23s warm. Holding the response open for it puts a half-minute
      spinner between "add my car" and seeing anything. The row is seeded
      `pending` and `VehicleInsights` picks it up on first view.
    */
    expect(post).toMatch(/research_status:\s*'pending'/);
    expect(post).not.toMatch(/await\s+generateVehicleDossier/);
  });

  it('sets the one product branch that must exist at creation', () => {
    // Whether this owner ever sees modifications. `mild` means interested,
    // `stock` means not — the enum's own values, read by showsModifications.
    expect(post).toMatch(/performance_mindedness:.*'stock'.*:.*'mild'|wantsModifications/s);
  });

  it('returns 201 on success rather than 200', () => {
    expect(post).toMatch(/status:\s*201/);
  });

  describe('what it refuses', () => {
    it('a malformed year', () => {
      expect(post).toMatch(/Number\.isInteger\(year\)/);
      expect(post).toMatch(/year\s*<\s*1900/);
    });

    it('a missing make or model', () => {
      expect(post).toMatch(/!make\s*\|\|\s*!model/);
    });

    it('an implausible odometer reading, as 422 rather than 400', () => {
      // The request is well-formed and the caller authorized; what failed is a
      // rule about the value, and the message is written to be shown.
      expect(post).toMatch(/status:\s*422/);
    });
  });

  it('survives a knowledge-base insert failure without losing the car', () => {
    // The vehicle exists and is usable; the dossier is the thing that waits.
    expect(post).toMatch(/kbError/);
    expect(post).toMatch(/logger\.warn/);
  });
});
