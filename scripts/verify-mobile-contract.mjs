/**
 * Mobile client contract — the end-to-end check, Phase 2 task 2.5.
 *
 * Everything Phase 2 built is unit-tested in isolation: bearer resolution in
 * `bearer-auth.test.ts`, the CORS policy in `cors.test.ts`, the versioned
 * paths by their own suites. **None of those compose the others.** This
 * project's characteristic failure is not a broken layer, it is every layer
 * green over an end-to-end broken path — `security.test.ts` passed 11 tests
 * against a private reimplementation while the real middleware was a no-op,
 * and the consultant was dead in production while the typecheck, the full
 * suite, verify-demo.mjs *and* the promote gate all said yes.
 *
 * This exercises the whole path in one request sequence, the way a phone will:
 * a cross-origin preflight, then a bearer-authenticated call to a versioned
 * route, then the negative cases that prove the bearer path did not quietly
 * become more permissive than the cookie one.
 *
 *   node scripts/verify-mobile-contract.mjs                       # localhost:3000
 *   node scripts/verify-mobile-contract.mjs https://<site>        # a deployment
 *
 * Configuration, all optional, all read from the environment rather than argv
 * so a token never lands in the process table or shell history:
 *
 *   MOBILE_TEST_TOKEN       a real access token from a signed-in session
 *   MOBILE_TEST_VEHICLE_ID  a vehicle that token's owner owns
 *   CORS_ALLOWED_ORIGINS    same var the app reads; first entry is used
 *
 * **Without a token it runs the four anonymous checks and reports the two
 * credentialed ones as NOT RUN.** That is deliberate and it is not a warning
 * to be ignored: the summary states plainly that the run was partial, because
 * a gate that quietly reports success on a subset is exactly how §25's health
 * check degraded a 404 into a shrug.
 *
 * Read-only. It never writes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  findUnresolvableUrls,
  findMissingFields,
  findLeakedFields,
} from './lib/response-contract.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const DEMO_VEHICLE_ID = 'a1000000-0000-0000-0000-000000000001';

/*
  A syntactically valid uuid that belongs to nobody. Proves the "not found"
  branch returns 404 rather than 403 — ids must not be probeable.

  The sibling case, a vehicle owned by a *different* real account, needs a
  second account and is not something this script can conjure. Noted rather
  than faked: the assertion below is genuine but narrower than the full
  property.
*/
const UNOWNED_VEHICLE_ID = '0fffffff-0000-4000-8000-0000000000ff';

/**
 * Environment, falling back to `.env` the way verify-demo.mjs does.
 *
 * A standalone node script does not get Next's `.env` loading, so a value
 * configured for the app would otherwise read as "not configured" here — and
 * a check that silently does not run is the failure mode this whole script is
 * arguing against.
 */
function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(here, '..', '.env'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch {
    return '';
  }
}

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const token = env('MOBILE_TEST_TOKEN');
const ownedVehicleId = env('MOBILE_TEST_VEHICLE_ID');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(base);

/*
  The origin to test with.

  For a local target, the app reads the same `.env` this script does, so its
  allowlist is knowable. For a *deployed* target it is not — that allowlist
  lives in Netlify's environment, and asserting a deployment honours whatever
  happens to be in a developer's local `.env` produces a confident, meaningless
  failure. It did exactly that on the first run against CI.

  So a remote target needs the origin stated deliberately via
  MOBILE_TEST_ORIGIN. Absent that, the allowed-origin half is reported NOT RUN
  rather than guessed at.
*/
const allowedOrigin =
  env('MOBILE_TEST_ORIGIN') ||
  (isLocal
    ? env('CORS_ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean)[0]
    : '');

let failures = 0;
let notRun = 0;

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  failures++;
};
const skip = (m) => {
  console.log(`  \x1b[33m—\x1b[0m NOT RUN: ${m}`);
  notRun++;
};

