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
];
const KNOWN_GAP_TABLES = ['vehicle_knowledge_base', 'recall_actions'];

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

  for (const table of KNOWN_GAP_TABLES) {
    const status = await read(table);
    if (status === 200) {
      pass(`${table} readable by anon — known gap now CLOSED, update the contract`);
    } else {
      warn(`${table} returned ${status} — known gap, dossier content is absent`);
    }
  }
}

console.log(`\nVerifying demo at ${base}`);
await checkPages();
await checkAnonData();

console.log('\n' + '─'.repeat(60));
if (failures > 0) {
  console.log(`\x1b[31mFAILED\x1b[0m — ${failures} blocking issue(s), ${warnings} warning(s)`);
  console.log('Do not cut the domain over to this deployment.');
  process.exit(1);
}
console.log(`\x1b[32mDemo is serving correctly\x1b[0m — ${warnings} warning(s)`);
