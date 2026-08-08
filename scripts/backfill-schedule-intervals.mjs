/**
 * Turn four cars' prose maintenance intervals into numbers a screen can use.
 *
 *   node scripts/backfill-schedule-intervals.mjs              # dry run, writes nothing
 *   node scripts/backfill-schedule-intervals.mjs --apply      # writes maintenance_schedule
 *   node scripts/backfill-schedule-intervals.mjs --vehicle M235i
 *   node scripts/backfill-schedule-intervals.mjs --model lite
 *
 * `service-due.ts` needs a number to compare against an odometer. Every vehicle
 * in the product carries `{item: "Spark Plugs", interval: "30,000 mi"}` instead,
 * so the milestone screen and the service-due notification currently produce
 * **nothing for every car**. Four rows, 29 entries. That is the whole job.
 *
 * ── ⚠ What this script must never become ────────────────────────────────────
 *
 * The obvious implementation is "re-run onboarding research and save the
 * result". It is a trap, and the trap is one line:
 *
 *     app/actions.ts:467
 *     const prompt = VEHICLE_RESEARCH_PROMPT(vehicle.year, vehicle.make, vehicle.model);
 *
 * **Trim is not passed.** The Accord is a `Sport 1.5T` and the model would be
 * asked about "2018 Honda Accord" — the exact ambiguity §23 spent a migration
 * and six field-level corrections resolving. The write at `app/actions.ts:564`
 * then overwrites six fields unconditionally: `known_issues`,
 * `maintenance_schedule`, `fluid_specs`, `common_mods`, `reliability_score`,
 * `interesting_facts`. The WRX's Stage 1 tune context and the M235i's
 * hand-authored "more frequently if tuned" note live in that six.
 *
 * So this script reads the entries that already exist, asks only for numbers,
 * and writes only `maintenance_schedule`. It structurally cannot regress §23,
 * and that is a property worth more than the tokens it saves.
 *
 * ── Two readers, and they have to agree ─────────────────────────────────────
 *
 * `vehicle-utils.ts` argues against parsing prose intervals back into numbers:
 * "a parser would be right most of the time, and *most of the time* is the
 * wrong standard for a notification that tells someone their car needs work."
 * That is correct, and it is an argument against a parser being the *authority*
 * — not against it existing.
 *
 * So both read every entry: a deterministic parser here, and the model. Where
 * they agree, the number is as trustworthy as this exercise can make it. Where
 * they disagree, the entry is **flagged rather than silently resolved**, and a
 * human picks. A parser that is right most of the time is a bad authority and
 * an excellent second opinion, and the disagreements are the only entries worth
 * anyone's attention.
 *
 * ── The conservative end, except where it lies ──────────────────────────────
 *
 * A range takes its low end. Telling someone to service early costs money;
 * telling them late costs an engine.
 *
 * **But four of the M235i's entries span 15,000 miles or more** — "60,000 -
 * 80,000 miles". Collapsing that to 60,000 turns a 20,000-mile spread into a
 * precision the screen will render as fact. Those four take the low end *and*
 * carry the range in `description`, and the dry run prints them as their own
 * group so they get read as four decisions rather than as part of the 14.
 *
 * ── The prose is not discardable ────────────────────────────────────────────
 *
 * The structured shape has no `interval` field, so any qualifier in the
 * original string — "(aggressive driving)", "(more frequently if tuned)",
 * "before track day", "or OLM" — has nowhere to go but `description`. It is
 * owner knowledge and shop advice, not decoration, and dropping it while
 * "structuring" the row would be a silent loss. Every entry whose prose says
 * more than its numbers keeps that prose verbatim.
 *
 * Exit codes:
 *   0  ran, and either printed a dry run or wrote successfully
 *   1  ran and something is wrong — a disagreement in --apply, a failed write
 *   2  the model was unavailable. Not ours
 *   3  could not run — no credentials, unreachable database
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
/*
  The write-time shape lives in its own module because a test has to be able to
  import it. `scripts/__tests__/schedule-entry-shape.test.ts` runs the real
  `VehicleDataSchema` and that mirror against the same cases — which is what
  makes the duplication safe, and which already caught two places where the
  mirror was looser than the schema it claims to mirror.
*/
import { validateEntry } from './lib/schedule-entry-shape.mjs';

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

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const flagValue = (name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : '';
};
const ONLY = flagValue('--vehicle').toLowerCase();

