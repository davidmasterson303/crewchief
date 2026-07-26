/**
 * Purge orphaned objects from the vehicle-documents bucket.
 *
 * ── Why this is a script and not SQL ────────────────────────────────────────
 *
 * The original migration tried `DELETE FROM storage.objects`. Supabase installs
 * a trigger, `storage.protect_delete()`, that rejects direct SQL deletion
 * against that table for every role including `postgres`:
 *
 *   ERROR: 42501: Direct deletion from storage tables is not allowed.
 *   Use the Storage API instead.
 *
 * The reason is sound: a bare SQL DELETE removes the metadata row but leaves
 * the S3-backed object behind — creating exactly the orphans this script
 * exists to clean up. The Storage API removes both together.
 *
 * Because the whole migration ran as one batch, that first statement failing
 * rolled everything back. A clean no-op rather than a partial apply.
 *
 * ── What counts as an orphan ────────────────────────────────────────────────
 *
 * An object no row in `vehicle_documents` points at. There are currently 54,
 * against 5 surviving rows — all of which hold `demo-placeholder.local` URLs
 * that never resolved to a real object.
 *
 * Cause: when Gemini parsing failed, `uploadInvoice` deleted the database row
 * and never removed the uploaded file. A rejected parse is a *normal* outcome
 * — not an automotive invoice, wrong vehicle, unreadable scan — so this leaked
 * on the common path. Fixed in application code; this clears the backlog.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/purge-orphaned-objects.mjs           # dry run, changes nothing
 *   node scripts/purge-orphaned-objects.mjs --apply   # actually deletes
 *
 * Dry run is the default deliberately: this deletes real files, and the
 * listing should be read before anything is destroyed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const BUCKET = 'vehicle-documents';

const DEMO_VEHICLE_IDS = [
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003',
];

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
// The legacy service_role JWT is invalid — signed by a rotated key. The modern
// sb_secret_ key is what actually authenticates.
const KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or a secret key in .env');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** List every object under a prefix, descending into folders. */
async function listRecursive(prefix = '', depth = 0) {
  if (depth > 5) return [];

  const res = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });

  if (!res.ok) {
    console.error(`  list failed at "${prefix}": ${res.status}`);
    return [];
  }

  const entries = await res.json();
  const out = [];

  for (const entry of entries) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Supabase marks folders with a null id.
    if (entry.id === null) out.push(...(await listRecursive(full, depth + 1)));
    else out.push(full);
  }

  return out;
}

/** Paths referenced by vehicle_documents — never delete these. */
async function referencedPaths() {
  const res = await fetch(`${URL_}/rest/v1/vehicle_documents?select=file_url`, { headers });
  if (!res.ok) throw new Error(`could not read vehicle_documents: ${res.status}`);

  const rows = await res.json();
  return new Set(
    rows
      .map((r) => String(r.file_url || ''))
      .map((u) => u.replace('placeholder://', ''))
      .filter(Boolean)
  );
}

console.log(`\n${APPLY ? 'PURGING' : 'DRY RUN — nothing will be deleted'}`);
console.log(`bucket: ${BUCKET}\n`);

const [all, referenced] = await Promise.all([listRecursive(), referencedPaths()]);

console.log(`objects found:      ${all.length}`);
console.log(`referenced by rows: ${referenced.size}`);

const orphans = all.filter((p) => !referenced.has(p));
const kept = all.filter((p) => referenced.has(p));

// Belt and braces. Demo vehicles have no objects in this bucket, but deleting
// one would take down the public demo, so it is worth refusing explicitly
// rather than relying on that remaining true.
const demoTouching = orphans.filter((p) => DEMO_VEHICLE_IDS.some((id) => p.includes(id)));
if (demoTouching.length > 0) {
  console.error('\nREFUSING — these would touch demo vehicles:');
  demoTouching.forEach((p) => console.error('  ' + p));
  process.exit(1);
}

console.log(`orphans to remove:  ${orphans.length}`);
console.log(`preserved:          ${kept.length}\n`);

if (orphans.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const byPrefix = orphans.reduce((acc, p) => {
  const top = p.split('/')[0];
  acc[top] = (acc[top] || 0) + 1;
  return acc;
}, {});
console.log('by top-level prefix:');
Object.entries(byPrefix)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

if (!APPLY) {
  console.log('\nRe-run with --apply to delete these.');
  process.exit(0);
}

// Chunked: the API takes a list, and one oversized request failing tells you
// nothing about which objects it managed to remove.
let removed = 0;
const CHUNK = 50;

for (let i = 0; i < orphans.length; i += CHUNK) {
  const batch = orphans.slice(i, i + CHUNK);
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: batch }),
  });

  if (!res.ok) {
    console.error(`\nbatch starting at ${i} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.error(`removed ${removed} before this point. Re-run to continue.`);
    process.exit(1);
  }
  removed += batch.length;
  console.log(`  removed ${removed}/${orphans.length}`);
}

const after = await listRecursive();
console.log(`\nremoved ${removed}. Objects remaining: ${after.length}`);
if (after.length !== kept.length) {
  console.warn(`expected ${kept.length} to remain — verify before proceeding`);
}
