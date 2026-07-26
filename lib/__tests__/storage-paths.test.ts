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
} from '@/lib/storage-paths';

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
