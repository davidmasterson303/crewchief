/**
 * Re-research vehicles whose maintenance schedule is still prose.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * `81022f9` made `maintenance_schedule` structured — `{service, interval_miles}`
 * instead of `{item, interval: "every 30,000 miles"}` — because a service-due
 * notification has to compare an interval against an odometer reading, and
 * prose cannot be compared to anything.
 *
 * Every vehicle onboarded before 7 Aug 2026 still holds prose. Those cars are
 * **ineligible for service notifications** until their knowledge base is
 * regenerated, and that is deliberate: guessing a number out of "every 2 years
 * or 24k" would be right most of the time, and most of the time is the wrong
 * standard for telling someone their car needs work.
 *
 * ── Why it does not call the model itself ───────────────────────────────────
 *
 * The obvious script generates the research here: read the vehicle, build the
 * prompt, call Gemini, validate, write. **That would be a second copy of the
 * generation path**, and this project has been bitten repeatedly by exactly
 * that shape — `VehicleDataSchema` was defined twice and the structured-schedule
 * change would have edited one copy and left the other accepting prose.
 *
 * `components/VehicleInsights.tsx:90` already re-runs research whenever it sees
 * `research_status` of `pending` or `failed`. So this script sets the status and
 * the one existing, tested, metered path does the work. The AI spend lands on
 * the normal instrumentation with `surface` set, rather than in a script that
 * bills to nothing in particular.
 *
 * ── The cost of that, stated plainly ────────────────────────────────────────
 *
 * Regeneration is **lazy**: it happens the next time someone opens that car's
 * dashboard. A car nobody opens is never regenerated, so it never becomes
 * eligible for service notifications — and a notification is precisely the
 * feature meant to reach someone who is *not* in the app.
 *
 * That is a real gap and it is David's call, not this script's. Eager
 * regeneration needs a route that can drive the generation path without a
 * browser session; there is none today. Until then this covers active cars,
 * which is where the value is concentrated anyway.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *
 * Dry run by default: it reads, groups and reports, and writes nothing. It
 * never touches a vehicle whose schedule is already structured, and it never
 * deletes a knowledge base — a car keeps its current research, prose and all,
 * until better research replaces it.
 *
 *   node scripts/backfill-maintenance-schedule.mjs           # report only
 *   node scripts/backfill-maintenance-schedule.mjs --apply   # mark for re-research
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPLY = process.argv.includes('--apply');

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
/*
  `SUPABASE_SECRET_KEY` first. The `SERVICE_ROLE` key in this project's .env is
  stale and 401s — a fact that has cost debugging time more than once, and the
  reason the fallback is second rather than first.
*/
const SECRET = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !SECRET) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

/** Same rule as `isUsableScheduleEntry` in `@crewchief/core/vehicle-utils`. */
function isStructured(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    typeof entry.service === 'string' &&
    entry.service.trim().length > 0 &&
    typeof entry.interval_miles === 'number' &&
    Number.isFinite(entry.interval_miles) &&
    entry.interval_miles > 0
  );
}

async function rest(path, options = {}) {
  const response = await fetch(`${URL_}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  return response.status === 204 ? null : response.json();
}

const rows = await rest(
  'vehicle_knowledge_base?select=vehicle_id,research_status,maintenance_schedule'
);

const classified = { structured: [], prose: [], empty: [], notReady: [] };

for (const row of rows) {
  if (row.research_status !== 'completed') {
    // Already pending, failed or unsupported. Marking it again changes nothing
    // and would misreport the number of cars this run affected.
    classified.notReady.push(row);
    continue;
  }

  const schedule = Array.isArray(row.maintenance_schedule) ? row.maintenance_schedule : [];

  if (schedule.length === 0) classified.empty.push(row);
  else if (schedule.every(isStructured)) classified.structured.push(row);
  else classified.prose.push(row);
}

console.log(`\nvehicle_knowledge_base rows: ${rows.length}\n`);
console.log(`  already structured        ${classified.structured.length}`);
console.log(`  prose — needs re-research ${classified.prose.length}`);
console.log(`  empty schedule            ${classified.empty.length}`);
console.log(`  not 'completed'           ${classified.notReady.length}`);

/*
  An empty schedule is included. It is indistinguishable from a prose one for
  our purposes — neither can produce a service notification — and a car whose
  research returned no schedule at all is a car worth asking about again.
*/
const targets = [...classified.prose, ...classified.empty];

if (targets.length === 0) {
  console.log('\nNothing to do.\n');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nDRY RUN. ${targets.length} vehicles would be marked for re-research.`);
  console.log('Each regenerates the next time someone opens its dashboard, through the');
  console.log('normal metered path — no AI spend happens in this script.\n');
  console.log('Re-run with --apply to mark them.\n');
  process.exit(0);
}

let marked = 0;
for (const row of targets) {
  try {
    await rest(`vehicle_knowledge_base?vehicle_id=eq.${row.vehicle_id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      /*
        `pending`, not `failed`. Both re-trigger research, and `failed` would
        render the dashboard's error state to an owner whose car is fine —
        a status is read by the UI, not only by this script.
      */
      body: JSON.stringify({ research_status: 'pending' }),
    });
    marked++;
  } catch (error) {
    console.error(`  ${row.vehicle_id}: ${error.message}`);
  }
}

console.log(`\nMarked ${marked} of ${targets.length} for re-research.`);
console.log('They regenerate on next dashboard visit. Cars nobody opens stay as they are —');
console.log('see the header for why that gap is deliberate and what closing it would take.\n');
