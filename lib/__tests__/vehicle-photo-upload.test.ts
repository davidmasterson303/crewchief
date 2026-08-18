/**
 * Adding a vehicle photograph from the phone.
 *
 * @jest-environment node
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * `uploadVehiclePhoto` in `app/actions.ts` is a server action on the cookie
 * session, so a React Native client could never call it. David found the
 * consequence on 15 Aug looking at a garage card: **the identity plate was the
 * only reachable state, and a plate you cannot replace is a dead end rather
 * than a fallback.**
 *
 * Two halves, tested the two ways this repo already tests them. The route is a
 * static read for the reason `create-vehicle-route.test.ts` gives — running it
 * needs a live Supabase, and the properties worth pinning are which helper
 * authorizes and what is refused. The client is executed, because its refusals
 * are the ones an owner will actually meet.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_STORED_PHOTO_BYTES } from '@crewchief/core/image-resize';

const ROOT = join(__dirname, '..', '..');

/**
 * Source with comments removed.
 *
 * This route's own header names `uploadVehiclePhoto` as a *server action the
 * phone cannot reach*, which is good writing and a bad substring.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const route = code(
  readFileSync(join(ROOT, 'app', 'api', 'v1', 'upload-photo', 'route.ts'), 'utf8')
);
const post = route.slice(route.indexOf('export async function POST'));

describe('POST /api/v1/upload-photo', () => {
  it('exists at all — the gap that left the plate unreplaceable', () => {
    expect(route).toMatch(/export async function POST/);
  });

  it('authorizes with the shared helper, so a bearer token works', () => {
    /*
      `authorizeVehicleAccess` is the one place ownership is decided. A bearer
      path with its own logic would be a second implementation of the rule
      `lib/api-auth.ts` exists to own — the bug this codebase keeps repeating.
    */
    expect(post).toMatch(/authorizeVehicleAccess\(\s*vehicleId,\s*\{\s*intent:\s*'write'\s*\}/);
    expect(post).not.toMatch(/createServerActionClient/);
  });

  it('authorizes before it inspects the file', () => {
    /*
      Reading and validating a body on behalf of a caller who may not touch the
      vehicle is work done for someone with no claim to it. Ordering, not
      preference — and only a source read can see it.
    */
    expect(post.indexOf('authorizeVehicleAccess')).toBeLessThan(post.indexOf('ALLOWED_IMAGE_TYPES'));
    expect(post.indexOf('authorizeVehicleAccess')).toBeLessThan(
      post.indexOf('checkStoredPhotoSize')
    );
  });

  it('takes images only, and a narrower list than the document upload', () => {
    // An invoice may legitimately be a PDF; a vehicle photograph may not. The
    // stored file is rendered in an <img> and an <Image>, so anything those
    // cannot decode is a permanent broken hero.
    expect(post).toMatch(/ALLOWED_IMAGE_TYPES/);
    expect(post).not.toMatch(/ALLOWED_DOCUMENT_TYPES/);
  });

  it('applies the stored-photo ceiling and returns its reason', () => {
    /*
      ⚠ The ceiling exists because this account holds a 2.3 MB original that has
      never decoded on a device. Storing another would reintroduce that bug for
      the next car — and the reason has to reach the owner, because on mobile
      this refusal is reachable in ordinary use.
    */
    expect(post).toMatch(/checkStoredPhotoSize\(file\.size\)/);
    expect(post).toMatch(/sizeCheck\.reason/);
  });

  it('returns a real status rather than 200-with-an-error', () => {
    /*
      `apps/mobile/src/api/client.ts` keys sign-out off `status === 401`. The
      action returns `{ success: false, error }` with no status, so a caller
      mapping that would fall through to 500 and an expired session would show
      "try again" forever.
    */
    expect(post).toMatch(/status:\s*400/);
    expect(post).toMatch(/access\.response/);
  });
});

/* ── The client ─────────────────────────────────────────────────────────── */

/* Module, not a global script — see the note in `mobile-session.test.ts`. */
export {};

jest.mock(
  '../../apps/mobile/src/config',
  () => ({ API_BASE_URL: 'https://example.test', API_PREFIX: '/api/v1' }),
  { virtual: true }
);

jest.mock(
  '../../apps/mobile/src/auth/session',
  () => ({ getAccessToken: async () => 'test-token' }),
  { virtual: true }
);

const apiRequest = jest.fn();
jest.mock('../../apps/mobile/src/api/client', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }), {
  virtual: true,
});

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  uploadVehiclePhoto,
  VehiclePhotoError,
} = require('../../apps/mobile/src/api/photos');
/* eslint-enable @typescript-eslint/no-var-requires */

const photo = (over: Record<string, unknown> = {}) => ({
  uri: 'file:///tmp/car.jpg',
  name: 'car.jpg',
  type: 'image/jpeg',
  size: 400 * 1024,
  ...over,
});

describe('uploadVehiclePhoto, on the phone', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ success: true, photoUrl: 'https://signed.test/car.jpg' });
  });

  it('sends to the bearer route, as multipart', async () => {
    await uploadVehiclePhoto('vehicle-1', photo());

    const [path, options] = apiRequest.mock.calls[0];
    expect(path).toBe('/upload-photo');
    expect(options.method).toBe('POST');
    // RN's own FormData — `apiRequest` sends it over XHR precisely so the
    // `{ uri, name, type }` part shape is the right one.
    expect(options.body).toBeInstanceOf(FormData);
  });

  it('refuses a file the renderers cannot decode, before it leaves the phone', async () => {
    await expect(uploadVehiclePhoto('vehicle-1', photo({ type: 'application/pdf' }))).rejects.toBeInstanceOf(
      VehiclePhotoError
    );

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('refuses an oversized capture locally, and names the numbers', async () => {
    /*
      ⚠ Reachable in ordinary use, unlike on web. The browser downscales before
      upload; the phone can only reduce encoder quality, because there is no
      image manipulator in this build. So the message has to be one an owner can
      act on — and the check has to happen here, so a phone on cellular does not
      spend a megabyte discovering the file was a megabyte too big.
    */
    const oversized = photo({ size: MAX_STORED_PHOTO_BYTES + 1 });

    await expect(uploadVehiclePhoto('vehicle-1', oversized)).rejects.toThrow(/1\.5 MB/);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('lets an unknown size through rather than refusing on absence', async () => {
    // Absent means unknown, and an unknown size is not evidence of harm.
    // `checkStoredPhotoSize` takes the same position server-side.
    await uploadVehiclePhoto('vehicle-1', photo({ size: undefined }));

    expect(apiRequest).toHaveBeenCalled();
  });

  it('prefers the server s sentence over one invented here', async () => {
    // The refusal an owner will actually meet is the size ceiling, and its
    // server-side message already names the number.
    apiRequest.mockResolvedValue({ success: false, error: 'That photo is 2.3 MB and the limit is 1.5 MB.' });

    await expect(uploadVehiclePhoto('vehicle-1', photo())).rejects.toThrow(
      'That photo is 2.3 MB and the limit is 1.5 MB.'
    );
  });

  it('returns the signed URL so the caller need not guess', async () => {
    const result = await uploadVehiclePhoto('vehicle-1', photo());

    expect(result.photoUrl).toBe('https://signed.test/car.jpg');
  });

  it('treats a missing URL as stored, not as failed', async () => {
    // Signing is best-effort in the action — the upload has already succeeded
    // by then, so `null` means "ask again later" and never "it did not work".
    apiRequest.mockResolvedValue({ success: true });

    await expect(uploadVehiclePhoto('vehicle-1', photo())).resolves.toEqual({ photoUrl: null });
  });
});