async function checkPreflight() {
  console.log('\n1. Cross-origin preflight, the way Expo Web will send it');

  if (!allowedOrigin) {
    skip(
      isLocal
        ? 'no CORS_ALLOWED_ORIGINS in .env — cannot test an allowed origin'
        : "this target's allowlist lives in its own environment; set MOBILE_TEST_ORIGIN to test one"
    );
  } else {
    const res = await fetch(`${base}/api/v1/load-vehicle`, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    const allow = res.headers.get('access-control-allow-origin');
    const allowHeaders = res.headers.get('access-control-allow-headers') || '';
    const credentials = res.headers.get('access-control-allow-credentials');

    if (res.status !== 204) fail(`preflight returned HTTP ${res.status}, expected 204`);
    else if (allow !== allowedOrigin) fail(`preflight allowed "${allow}", expected "${allowedOrigin}"`);
    else if (!/authorization/i.test(allowHeaders)) fail('preflight does not allow the Authorization header — the bearer path cannot be used cross-origin');
    else pass(`preflight 204, echoes ${allowedOrigin}, allows Authorization`);

    if (allow === '*') fail('Access-Control-Allow-Origin is a wildcard — the API is open to every page on the internet');
    if (credentials === 'true') fail('credentials are allowed — a mistaken allowlist entry becomes session-riding');
  }

  const res = await fetch(`${base}/api/v1/load-vehicle`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  if (res.headers.get('access-control-allow-origin')) {
    fail('an unlisted origin was given Access-Control-Allow-Origin');
  } else {
    pass('an unlisted origin is refused — no Allow-Origin header, which is the refusal');
  }
}

async function checkAnonymousDemo() {
  console.log('\n2. The anonymous demo, which must survive everything above');

  const res = await fetch(`${base}/api/v1/load-vehicle?vehicleId=${DEMO_VEHICLE_ID}`);
  if (!res.ok) {
    fail(`demo vehicle returned HTTP ${res.status} to an anonymous caller`);
    return;
  }
  const body = await res.json();
  if (!body?.vehicle?.make) fail('demo vehicle responded 200 but carried no vehicle');
  else pass(`demo vehicle served anonymously — ${body.vehicle.make} ${body.vehicle.model}`);
}

async function checkNoCredential() {
  console.log('\n3. A real vehicle with no credential');

  const id = ownedVehicleId || UNOWNED_VEHICLE_ID;
  const res = await fetch(`${base}/api/v1/load-vehicle?vehicleId=${id}`);
  if (res.status === 401) pass('401 without a credential');
  else fail(`expected 401 without a credential, got HTTP ${res.status}`);
}

async function checkBearer() {
  console.log('\n4. The bearer path — what a phone actually does');

  if (!token) {
    skip('MOBILE_TEST_TOKEN is not set — the bearer happy path is unverified');
    skip('MOBILE_TEST_TOKEN is not set — cannot prove an unowned vehicle 404s for a real caller');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };
  if (allowedOrigin) headers.Origin = allowedOrigin;

  if (!ownedVehicleId) {
    skip('MOBILE_TEST_VEHICLE_ID is not set — cannot verify a bearer reads its own vehicle');
  } else {
    const res = await fetch(`${base}/api/v1/load-vehicle?vehicleId=${ownedVehicleId}`, { headers });
    if (!res.ok) {
      fail(`bearer request for an owned vehicle returned HTTP ${res.status}`);
    } else {
      const body = await res.json();
      if (!body?.vehicle?.id) fail('bearer request returned 200 but carried no vehicle');
      else pass(`bearer read its own vehicle — ${body.vehicle.make} ${body.vehicle.model}`);
    }
  }

  /*
    404 and not 403. §2: "not found" and "not yours" must be indistinguishable
    so vehicle ids cannot be probed. This is the assertion that the bearer path
    did not quietly lose a property the cookie path has.
  */
  const res = await fetch(`${base}/api/v1/load-vehicle?vehicleId=${UNOWNED_VEHICLE_ID}`, { headers });
  if (res.status === 404) pass('a vehicle the caller does not own is 404, not 403 — ids stay unprobeable');
  else if (res.status === 403) fail('403 for an unowned vehicle — this leaks that the id exists');
  else fail(`expected 404 for an unowned vehicle, got HTTP ${res.status}`);
}

async function checkStaleCredential() {
  console.log('\n5. A bearer that does not verify');

  const res = await fetch(`${base}/api/v1/load-vehicle?vehicleId=${UNOWNED_VEHICLE_ID}`, {
    headers: { Authorization: 'Bearer not.a.real.token' },
  });
  // Must not fall back to a cookie, and must not be treated as anonymous.
  if (res.status === 401) pass('401 on an unverifiable bearer — no fallback to another identity');
  else fail(`expected 401 on an unverifiable bearer, got HTTP ${res.status}`);
}

/**
 * The fields each flow's client will actually read.
 *
 * Stated here rather than inferred from a live response, because a check that
 * asserts a response matches itself asserts nothing. `cc-product-0001` fixes
 * the scope at three flows; this is what each one needs on the wire.
 */
const FLOW_CONTRACTS = {
  'garage health': {
    required: ['id', 'year', 'make', 'model', 'photo_url'],
    forbidden: ['custom_image_url'],
  },
  'one vehicle': {
    required: ['id', 'year', 'make', 'model', 'photo_url'],
    forbidden: ['custom_image_url'],
  },
};

/** Reports every unresolvable URL anywhere in a body, at any depth. */
function assertNoUnresolvableUrls(label, body) {
  const found = findUnresolvableUrls(body);
  if (found.length === 0) {
    pass(`${label}: nothing a client cannot resolve, anywhere in the body`);
    return;
  }
  for (const leak of found) {
    fail(`${label}: shipped a storage path a client cannot resolve — ${leak}`);
  }
}

function assertShape(label, object, contract) {
  const missing = findMissingFields(object, contract.required);
  const leaked = findLeakedFields(object, contract.forbidden);

  if (missing.length) fail(`${label}: missing field(s) the client reads — ${missing.join(', ')}`);
  if (leaked.length) fail(`${label}: shipped internal column(s) — ${leaked.join(', ')}`);
  if (!missing.length && !leaked.length) pass(`${label}: shape matches what the client reads`);
}

async function checkResponseShapes() {
  console.log('\n6. Response bodies, not just status codes');

  /*
    Until now this script asserted nothing about any body, which is exactly how
    two routes shipped `select('*')` and a placeholder:// path while the
    contract stayed green. Status codes prove a route answers; they do not
    prove it answers something usable.
  */

  const demo = await fetch(`${base}/api/v1/load-vehicle?vehicleId=${DEMO_VEHICLE_ID}`);
  if (demo.ok) {
    const body = await demo.json();
    assertNoUnresolvableUrls('load-vehicle (demo)', body);
    assertShape('load-vehicle (demo)', body?.vehicle, FLOW_CONTRACTS['one vehicle']);
  } else {
    fail(`load-vehicle returned HTTP ${demo.status} for the demo vehicle — cannot check its shape`);
  }

  if (!token) {
    skip('MOBILE_TEST_TOKEN is not set — the garage list is unverified, and it is the route that was broken');
    return;
  }

  const headers = { Authorization: `Bearer ${token}` };

  /*
    The garage list. It accepted a cookie session only until 31 Jul, so the
    interesting assertion is the plain one: a bearer token gets a 200 at all.
  */
  const garage = await fetch(`${base}/api/v1/vehicles`, { headers });

  if (garage.status === 401) {
    fail('/api/v1/vehicles rejected a valid bearer token — a phone cannot load the garage');
    return;
  }
  if (!garage.ok) {
    fail(`/api/v1/vehicles returned HTTP ${garage.status} to a bearer caller`);
    return;
  }

  const body = await garage.json();
  pass('garage list answers a bearer token');
  assertNoUnresolvableUrls('vehicles', body);

  if (!Array.isArray(body?.vehicles)) {
    fail('vehicles: response carried no vehicles array');
  } else if (body.vehicles.length === 0) {
    /*
      Not a pass. An empty garage satisfies every assertion below without
      exercising one of them, and reporting that as green is precisely the
      degradation this script exists to argue against.
    */
    skip("vehicles: this account's garage is empty — the per-vehicle shape is unverified");
  } else {
    assertShape('vehicles[0]', body.vehicles[0], FLOW_CONTRACTS['garage health']);
  }
}

async function checkGarageNeedsCredential() {
  console.log('\n7. The garage list with no credential');

  const res = await fetch(`${base}/api/v1/vehicles`);
  if (res.status === 401) pass('401 without a credential');
  else fail(`expected 401 from /api/v1/vehicles without a credential, got HTTP ${res.status}`);
}

console.log(`\nMobile client contract at ${base}`);
await checkPreflight();
await checkAnonymousDemo();
await checkNoCredential();
await checkBearer();
await checkStaleCredential();
await checkResponseShapes();
await checkGarageNeedsCredential();

console.log('\n' + '─'.repeat(60));
if (failures > 0) {
  console.log(`\x1b[31mFAILED\x1b[0m — ${failures} blocking issue(s), ${notRun} not run`);
  process.exit(1);
}
if (notRun > 0) {
  console.log(
    `\x1b[33mPARTIAL\x1b[0m — everything run passed, but ${notRun} check(s) did not run.`
  );
  console.log('This is not a green build. Set MOBILE_TEST_TOKEN and MOBILE_TEST_VEHICLE_ID');
  console.log('to exercise the credentialed half, and CORS_ALLOWED_ORIGINS for the preflight.');
  process.exit(0);
}
console.log('\x1b[32mMobile client contract holds\x1b[0m — all checks ran and passed');
