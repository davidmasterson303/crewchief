/**
 * Where a notification gets sent, and who may change it.
 *
 * @jest-environment node
 *
 * Phase 5's device half shipped 5 Aug and could never fire: permission,
 * delivery and tap-routing all worked, and **nothing knew where to send a
 * push**. `device_push_tokens` and `/api/v1/push-token` close that.
 *
 * A push token is not a credential — it addresses a device and authenticates
 * nobody — but it is enough to *send* to that device, so a leaked or
 * mis-scoped row is a spam channel wearing Well Kept's name. That is what most
 * of this file is about.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isExpoPushToken } from '@wellkept/core/push-tokens';

const ROOT = join(__dirname, '..', '..');

const migrationFile = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260806120000_remember_where_to_send_a_notification.sql'),
  'utf8'
);

const routeFile = readFileSync(join(ROOT, 'app', 'api', 'v1', 'push-token', 'route.ts'), 'utf8');

/**
 * Source with prose removed.
 *
 * The first version of this file asserted against the raw text and three
 * assertions failed on **their own docblocks** — the route's header explains
 * why it does *not* use `authorizeVehicleAccess`, and the word alone was enough
 * to fail the check. `portability.test.ts` learned the same lesson when a
 * prompt containing "the document." failed a browser-global detector.
 *
 * Comments are where the reasoning lives, so they will keep mentioning the
 * things they rule out. Strip them, and assert on code.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** The same, for SQL — `/* *\/` and `--`. */
function sql(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const route = code(routeFile);

/*
  Stripped for the same reason, and this file needed it three times before the
  point landed: the migration's own header explains why it does **not** use
  `USING (true)`, and that sentence failed the assertion checking for it.

  A comment that names the thing it rules out is good writing and a bad
  substring. Assert on statements.
*/
const migration = sql(migrationFile);

describe('isExpoPushToken', () => {
  it.each([
    'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]',
  ])('accepts %s', (token) => {
    // Both spellings are in circulation depending on SDK age; accepting one
    // would refuse real devices.
    expect(isExpoPushToken(token)).toBe(true);
  });

  it.each([
    ['', 'an empty string'],
    ['   ', 'whitespace'],
    ['ExponentPushToken[]', 'an empty payload'],
    ['eyJhbGciOiJIUzI1NiIs', 'a JWT, which is what a careless client might send'],
    ['iPhone 16e', 'a device name'],
    ['ExponentPushToken[abc', 'an unterminated token'],
  ])('refuses %s (%s)', (value) => {
    expect(isExpoPushToken(value)).toBe(false);
  });

  it('refuses non-strings without throwing', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(isExpoPushToken(value)).toBe(false);
    }
  });
});

describe('the table', () => {
  it('cascades on account deletion', () => {
    /*
      `cc-product-0005` promises immediate deletion. Of everything that could
      survive it, a delivery address is the one that most obviously must not —
      a surviving row can still *reach* someone who asked to be forgotten.
    */
    expect(migration).toMatch(/user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });

  it('keys on the device, not the token, because tokens rotate', () => {
    // Keying on the token leaves a dead row behind on every reinstall, and
    // dead rows are how a fan-out pushes to a phone that was traded in.
    expect(migration).toMatch(/UNIQUE \(user_id, device_id\)/);
    // Named, so a caller's `onConflict` can rely on it — this repo has been
    // bitten by an ON CONFLICT naming a constraint that did not exist.
    expect(migration).toMatch(/CONSTRAINT device_push_tokens_one_per_device/);
  });

  it('enables RLS and scopes every policy to the owner', () => {
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);

    /*
      Policies are OR'd, so a single `USING (true)` nullifies every scoped
      policy beside it — that is why `rls-blanket-policies.test.ts` exists.
    */
    expect(migration).not.toMatch(/USING \(true\)/);

    /*
      Every USING clause must be owner-scoped. Matched on the clause's contents
      up to the statement's end rather than to the first `)`, because
      `auth.uid()` contains one — an earlier version of this assertion failed
      on its own subject.
    */
    const policies = migration.match(/USING \([\s\S]*?\);/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).toMatch(/user_id = auth\.uid\(\)/);
    }
  });

  it('stores no hardware inventory', () => {
    /*
      A device name, model or OS version is available and not needed to deliver
      a notification. A table that accumulates a fleet inventory is one that has
      to be explained in a privacy label for a feature that works without it.
    */
    for (const column of ['device_name', 'device_model', 'os_version', 'locale']) {
      expect(migration).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });
});

describe('the route', () => {
  it('authorizes on the account, not on a vehicle', () => {
    // A push token belongs to an account. Reaching for the vehicle-scoped
    // helper would mean inventing a vehicle for a request that has none.
    expect(route).toMatch(/requireCaller\(\)/);
    expect(route).not.toMatch(/authorizeVehicleAccess/);
    expect(routeFile).toMatch(/requireCaller/);
  });

  it('refuses a malformed token at the boundary', () => {
    // A row holding a non-token is a send that fails once per notification,
    // forever, far from the request that stored it.
    expect(route).toMatch(/isExpoPushToken/);
  });

  it('scopes the delete by user_id as well as by RLS', () => {
    /*
      The service-role client **bypasses RLS entirely**. A delete filtered only
      by `deviceId` would remove another account's device if the two ever
      collided, and the policy would not stop it.
    */
    const del = route.slice(route.indexOf('export async function DELETE'));
    expect(del).toMatch(/\.eq\('user_id', caller\.userId\)/);
    expect(del).toMatch(/\.eq\('device_id', deviceId\)/);
  });

  it('upserts against the named constraint', () => {
    expect(route).toMatch(/onConflict: 'user_id,device_id'/);
  });

  it('rate limits before doing any work', () => {
    expect(route.indexOf('checkRateLimit(')).toBeLessThan(route.indexOf('requireCaller('));
  });
});

describe('the client half', () => {
  const register = readFileSync(
    join(ROOT, 'apps', 'mobile', 'src', 'notifications', 'register.ts'),
    'utf8'
  );

  it('mints its own device id rather than reading the hardware', () => {
    /*
      `expo-device` is not installed and would cost one of fifteen monthly
      cloud builds. It is also the worse answer: a hardware id survives an
      uninstall and correlates a person across apps, where this one dies with
      the app.
    */
    expect(code(register)).not.toMatch(/expo-device/);
    expect(code(register)).toMatch(/secureStorage/);
  });

  it('never lets a failed registration surface as an app error', () => {
    // Push is an enhancement. The one thing worse than no notifications is an
    // app that will not open without them.
    expect(code(register)).toMatch(/catch/);
    expect(code(register)).toMatch(/status: 'unavailable'/);
  });

  it('unregisters while the token is still valid', () => {
    /*
      Order is load-bearing: `/api/v1/push-token` authorizes like every other
      route, so signing out first would leave the row behind and the handset
      still addressable.
    */
    const app = code(readFileSync(join(ROOT, 'apps', 'mobile', 'App.tsx'), 'utf8'));
    expect(app).toMatch(/unregisterPush\(\)[\s\S]{0,80}signOut\(\)/);
  });
});
