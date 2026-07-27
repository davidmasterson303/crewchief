/**
 * Live demo verifier — the pre-cutover gate.
 *
 * Checks that a *deployed* build actually serves the public demo. The unit
 * tests in lib/__tests__/demo-availability.test.ts prove the auth machinery
 * lets anonymous visitors through; this proves a real deployment renders.
 *
 * Run it against the candidate site before pointing the domain at it, and
 * against the live site any time you want reassurance:
 *
 *   node scripts/verify-demo.mjs                      # the live demo
 *   node scripts/verify-demo.mjs https://<site>.netlify.app
 *
 * Exits non-zero on failure, so it can gate a deploy step.
 *
 * Read-only. It fetches pages and queries the public REST endpoint with the
 * publishable key — exactly what an anonymous visitor's browser does.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// The contract is TypeScript, so mirror the few values needed rather than
// adding a build step to a script whose whole point is being runnable now.
const DEMO_VEHICLE_ID = 'a1000000-0000-0000-0000-000000000001';
const REQUIRED_ANON_TABLES = [
  'vehicles',
  'vehicle_health_summary',
  'nhtsa_data',
  'wishlist_items',
  // Closed 26 Jul by 20260726140000, and verified live. These were known gaps
  // for eight weeks: the client queries use maybeSingle(), so a 401 resolved
  // to null and the dossier rendered with a hole rather than an error.
  'vehicle_knowledge_base',
  'recall_actions',
];

const DEFAULT_BASE = 'https://crewchief-demo.davidmasterson.co';
const base = (process.argv[2] || DEFAULT_BASE).replace(/\/$/, '');

const PAGE_CHECKS = [
  { path: '/demo', mustContain: ['Honda', 'Subaru', 'BMW'], label: 'demo garage' },
  { path: `/dashboard/${DEMO_VEHICLE_ID}`, mustContain: ['Accord'], label: 'vehicle dashboard' },
  { path: `/consultant/${DEMO_VEHICLE_ID}`, mustContain: [], label: 'consultant' },
];

let failures = 0;
let warnings = 0;

function pass(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function fail(msg) {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  failures++;
}
function warn(msg) {
  console.log(`  \x1b[33m!\x1b[0m ${msg}`);
  warnings++;
}

async function checkPages() {
  console.log('\nPages an anonymous visitor must reach');
  for (const check of PAGE_CHECKS) {
    const url = `${base}${check.path}`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const finalPath = new URL(res.url).pathname;

      // The failure mode that actually happened: middleware bouncing the
      // demo to /login. A 200 on the login page is still a broken demo.
      if (finalPath.startsWith('/login')) {
        fail(`${check.label} redirected to /login — demo is gated behind auth`);
        continue;
      }
      if (!res.ok) {
        fail(`${check.label} returned HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const missing = check.mustContain.filter((t) => !html.includes(t));
      if (missing.length > 0) {
        // Content is client-rendered, so absence from initial HTML is not
        // proof of breakage — flag rather than fail.
        warn(`${check.label} loaded but initial HTML lacks: ${missing.join(', ')}`);
      } else {
        pass(`${check.label} — HTTP 200 at ${finalPath}`);
      }
    } catch (error) {
      fail(`${check.label} — request failed: ${error.message}`);
    }
  }
}

/*
 * Does the deployment's AI credential actually work?
 *
 * This check exists because the consultant — the demo's headline feature,
 * advertised on the portfolio as live — was dead in production and passed every
 * gate this project has, including this script and the promote gate that runs
 * it. Page checks proved `/consultant/<id>` returned 200. It did. Sending a
 * message returned an error every time.
 *
 * A blocking failure, not a warning: shipping a demo whose advertised feature
 * errors is worse than not shipping. It is the same reasoning as the data
 * checks below.
 *
 * /api/health/ai lists models rather than asking a question, so this costs no
 * tokens and takes no input — see the route for why a prompt-based check would
 * have been a public endpoint that spends money on request.
 */
async function checkAiCredential() {
  console.log('\nThe AI credential this build will actually use');
  const url = `${base}/api/health/ai`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    let body = {};
    try {
      body = await res.json();
    } catch {
      /* fall through to the status-only message */
    }

    if (res.status === 404) {
      // A build predating the route. Not a credential failure, and not
      // something to fail a promote over.
      warn('no /api/health/ai on this build — cannot verify the AI credential');
      return;
    }
    if (res.ok && body.ok) {
      pass(`Gemini credential accepted (${body.models ?? '?'} models visible)`);
      return;
    }
    fail(`Gemini credential rejected — ${body.reason || `HTTP ${res.status}`}`);
    console.log('        the consultant will error on every message until this is fixed');
  } catch (error) {
    fail(`could not reach ${url} — ${error.message}`);
  }
}

