/**
 * Photograph `maintenance_schedule` before anything writes to it.
 *
 *   node scripts/snapshot-maintenance-schedule.mjs
 *
 * Four rows, so a rollback from this file is a paste. That is the point: this
 * is not a backup system, it is the difference between a rollback and an
 * archaeology session.
 *
 * ── Why this is its own script and its own commit ───────────────────────────
 *
 * `CLAUDE_CODE_PROMPT_schedule_backfill_2026-08-07.md` step 7 said the snapshot
 * ships "alongside the script". It does not. **If `--apply` goes wrong, the
 * rollback must not depend on a commit that also contains the thing that went
 * wrong** — reverting one would revert the other, and the only copy of the
 * pre-write state would leave with it.
 *
 * So: run this, commit the JSON on its own, then run the backfill. The snapshot
 * exists in history before the first row is touched.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * It does not filter, normalise, or validate. The value of a snapshot is that
 * it is a copy of what was there, including the parts that are wrong — the
 * legacy `{item, interval}` prose shape is exactly what a rollback needs to
 * restore, and a "cleaned" snapshot restores something that was never in the
 * database.
 *
 * Exit codes:
 *   0  written
 *   1  the database answered, and the answer was not usable
 *   3  could not run — no credentials, or the database is unreachable
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

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

const url = env('NEXT_PUBLIC_SUPABASE_URL');
/*
  `SUPABASE_SECRET_KEY`, not `SUPABASE_SERVICE_ROLE_KEY`. The legacy key was
  signed by a rotated JWT key and returns 401 Invalid API key — verified 7 Aug.
  It is still present in `.env` and still looks plausible, which is the whole
  reason to name the working one explicitly here rather than falling back.
*/
const key = env('SUPABASE_SECRET_KEY');

if (!url || !key) {
  console.error('UNABLE — NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is not set');
  process.exit(3);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} on ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

let vehicles;
let knowledge;
try {
  vehicles = await get('vehicles?select=id,year,make,model,trim,current_mileage&order=year');
  knowledge = await get(
    'vehicle_knowledge_base?select=vehicle_id,maintenance_schedule,engine_type,transmission_type,drivetrain,research_status,last_research_date'
  );
} catch (error) {
  console.error(`UNABLE — ${error.message}`);
  process.exit(3);
}

if (!Array.isArray(knowledge) || knowledge.length === 0) {
  console.error('FAILED — vehicle_knowledge_base returned no rows. Refusing to write an empty snapshot.');
  process.exit(1);
}

const takenAt = new Date().toISOString();

const rows = knowledge.map((kb) => {
  const vehicle = vehicles.find((v) => v.id === kb.vehicle_id) ?? null;
  return {
    vehicle_id: kb.vehicle_id,
    identity: vehicle
      ? {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim,
          current_mileage: vehicle.current_mileage,
        }
      : null,
    /*
      Carried alongside the schedule because these three are the §23 regression
      signal. The Accord's `CVT` is the single best canary for "did something
      re-research this row", and a snapshot that only holds the schedule cannot
      answer that question after the fact.
    */
    powertrain_at_snapshot: {
      engine_type: kb.engine_type,
      transmission_type: kb.transmission_type,
      drivetrain: kb.drivetrain,
    },
    research_status: kb.research_status,
    last_research_date: kb.last_research_date,
    maintenance_schedule: kb.maintenance_schedule,
  };
});

const entryCount = rows.reduce(
  (n, r) => n + (Array.isArray(r.maintenance_schedule) ? r.maintenance_schedule.length : 0),
  0
);

const filename = `maintenance_schedule_snapshot_${takenAt.replace(/[:.]/g, '-')}.json`;
const path = join(here, filename);

writeFileSync(
  path,
  `${JSON.stringify(
    {
      taken_at: takenAt,
      source: 'PostgREST, SUPABASE_SECRET_KEY',
      project_ref: url.replace(/^https:\/\//, '').split('.')[0],
      row_count: rows.length,
      entry_count: entryCount,
      rows,
    },
    null,
    2
  )}\n`
);

console.log(`Wrote scripts/${filename}`);
console.log(`${rows.length} rows, ${entryCount} schedule entries.`);
for (const row of rows) {
  const id = row.identity
    ? `${row.identity.year} ${row.identity.make} ${row.identity.model} ${row.identity.trim ?? ''}`.trim()
    : row.vehicle_id;
  const n = Array.isArray(row.maintenance_schedule) ? row.maintenance_schedule.length : 0;
  console.log(`  ${String(n).padStart(2)} entries  ${id}`);
}
console.log('\nCommit this file on its own before running the backfill.');
