/**
 * Storage paths.
 *
 * @jest-environment node
 *
 * The rule these enforce: the first path segment is always a vehicle id.
 * Both the storage RLS policy and the account-deletion sweep derive ownership
 * from that alone, so a path that breaks it is simultaneously unprotected and
 * unpurgeable — which is exactly what happened when four upload sites each
 * invented their own convention.
 */

import {
  vehicleStoragePath,
  vehicleIdFromStoragePath,
  vehicleStoragePrefixes,
  storedUrl,
  storagePathFromStoredUrl,
} from '@wellkept/core/storage-paths';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VEHICLE = 'd4e8b2a1-0000-4000-8000-000000000abc';

describe('every path starts with the vehicle id', () => {
  it.each(['invoices', 'photos', 'consultant'] as const)(
    '%s uploads are vehicle-prefixed',
    (kind) => {
      const path = vehicleStoragePath(VEHICLE, kind, 'receipt.pdf');
      expect(path.startsWith(`${VEHICLE}/`)).toBe(true);
      expect(vehicleIdFromStoragePath(path)).toBe(VEHICLE);
    }
  );

  it('keeps the vehicle first even with extra segments', () => {
    // Consultant docs group by session, which previously pushed the vehicle
    // id to the second segment and broke the RLS cast.
    const path = vehicleStoragePath(VEHICLE, 'consultant', 'quote.pdf', ['session-1']);
    expect(vehicleIdFromStoragePath(path)).toBe(VEHICLE);
    expect(path).toContain('/consultant/session-1/');
  });

  it('does not collide across two uploads of the same filename', () => {
    const a = vehicleStoragePath(VEHICLE, 'invoices', 'receipt.pdf');
    const b = vehicleStoragePath(VEHICLE, 'invoices', 'receipt.pdf');
    expect(a).not.toBe(b);
  });
});

describe('filenames cannot escape the vehicle prefix', () => {
  it('strips path separators out of the filename', () => {
    // Filenames arrive from uploads. A slash would silently create folders
    // and could push the object outside its vehicle folder entirely.
    const path = vehicleStoragePath(VEHICLE, 'invoices', '../../etc/passwd');
    expect(vehicleIdFromStoragePath(path)).toBe(VEHICLE);
    expect(path.split('/')).toHaveLength(3);
  });

  it('preserves the extension', () => {
    expect(vehicleStoragePath(VEHICLE, 'invoices', 'my receipt.pdf')).toMatch(/\.pdf$/);
  });
});

describe('legacy paths are refused, not guessed at', () => {
  it.each([
    'vehicle-photos/d4e8b2a1-0000-4000-8000-000000000abc/x.jpg',
    'consultant-docs/d4e8b2a1-0000-4000-8000-000000000abc/s/x.pdf',
    'invoices/123-x.pdf',
  ])('%s has no derivable owner', (path) => {
    // Returning null makes the caller refuse rather than authorize against
    // something that merely looks like an id.
    expect(vehicleIdFromStoragePath(path)).toBeNull();
  });
});

describe('deletion sweep still reaches legacy objects', () => {
  it('includes the old prefixes so nothing survives an account deletion', () => {
    const prefixes = vehicleStoragePrefixes(VEHICLE);
    expect(prefixes).toContain(VEHICLE);
    expect(prefixes).toContain(`vehicle-photos/${VEHICLE}`);
    expect(prefixes).toContain(`consultant-docs/${VEHICLE}`);
  });
});

describe('every upload writes a path the deletion sweep can find', () => {
  /*
    The invariant the whole deletion guarantee rests on.

    `uploadInvoiceForCompletion` used to write `invoices/{file}` — no vehicle,
    no user, nothing to attribute it to — so those objects could not be purged
    with an account. Task 0.3 moved all four upload sites onto
    `vehicleStoragePath`, and `deleteAccount` no longer carries a caveat about
    it. That caveat's absence is only honest while this stays true.

    A new `.upload()` that builds its own path is exactly how the hole
    reopens, and it would be invisible: uploads would work, deletion would
    report success, and the blobs would simply stay.
  */
  const SOURCE_FILES = ['app/actions.ts'];

  it.each(SOURCE_FILES)('%s builds every upload path with vehicleStoragePath', (rel) => {
    const source = readFileSync(join(__dirname, '..', '..', rel), 'utf8');

    const uploadCalls = (source.match(/\.upload\(/g) ?? []).length;
    const builtPaths = (source.match(/vehicleStoragePath\(/g) ?? []).length;

    expect(uploadCalls).toBeGreaterThan(0);
    expect(builtPaths).toBeGreaterThanOrEqual(uploadCalls);
  });

  it('no source file uploads to a hand-written top-level folder', () => {
    // The specific shapes that broke it: a string literal prefix where a
    // vehicle id belongs.
    const source = readFileSync(join(__dirname, '..', '..', 'app/actions.ts'), 'utf8');

    expect(source).not.toMatch(/\.upload\(\s*[`'"](?:invoices|vehicle-photos|consultant-docs)\//);
  });
});

describe('what gets persisted is a path, never a URL', () => {
  it('round-trips a storage path', () => {
    const path = vehicleStoragePath(VEHICLE, 'photos', 'car.jpg');
    expect(storagePathFromStoredUrl(storedUrl(path))).toBe(path);
  });

  it.each([
    ['a demo asset', '/vehicles/bmw-m235i/hero-3x2.jpg'],
    ['an external URL', 'https://images.example.com/car.jpg'],
    ['an empty scheme', 'placeholder://'],
    ['nothing at all', null],
    ['nothing at all, the other way', undefined],
  ])('leaves %s alone', (_label, value) => {
    // null means "not ours to sign" — the caller passes the value through
    // untouched rather than trying to mint a URL for it.
    expect(storagePathFromStoredUrl(value as string | null | undefined)).toBeNull();
  });

  /*
    The ratchet for the bug this convention exists to prevent.

    `vehicle-documents` went private in migration 20260726180000, which makes
    `/object/public/…` return 404 for every object in it. Three upload sites
    kept calling `.getPublicUrl()` and persisting the result, so every photo,
    invoice and consultant attachment uploaded after that migration stored a
    URL that was dead on arrival — including the hero image on a real vehicle,
    whose photograph was intact in storage the whole time.

    Nothing failed loudly. The upload succeeded, the row was written, the
    object existed. Only the `<img>` was broken, which reads as a rendering
    bug and sends you looking at the component.
  */
  it('no code mints a public URL against the private bucket', () => {
    const sources = ['app/actions.ts', 'lib/storage-objects.ts'];

    for (const rel of sources) {
      const source = readFileSync(join(__dirname, '..', '..', rel), 'utf8');
      expect({ rel, matches: source.match(/\.getPublicUrl\(/g) }).toEqual({
        rel,
        matches: null,
      });
    }
  });
});
