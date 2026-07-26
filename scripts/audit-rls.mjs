/**
 * Task 0.2 — empirical RLS / grants audit.
 *
 * We cannot read pg_policies without a direct Postgres connection, and this
 * project's database is Bolt-managed so there is no dashboard access yet.
 * So this audits *behaviour* instead of configuration — which is arguably the
 * better test anyway: it asks what an anonymous attacker holding the public
 * key can actually reach, rather than what the policies claim.
 *
 * READ-ONLY. Performs no inserts, updates or deletes.
 *
 *   node scripts/audit-rls.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !ANON) {
  console.error('Missing URL or anon key in .env');
  process.exit(1);
}

const DEMO_VEHICLE_IDS = [
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003',
];

const TABLES = [
  'vehicles', 'wishlist_items', 'maintenance_line_items', 'invoice_line_items',
  'service_items', 'vehicle_documents', 'consultant_conversations',
  'consultant_documents', 'vehicle_knowledge_base', 'vehicle_health_summary',
  'vehicle_health_history', 'nhtsa_data', 'modification_tracking',
  'modification_details', 'known_issue_tracking', 'quote_requests',
  'labor_bundles', 'maintenance_dismissals', 'recall_actions',
  'api_rate_limits', 'mod_names_cache', 'mod_detail_queue',
  'performance_mod_cache', 'tier_backfill_queue', 'location_zones',
];

async function q(table, key, params = 'select=*&limit=1000') {
  const res = await fetch(`${URL_}/rest/v1/${table}?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { blocked: true, status: res.status };
  const rows = await res.json();
  return { blocked: false, rows: Array.isArray(rows) ? rows : [] };
}

console.log(`\nProject: ${URL_}`);
console.log('Auditing what an ANONYMOUS caller (public key only) can read.\n');

const findings = [];
let anonReadable = 0;

console.log('TABLE                          ANON      SERVICE   VERDICT');
console.log('─'.repeat(72));

for (const t of TABLES) {
  const anon = await q(t, ANON);
  const svc = SECRET ? await q(t, SECRET) : { blocked: true, status: 0 };

  const anonCount = anon.blocked ? null : anon.rows.length;
  const svcCount = svc.blocked ? null : svc.rows.length;

  let verdict = 'ok — anon blocked';
  if (!anon.blocked) {
    anonReadable++;
    // Is everything anon sees confined to demo vehicles?
    const ids = anon.rows.map((r) => r.vehicle_id ?? r.id).filter(Boolean);
    const nonDemo = ids.filter((id) => !DEMO_VEHICLE_IDS.includes(id));
    if (anonCount === 0) {
      verdict = 'anon allowed, 0 rows';
    } else if (nonDemo.length === 0) {
      verdict = 'anon sees demo only';
    } else {
      verdict = `LEAK — ${nonDemo.length} non-demo rows`;
      findings.push({ table: t, nonDemo: nonDemo.length, total: anonCount });
    }
  }

  console.log(
    t.padEnd(30) +
      String(anon.blocked ? `${anon.status}` : anonCount).padEnd(10) +
      String(svc.blocked ? '—' : svcCount).padEnd(10) +
      verdict
  );
}

console.log('\n' + '─'.repeat(72));
console.log(`Tables readable by anon: ${anonReadable}/${TABLES.length}`);

if (findings.length) {
  console.log('\n*** CONFIRMED DATA EXPOSURE ***');
  for (const f of findings) {
    console.log(`  ${f.table}: anon can read ${f.nonDemo} rows belonging to real users`);
  }
} else {
  console.log('\nNo non-demo rows reachable by anon.');
}

// Storage: is the documents bucket still public?
console.log('\n─── storage ───');
const bucketRes = await fetch(`${URL_}/storage/v1/bucket/vehicle-documents`, {
  headers: { apikey: SECRET || ANON, Authorization: `Bearer ${SECRET || ANON}` },
});
if (bucketRes.ok) {
  const b = await bucketRes.json();
  console.log(`vehicle-documents  public=${b.public}  ${b.public ? '*** PUBLIC — RLS BYPASSED ON READ ***' : 'private'}`);
} else {
  console.log(`could not read bucket config (${bucketRes.status})`);
}