/*
  Flash rather than Lite by default, and the spec allowed either.

  This output is persisted and then read by every later answer — the same
  argument `models.ts` makes for putting the dossier on Pro. The job also is not
  pure extraction: it has to notice that "or OLM" and "before track day" are
  qualifiers rather than intervals, and leave them alone. `--model lite` is
  there for a re-run once the shape is known good.
*/
const FLASH_MODEL = 'gemini-3.6-flash';
const LITE_MODEL = 'gemini-3.5-flash-lite';
const MODEL = flagValue('--model') === 'lite' ? LITE_MODEL : FLASH_MODEL;

const url = env('NEXT_PUBLIC_SUPABASE_URL');
const key = env('SUPABASE_SECRET_KEY'); // the legacy service-role key 401s; see the snapshot script
const geminiKey = env('GEMINI_API_KEY');

if (!url || !key) {
  console.error('UNABLE — NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is not set');
  process.exit(3);
}
if (!geminiKey) {
  console.error('UNABLE — GEMINI_API_KEY is not set');
  process.exit(3);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const genAI = new GoogleGenAI({ apiKey: geminiKey });

/** A range this wide is a judgement about use, not a specification. */
const WIDE_SPREAD_MILES = 15_000;

// ─── The deterministic reader ────────────────────────────────────────────────

const MILEAGE_UNIT = /\b(mi|mile|miles|k)\b/i;

function numbersIn(text) {
  return [...text.matchAll(/(\d[\d,]*)\s*(k\b)?/gi)]
    .map((m) => {
      const n = Number(m[1].replace(/,/g, ''));
      return m[2] ? n * 1000 : n;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Read an interval string the way a careful person would, and say how sure it is.
 *
 * Deliberately narrow: it reads the mileage clause and the time clause and
 * refuses anything it does not recognise, rather than reaching. An unread
 * entry is visible; a misread one is not.
 */
function parseInterval(prose) {
  const text = String(prose ?? '').trim();

  // Split on "or" only when it separates a mileage clause from a time clause —
  // "0W-30 or 0W-40" is a fluid spec, not two intervals, and lives in `item`.
  const timeMatch = text.match(/(\d+)\s*(?:-\s*(\d+)\s*)?(year|yr|month|mo)s?\b/i);
  let months = null;
  if (timeMatch) {
    const unit = timeMatch[3].toLowerCase().startsWith('y') ? 12 : 1;
    const low = Number(timeMatch[1]) * unit;
    const high = timeMatch[2] ? Number(timeMatch[2]) * unit : null;
    months = { low, high };
  }

  // The mileage clause is everything that is not the time clause.
  const mileageText = timeMatch ? text.replace(timeMatch[0], ' ') : text;
  let miles = null;
  if (MILEAGE_UNIT.test(mileageText)) {
    const found = numbersIn(mileageText).filter((n) => n >= 1000);
    if (found.length === 1) miles = { low: found[0], high: null };
    if (found.length >= 2) miles = { low: Math.min(...found), high: Math.max(...found) };
  }

  /*
    Width is decided on the mileage spread alone, before anything else.

    The first version tested `miles && months` first, which filed the M235i's
    "50,000 - 80,000 miles or 5 years" as a both-intervals entry and hid a
    30,000-mile spread inside the ordinary-range group. A time clause does not
    make a wide mileage range narrow, and the wide ones are the entries this
    report exists to put in front of someone.
  */
  const spread = miles && miles.high !== null ? miles.high - miles.low : 0;

  let kind;
  if (spread >= WIDE_SPREAD_MILES) kind = 'wide_range';
  else if (miles && months) kind = 'both';
  else if (!miles && months) kind = 'time_only';
  else if (miles && miles.high === null) kind = 'exact';
  else if (miles) kind = 'range';
  else kind = 'unreadable';

  return { kind, miles, months, spread, prose: text };
}

/** Does the original string say something the two numbers cannot? */
function proseCarriesMore(parsed) {
  if (parsed.kind === 'unreadable') return true;
  if (parsed.miles?.high) return true; // a range collapsed to its low end
  if (parsed.months?.high) return true;
  // Any qualifier: parentheses, a slash clause, "if", "before", "or".
  return /[()/]|\b(if|before|when|aggressive|track|tuned|olm)\b/i.test(parsed.prose);
}

// ─── The model reader ────────────────────────────────────────────────────────

const BACKFILL_PROMPT = (vehicle, entries) => `You are a factory service-schedule reference for one specific vehicle.

VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}

The trim matters and is given above. Answer for this exact trim.

Below are ${entries.length} maintenance items already recorded for this vehicle, each with its interval written as prose. Your job is to read each prose interval and return it as numbers. You are NOT researching the vehicle and you are NOT adding, removing, renaming or reordering items.

${entries.map((e, i) => `${i}. item: ${JSON.stringify(e.item ?? e.service ?? '')}\n   interval: ${JSON.stringify(e.interval ?? '')}\n   priority: ${JSON.stringify(e.priority ?? '')}`).join('\n')}

For each item, return:

- "interval_miles": the mileage interval as a positive whole number, or null if the prose states no mileage interval.
- "interval_months": the time interval as a positive whole number of months, or null if the prose states no time interval. Use null, never 0 — 0 months means due immediately.
- "description": one plain sentence, at most 140 characters, saying what the service involves and why it matters on this vehicle. Do not restate the interval numbers.

RULES, in order of importance:

1. Read the prose. Do not substitute your own knowledge of the vehicle for what is written. If the prose says 30,000 miles and you believe 45,000, return 30,000.
2. A range takes its LOW end: "5,000-7,500 mi" is 5000. Servicing early costs money; servicing late costs an engine.
3. If the prose states no interval you can turn into a number, return null for that field. An entry with both fields null is acceptable and expected for anything unreadable. Never invent a number to fill a gap.
4. Parenthetical text is a qualifier, not an interval: "(aggressive driving)", "(more frequently if tuned)", "(or OLM)", "(NGK Iridium)", "before track day". These do not change the numbers.
5. "3 years" is 36 months and no mileage. "6-12 months" is 6 months and no mileage. "5,000 - 7,500 miles or 6-12 months" is 5000 miles AND 6 months.

Return ONLY a JSON array of exactly ${entries.length} objects, in the same order as the list above, each of the form:
{"index": number, "item": string, "interval_miles": number or null, "interval_months": number or null, "description": string}

The "item" you return must be copied character-for-character from the list above. No markdown, no commentary.`;

const ModelReplySchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    item: z.string(),
    interval_miles: z.number().positive().nullable(),
    interval_months: z.number().positive().nullable(),
    description: z.string().default(''),
  })
);

async function readWithModel(vehicle, entries) {
  const config = {
    temperature: 0.3,
    topK: 20,
    topP: 0.9,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    // 3.x families accept a thinking level; 2.5 answers it with a hard 400.
    ...(MODEL.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
  };

  const response = await genAI.models.generateContent({
    model: MODEL,
    contents: BACKFILL_PROMPT(vehicle, entries),
    config,
  });

  const text = response.text || '';
  let raw;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?/, '').replace(/```$/, '').trim());
  } catch {
    throw new Error(`model returned unparseable JSON (${text.length} chars)`);
  }

  const parsed = ModelReplySchema.parse(raw);
  if (parsed.length !== entries.length) {
    throw new Error(`model returned ${parsed.length} entries for ${entries.length} inputs`);
  }

  return { entries: parsed, usage: response.usageMetadata ?? null };
}

// ─── Where the two readers meet ──────────────────────────────────────────────

function reconcile(original, mine, theirs) {
  const disagreements = [];

  const takeMiles = () => {
    const parserSays = mine.miles ? mine.miles.low : null;
    const modelSays = theirs.interval_miles ?? null;
    if (parserSays === modelSays) return parserSays;
    disagreements.push(`interval_miles: parser ${parserSays ?? 'null'} vs model ${modelSays ?? 'null'}`);
    // The lower non-null number, because that is the conservative direction and
    // an unresolved disagreement should not be the one that services late.
    const candidates = [parserSays, modelSays].filter((n) => typeof n === 'number');
    return candidates.length ? Math.min(...candidates) : null;
  };

  const takeMonths = () => {
    const parserSays = mine.months ? mine.months.low : null;
    const modelSays = theirs.interval_months ?? null;
    if (parserSays === modelSays) return parserSays;
    disagreements.push(`interval_months: parser ${parserSays ?? 'null'} vs model ${modelSays ?? 'null'}`);
    const candidates = [parserSays, modelSays].filter((n) => typeof n === 'number');
    return candidates.length ? Math.min(...candidates) : null;
  };

  const interval_miles = takeMiles();
  const interval_months = takeMonths();

  const service = original.item ?? original.service ?? '';
  const modelDescription = (theirs.description ?? '').trim();
  const description = proseCarriesMore(mine)
    ? [modelDescription, `Interval as recorded: ${mine.prose}`].filter(Boolean).join(' ')
    : modelDescription;

  return {
    service,
    interval_miles,
    interval_months,
    description,
    priority: original.priority,
    _kind: mine.kind,
    _spread: mine.spread,
    _prose: mine.prose,
    _disagreements: disagreements,
  };
}

// ─── Reading and writing the rows ────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function writeSchedule(vehicleId, schedule) {
  const res = await fetch(`${url}/rest/v1/vehicle_knowledge_base?vehicle_id=eq.${vehicleId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    /*
      One column. Not `research_status`, not `last_research_date`, and above all
      not the six fields `app/actions.ts:564` writes — `VehicleInsights.tsx:90`
      re-researches a row marked `pending`, and a re-research is the clobber
      this whole script is shaped to avoid.
    */
    body: JSON.stringify({ maintenance_schedule: schedule }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/*
  ── Why this does not write to `ai_usage_events` ────────────────────────────

  The spec asked for `recordAiUsageInBackground` with `purpose:
  'schedule_backfill'`. It should not have, and the reason is worth stating
  because it is a small decision that would have cost three changes:

  `ai_usage_events_purpose_check` is a CHECK constraint listing ten values.
  Adding an eleventh means a migration — DDL, which has no path from here
  (PostgREST exposes tables and functions, not `CREATE`), so David's dashboard.
  It also means adding the value to `AI_USAGE_PURPOSES` in
  `packages/core/src/ai/usage.ts`, because `ai-usage.test.ts` fails the build
  when the application and the database disagree in either direction.

  Three moving parts, one of them manual, to meter **four calls that will never
  run again**. The table's own comment says a new purpose is "the correct amount
  of friction for a vocabulary the cost reports are grouped by" — and a one-off
  script is exactly the kind of entry that turns a cost vocabulary into a list
  of everything anyone ever ran.

  `surface` is the tell. The four values are `account`, `demo`, `anonymous`,
  `canary` — whose traffic this was. A maintenance script is none of them. A
  column with no honest value for this row is the schema saying this row does
  not belong in this table.

  So the tokens are reported instead, and they are the whole argument: the full
  job is about 5,400 tokens. If this ever becomes a product path rather than a
  one-off, it earns its purpose then.
*/

// ─── Output ──────────────────────────────────────────────────────────────────

const KIND_LABEL = {
  exact: 'exact',
  range: 'range',
  wide_range: 'WIDE RANGE',
  time_only: 'time only',
  both: 'miles + time',
  unreadable: 'UNREADABLE',
};

function showEntry(e) {
  const miles = e.interval_miles === null ? '—' : e.interval_miles.toLocaleString();
  const months = e.interval_months === null ? '—' : `${e.interval_months} mo`;
  console.log(`    ${e.service}`);
  console.log(`      was: ${JSON.stringify(e._prose)}`);
  console.log(`      now: interval_miles ${miles} · interval_months ${months} · ${e.priority}`);
  if (e.description) console.log(`      description: ${e.description}`);
  if (e._disagreements.length) {
    for (const d of e._disagreements) console.log(`      ⚠ DISAGREEMENT — ${d}`);
  }
  if (e._invalid) console.log(`      ✗ REJECTED — ${e._invalid}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

let vehicles;
let knowledge;
try {
  vehicles = await get('vehicles?select=id,user_id,year,make,model,trim,current_mileage&order=year');
  knowledge = await get('vehicle_knowledge_base?select=vehicle_id,maintenance_schedule,transmission_type');
} catch (error) {
  console.error(`UNABLE — ${error.message}`);
  process.exit(3);
}

const targets = knowledge
  .map((kb) => ({ kb, vehicle: vehicles.find((v) => v.id === kb.vehicle_id) }))
  .filter((t) => t.vehicle)
  .filter((t) =>
    ONLY ? `${t.vehicle.year} ${t.vehicle.make} ${t.vehicle.model} ${t.vehicle.trim ?? ''}`.toLowerCase().includes(ONLY) : true
  );

if (targets.length === 0) {
  console.error(`UNABLE — no vehicles matched${ONLY ? ` "${ONLY}"` : ''}`);
  process.exit(3);
}

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · ${MODEL} · ${targets.length} vehicle(s)`);
console.log(APPLY ? 'Writing maintenance_schedule. Nothing else on the row is touched.\n' : 'Nothing will be written.\n');

const results = [];
const tokens = { prompt: 0, output: 0, thoughts: 0, total: 0 };

for (const { kb, vehicle } of targets) {
  const original = Array.isArray(kb.maintenance_schedule) ? kb.maintenance_schedule : [];
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''}`;

  if (original.length === 0) {
    console.log(`── ${name}: no schedule entries, skipped\n`);
    continue;
  }

  let reply;
  try {
    reply = await readWithModel(vehicle, original);
  } catch (error) {
    console.error(`── ${name}: model call failed — ${error.message}`);
    process.exit(2);
  }

  if (reply.usage) {
    tokens.prompt += reply.usage.promptTokenCount ?? 0;
    tokens.output += reply.usage.candidatesTokenCount ?? 0;
    tokens.thoughts += reply.usage.thoughtsTokenCount ?? 0;
    tokens.total += reply.usage.totalTokenCount ?? 0;
  }

  const entries = original.map((entry, i) => {
    const mine = parseInterval(entry.interval ?? '');
    const theirs = reply.entries.find((r) => r.index === i) ?? reply.entries[i];
    const merged = reconcile(entry, mine, theirs);
    const check = validateEntry(merged);
    if (!check.ok) merged._invalid = check.why;
    else merged._validated = check.value;
    return merged;
  });

  results.push({ vehicle, kb, name, entries, usage: reply.usage });
}

// The report, grouped so the judgement calls are read as judgement calls.
const all = results.flatMap((r) => r.entries.map((e) => ({ ...e, _vehicle: r.name })));
const byKind = (kind) => all.filter((e) => e._kind === kind);

for (const result of results) {
  console.log(`── ${result.name} · ${result.entries.length} entries`);
  for (const e of result.entries) {
    console.log(`  [${KIND_LABEL[e._kind]}]`);
    showEntry(e);
  }
  console.log('');
}

console.log('═'.repeat(78));
console.log('THE 14 THAT NEED JUDGEMENT');
console.log('═'.repeat(78));

console.log(`\n▸ Mileage ranges — ${byKind('range').length + byKind('both').length}. Low end taken; original prose kept in description.`);
for (const e of [...byKind('range'), ...byKind('both')]) {
  console.log(`    ${e._vehicle} · ${e.service}`);
  console.log(`      ${JSON.stringify(e._prose)} → ${e.interval_miles?.toLocaleString() ?? '—'} mi${e.interval_months ? ` / ${e.interval_months} mo` : ''}`);
}

console.log(`\n▸ Time-only — ${byKind('time_only').length}. Written as time-only. No mileage invented.`);
for (const e of byKind('time_only')) {
  console.log(`    ${e._vehicle} · ${e.service}`);
  console.log(`      ${JSON.stringify(e._prose)} → ${e.interval_months} months, interval_miles null`);
}

console.log(`\n▸ WIDE RANGES — ${byKind('wide_range').length}. Read these on their own, not as part of the 14.`);
console.log(`  Each spans ${WIDE_SPREAD_MILES.toLocaleString()} miles or more. The low end is a defensible default and a`);
console.log('  real decision; the spread stays in the description so the screen can show it.');
for (const e of byKind('wide_range')) {
  console.log(`    ${e._vehicle} · ${e.service}`);
  console.log(
    `      ${JSON.stringify(e._prose)} → ${e.interval_miles?.toLocaleString()} mi` +
      `${e.interval_months ? ` / ${e.interval_months} mo` : ''}   (${e._spread.toLocaleString()}-mile spread)`
  );
}

const unreadable = byKind('unreadable');
if (unreadable.length) {
  console.log(`\n▸ Unreadable — ${unreadable.length}.`);
  for (const e of unreadable) console.log(`    ${e._vehicle} · ${e.service} · ${JSON.stringify(e._prose)}`);
}

const disagreements = all.filter((e) => e._disagreements.length);
const rejected = all.filter((e) => e._invalid);

console.log(`\n${'─'.repeat(78)}`);
console.log(`${all.length} entries · ${all.length - disagreements.length} where parser and model agree · ${disagreements.length} disagreement(s) · ${rejected.length} rejected`);
console.log(`tokens: ${tokens.prompt} prompt · ${tokens.output} output · ${tokens.thoughts} thinking · ${tokens.total} total`);

if (disagreements.length) {
  console.log('\nDISAGREEMENTS — the parser and the model read these differently:');
  for (const e of disagreements) {
    console.log(`  ${e._vehicle} · ${e.service} · ${JSON.stringify(e._prose)}`);
    for (const d of e._disagreements) console.log(`    ${d}`);
  }
}

if (rejected.length) {
  console.log('\nREJECTED — these will not be written and will stay in their legacy shape:');
  for (const e of rejected) console.log(`  ${e._vehicle} · ${e.service} — ${e._invalid}`);
}

if (!APPLY) {
  console.log('\nDry run. Nothing written. Re-run with --apply once the judgement calls are agreed.');
  process.exit(0);
}

if (disagreements.length) {
  console.error('\nREFUSING TO WRITE — the parser and the model disagree on the entries above.');
  console.error('An unresolved disagreement is exactly the case a person should decide.');
  process.exit(1);
}

console.log(`\n${'─'.repeat(78)}\nWriting.\n`);

let failures = 0;
for (const result of results) {
  /*
    A rejected entry keeps its original legacy object rather than being dropped.
    `evaluateSchedule` skips it — the same outcome as today — and the row does
    not quietly lose a service it has always listed.
  */
  const schedule = result.entries.map((e, i) =>
    e._validated ? e._validated : result.kb.maintenance_schedule[i]
  );

  try {
    await writeSchedule(result.vehicle.id, schedule);
    console.log(
      `  ✓ ${result.name} — ${schedule.length} entries written` +
        ` (${result.usage?.totalTokenCount ?? 0} tokens, unmetered by design — see the note above)`
    );
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${result.name} — ${error.message}`);
  }
}

// Read back rather than trust the write.
console.log('\nVerifying:');
const after = await get('vehicle_knowledge_base?select=vehicle_id,maintenance_schedule,transmission_type');
for (const result of results) {
  const row = after.find((r) => r.vehicle_id === result.vehicle.id);
  const structured = (row?.maintenance_schedule ?? []).filter(
    (e) => typeof e.interval_miles === 'number' || typeof e.interval_months === 'number'
  ).length;
  console.log(`  ${result.name}: ${structured}/${row?.maintenance_schedule?.length ?? 0} entries carry an interval`);
}

const accord = after.find((r) => {
  const v = vehicles.find((x) => x.id === r.vehicle_id);
  return v?.make === 'Honda' && v?.model === 'Accord';
});
if (accord) {
  const ok = accord.transmission_type === 'CVT';
  console.log(`  Accord transmission_type: ${JSON.stringify(accord.transmission_type)} ${ok ? '✓' : '✗ §23 REGRESSION'}`);
  if (!ok) failures += 1;
}

process.exit(failures ? 1 : 0);