async function checkAnonData() {
  console.log('\nData an anonymous browser reads directly');

  let env;
  try {
    env = Object.fromEntries(
      readFileSync(join(here, '..', '.env'), 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        })
    );
  } catch {
    warn('no .env found — skipping data checks');
    return;
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    warn('no Supabase URL/key in .env — skipping data checks');
    return;
  }

  const read = async (table) => {
    const res = await fetch(
      `${url}/rest/v1/${table}?select=*&vehicle_id=eq.${DEMO_VEHICLE_ID}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    return res.status;
  };

  // `vehicles` keys on id, not vehicle_id.
  const vehiclesStatus = await fetch(
    `${url}/rest/v1/vehicles?select=id&id=eq.${DEMO_VEHICLE_ID}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).then((r) => r.status);

  if (vehiclesStatus === 200) pass('vehicles readable by anon');
  else fail(`vehicles returned ${vehiclesStatus} for anon — the demo cannot load`);

  for (const table of REQUIRED_ANON_TABLES.filter((t) => t !== 'vehicles')) {
    const status = await read(table);
    if (status === 200) pass(`${table} readable by anon`);
    else fail(`${table} returned ${status} for anon — demo content will be missing`);
  }

  await checkVehicleImages(url, key);
}

/*
 * Do the demo vehicles' photos actually resolve, and are they ours?
 *
 * Two failures this catches, both of which happened.
 *
 * The photos used to be live images.pexels.com URLs — a third-party runtime
 * dependency on the recruiter-facing demo. Nothing checked for that, so nothing
 * would have noticed it coming back.
 *
 * Then, when they moved to local files, the migration that repointed image_url
 * ran before the build carrying the files was deployed. For about four minutes
 * every demo hero was a 404 while the database confidently pointed at
 * /vehicles/<slug>/hero-3x2.jpg. The existing checks all passed throughout:
 * pages returned 200, tables were readable, and the *strings* "Honda",
 * "Subaru", "BMW" were present. Only the images were missing.
 *
 * Asserting the database's paths against the deployment being verified is what
 * closes that gap — it compares the two halves that have to agree.
 */
async function checkVehicleImages(supabaseUrl, key) {
  console.log('\nVehicle photos the demo points at');
  let rows;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/vehicles?select=make,model,image_url&is_demo=eq.true`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) {
      warn(`could not read demo vehicles to check photos (HTTP ${res.status})`);
      return;
    }
    rows = await res.json();
  } catch (error) {
    warn(`could not read demo vehicles to check photos — ${error.message}`);
    return;
  }

  for (const v of rows) {
    const label = `${v.make} ${v.model}`;
    if (!v.image_url) {
      warn(`${label} has no image_url`);
      continue;
    }

    // Off-origin means a third-party CDN is back in the critical path.
    if (/^https?:\/\//i.test(v.image_url)) {
      fail(`${label} points off-origin: ${v.image_url.slice(0, 60)}`);
      continue;
    }

    const imageUrl = `${base}${v.image_url}`;
    try {
      const res = await fetch(imageUrl, { method: 'GET', redirect: 'follow' });
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.startsWith('image/')) {
        pass(`${label} — ${v.image_url}`);
      } else {
        fail(`${label} — ${v.image_url} returned ${res.status} ${type || '(no content-type)'}`);
        console.log('        the database points at a file this build does not serve');
      }
    } catch (error) {
      fail(`${label} — could not fetch ${v.image_url}: ${error.message}`);
    }
  }
}

/*
 * The API routes an anonymous visitor's browser actually calls.
 *
 * This check exists because /api/v1/load-vehicle returned
 * 500 "Invalid API key" on both deployed projects and nothing noticed. The
 * route reached for the service-role client even on a demo vehicle, the
 * deployed service-role key is rejected, and the only thing that would have
 * called the route — hooks/useVehicle.ts — has no consumers. A broken endpoint
 * with no caller is invisible to every gate that looks at pages.
 *
 * Same reasoning as checkAiCredential above: a 200 on the page proves the page
 * renders, not that the data path behind it works.
 *
 * Only demo-readable routes belong here. /api/v1/load-maintenance-data is
 * deliberately absent — the `anon` role is refused SELECT on all four tables
 * it reads, so it cannot serve an anonymous visitor by design, and asserting
 * it would be asserting something the demo does not depend on.
 */
async function checkDemoApiRoutes() {
  console.log('\nAPI routes the demo depends on');

  const checks = [
    {
      label: '/api/v1/load-vehicle',
      path: `/api/v1/load-vehicle?vehicleId=${DEMO_VEHICLE_ID}`,
      // The demo Accord. Proves it returned the vehicle, not merely a 200.
      mustContain: 'Accord',
    },
  ];

  for (const check of checks) {
    try {
      const res = await fetch(`${base}${check.path}`);
      const body = await res.text();

      if (!res.ok) {
        // Surface the real message — "Invalid API key" is the whole story.
        let detail = body.slice(0, 120);
        try {
          detail = JSON.parse(body).error ?? detail;
        } catch {}
        fail(`${check.label} returned HTTP ${res.status} — ${detail}`);
        continue;
      }

      if (!body.includes(check.mustContain)) {
        fail(`${check.label} returned 200 but without ${check.mustContain}`);
        continue;
      }

      pass(`${check.label} — served the demo vehicle anonymously`);
    } catch (error) {
      fail(`${check.label} — request failed: ${error.message}`);
    }
  }
}

console.log(`\nVerifying demo at ${base}`);
await checkPages();
await checkAiCredential();
await checkDemoApiRoutes();
await checkAnonData();

console.log('\n' + '─'.repeat(60));
if (failures > 0) {
  console.log(`\x1b[31mFAILED\x1b[0m — ${failures} blocking issue(s), ${warnings} warning(s)`);
  console.log('Do not cut the domain over to this deployment.');
  process.exit(1);
}
console.log(`\x1b[32mDemo is serving correctly\x1b[0m — ${warnings} warning(s)`);
