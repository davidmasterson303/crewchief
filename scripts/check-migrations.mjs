/**
 * Which migrations are actually applied to the live database.
 *
 *   node scripts/check-migrations.mjs           # every migration
 *   node scripts/check-migrations.mjs --pending # only the ones that are not applied
 *
 * ── ⚠ Why this exists ───────────────────────────────────────────────────────
 *
 * CLAUDE.md §2: "the database and the migrations folder disagree, both ways.
 * Never state what the schema does from a file read." And §1: a stale board is
 * not neutral — it buys work that is already done and hides what is left.
 *
 * Both have cost real time on this project, in both directions:
 *
 *   - `20260818120000` sat on the roadmap as item 1, marked ⛔ CRITICAL, with
 *     the note "until this lands the IAP webhook 503s every notification". It
 *     had been applied for at least three days. Anybody scanning for the next
 *     critical item would have gone to do finished work.
 *   - A metering migration was listed under a ⚠ heading calling it the item
 *     that gets worse by waiting, a fortnight after it was applied.
 *
 * Each of those took a hand-written probe to settle. This is that probe, made
 * repeatable — §2 already names the technique: **a column that does not exist
 * returns `42703`, and that is the cheapest applied/not check there is.**
 *
 * ── What it can and cannot see ──────────────────────────────────────────────
 *
 * It probes the *shape* a migration creates: a new table, or a new column on
 * an existing one. That covers every migration this project has needed to know
 * about.
 *
 * ⚠ It cannot see a migration that only changes **policies, grants or
 * functions** — PostgREST does not expose `information_schema`, and there is
 * no `exec_sql` RPC, so those remain a dashboard read. Such migrations are
 * reported as `no probe` rather than as applied. Reporting them green would be
 * the reassuring lie this whole file exists to prevent.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const PENDING_ONLY = process.argv.includes('--pending');

/**
 * ⚠ `SUPABASE_SECRET_KEY`, not `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * CLAUDE.md §2: the `SERVICE_ROLE` key in `.env` is stale and 401s. Reading
 * the wrong one produces an authentication failure that looks exactly like a
 * missing table, which would make every migration report as unapplied.
 */
function env() {
  const raw = readFileSync(join(ROOT, '.env'), 'utf8');
  const read = (key) => raw.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '');

  return { url: read('NEXT_PUBLIC_SUPABASE_URL'), key: read('SUPABASE_SECRET_KEY') };
}

/**
 * SQL with comments stripped.
 *
 * ⚠ Not optional. The first draft parsed `20260807220000` as creating a table
 * called `only`, from prose inside a docblock. Every scanner in this repo has
 * had to learn this and it is cheaper to inherit it.
 */
function statements(file) {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/** What shapes a migration introduces, as probes against PostgREST. */
function probesFor(sql) {
  const probes = [];

  for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi)) {
    probes.push({ table: match[1], column: null });
  }

  /*
    Columns are attributed to the table of the ALTER that precedes them. A
    single migration can alter more than one table, so the scan walks in order
    rather than assuming one.
  */
  for (const alter of sql.matchAll(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi
  )) {
    const [, table, body] = alter;
    for (const col of body.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
      probes.push({ table, column: col[1] });
    }
  }

  // A table this migration creates is proof enough; its own columns are noise.
  const created = new Set(probes.filter((p) => p.column === null).map((p) => p.table));
  return probes.filter((p) => p.column === null || !created.has(p.table));
}

const { url, key } = env();
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY missing from .env');
  process.exit(2);
}

async function probe({ table, column }) {
  const select = column ?? '*';
  const response = await fetch(`${url}/rest/v1/${table}?select=${select}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });

  if (response.ok) return { applied: true };

  const body = await response.json().catch(() => ({}));

  // PGRST205 — no such table. 42703 — no such column. Both mean "not applied".
  if (body.code === 'PGRST205' || body.code === '42703') return { applied: false };

  return { applied: null, why: body.message ?? `HTTP ${response.status}` };
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const rows = [];

for (const file of files) {
  const probes = probesFor(statements(file));

  if (probes.length === 0) {
    rows.push({ file, state: 'no probe', detail: 'policies, grants or functions only' });
    continue;
  }

  const results = await Promise.all(probes.map(probe));
  const shape = probes
    .map((p) => (p.column ? `${p.table}.${p.column}` : p.table))
    .slice(0, 3)
    .join(', ');

  if (results.some((r) => r.applied === null)) {
    rows.push({ file, state: 'unreadable', detail: results.find((r) => r.applied === null).why });
  } else if (results.every((r) => r.applied)) {
    rows.push({ file, state: 'applied', detail: shape });
  } else if (results.every((r) => !r.applied)) {
    rows.push({ file, state: 'NOT APPLIED', detail: shape });
  } else {
    /*
      ⚠ Some shapes present and some absent. A partially-applied migration is
      the worst state to be in and the easiest to miss, because anything
      checking one column would call it done.
    */
    rows.push({ file, state: 'PARTIAL', detail: shape });
  }
}

const shown = PENDING_ONLY ? rows.filter((r) => r.state !== 'applied') : rows;
const colour = { applied: '\x1b[32m', 'NOT APPLIED': '\x1b[31m', PARTIAL: '\x1b[31m' };

for (const row of shown) {
  const tint = colour[row.state] ?? '\x1b[33m';
  console.log(`${tint}${row.state.padEnd(12)}\x1b[0m ${row.file.replace(/\.sql$/, '')}`);
  if (row.detail) console.log(`             ${row.detail}`);
}

const pending = rows.filter((r) => r.state === 'NOT APPLIED' || r.state === 'PARTIAL');
console.log(
  `\n${rows.filter((r) => r.state === 'applied').length} applied · ` +
    `${pending.length} pending · ` +
    `${rows.filter((r) => r.state === 'no probe').length} not probeable`
);

if (pending.length > 0) {
  console.log('\nPending:');
  for (const row of pending) console.log(`  supabase/migrations/${row.file}`);
}

/*
  ⚠ Exit 0 even with pending migrations. This is an instrument, not a gate —
  unapplied migrations are a normal state in this project, since applying them
  is David's SQL editor and nobody else's. A non-zero exit would make it
  useless in a chain and would train people to ignore it.
*/
process.exit(0);
