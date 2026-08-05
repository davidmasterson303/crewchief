/**
 * A denied upload comes back as a denial, not as a server error.
 *
 * @jest-environment node
 *
 * `/api/v1/upload-document` delegated authorization entirely to
 * `uploadInvoice`. The action authorizes correctly — it must, because a server
 * action is an independently reachable POST endpoint — but it returns
 * `{ success: false, error }` with **no status**, and the route's error mapping
 * falls through to `500` for anything it does not recognise by string.
 *
 * So the wire said:
 *
 *   - expired or missing session → **500** "Unauthorized"  (should be 401)
 *   - someone else's vehicle     → **500** "Vehicle not found" (should be 404)
 *   - a demo vehicle             → **500** (should be 403)
 *
 * ── Why this is a Phase 3.3 blocker and not a tidiness item ─────────────────
 *
 * The mobile client decides to sign someone out by reading `status === 401`
 * (`apps/mobile/src/api/client.ts`, `ApiRequestError.isUnauthorized`). Against
 * a 500 that never fires, so an expired session would show "something went
 * wrong, try again" indefinitely and trying again cannot help — the one thing
 * that would help is the one thing the app was never told to do.
 *
 * It lands on the worst flow to land on. An invoice upload is the end of a
 * photograph someone has just taken of a bill, which makes it the least
 * forgiving moment in the app to be given a wrong and unactionable error.
 *
 * `/api/v1/consultant` sets out the rule this restores: a route authorizes in
 * addition to its action **because it needs the status code**, and deriving
 * HTTP semantics by matching on error strings is the fragile version.
 *
 * ── Why a source assertion ──────────────────────────────────────────────────
 *
 * Executing this route means a live Supabase, a storage bucket and a vision
 * model. The property that regressed is structural — *is the caller authorized
 * where the status is still available* — and that is readable statically.
 * `auth-posture.test.ts` guards the consultant action the same way and for the
 * same reason.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = join(__dirname, '..', '..', 'app', 'api', 'v1', 'upload-document', 'route.ts');

function routeSource(): string {
  return readFileSync(ROUTE, 'utf8');
}

describe('/api/v1/upload-document', () => {
  it('authorizes in the route, where the status code still exists', () => {
    const source = routeSource();

    expect(source).toMatch(/authorizeVehicleAccess\(\s*vehicleId,\s*\{\s*intent:\s*'write'\s*\}\s*\)/);
    // The denial must be returned as the response object the auth layer built,
    // which already carries 401/403/404. Re-wrapping its `error` string would
    // reintroduce exactly the defect this file exists for.
    expect(source).toMatch(/return access\.response;/);
  });

  it('writes, so it must never authorize with read intent', () => {
    // 'read' would permit anonymous access to demo vehicles, and this route
    // uploads a file and inserts a document row. `authorizeVehicleAccess`
    // rejects demo vehicles outright under 'write' — that 403 is the point.
    expect(routeSource()).not.toMatch(/intent:\s*'read'/);
  });

  it('authorizes before it reads or validates the file body', () => {
    const source = routeSource();

    const authAt = source.indexOf('authorizeVehicleAccess(');
    const sizeCheckAt = source.indexOf('file.size > MAX_FILE_SIZE');
    const typeCheckAt = source.indexOf('ALLOWED_DOCUMENT_TYPES.includes');

    expect(authAt).toBeGreaterThan(-1);
    expect(sizeCheckAt).toBeGreaterThan(-1);
    expect(typeCheckAt).toBeGreaterThan(-1);

    // Validating a file on behalf of a caller with no claim to the vehicle is
    // work done for someone who should already have been refused.
    expect(authAt).toBeLessThan(sizeCheckAt);
    expect(authAt).toBeLessThan(typeCheckAt);
  });

  it('still rate-limits before doing anything at all', () => {
    const source = routeSource();

    // Authorization costs a database round trip, so it must not become the
    // thing an unauthenticated flood pays for. The limiter stays first.
    expect(source.indexOf('checkRateLimit(')).toBeLessThan(
      source.indexOf('authorizeVehicleAccess(')
    );
  });
});
