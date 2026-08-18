/**
 * The onboarding baseline agrees with the table it is written to.
 *
 * @jest-environment node
 *
 * Track A2a. Same class of failure as `mod-details-goal-key.test.ts`, and that
 * suite's header is the argument for this one: an agreement between code and
 * schema that **no runtime in this repo checks**. Postgres rejects the write,
 * the error is discarded by a `catch`, and the only place the disagreement is
 * visible is the source of both sides.
 *
 * The example this was written against was `LogServiceModal`: it inserted
 * `service_mileage` — a column that has never existed — with
 * `source: 'manual_entry'`, which is not in the CHECK either. Two rejections in
 * one statement, shipped, and invisible because the component was reached only
 * through `UpcomingMaintenance`, which nothing rendered. That is the shape this
 * pins: not a bug someone will see, a bug nobody will see until it is on the
 * critical path.
 *
 * Both files were deleted rather than repaired, which is the answer the last
 * case below already argued for. The case did not go with them — it changed
 * subject. What mattered was never that one dead component named an illegal
 * value; it was that the vocabulary stays closed, and that the next writer of
 * this table cannot quietly open it.
 *
 * Read off disk rather than executed. Running the insert needs a live Supabase,
 * and the property that matters is what the migration declares against what the
 * code names — both static.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/*
  Everywhere a write to this table could plausibly be spelled.

  `supabase/` is deliberately absent: the migration that adds the CHECK also
  *names* the value it excludes, in a comment explaining the exclusion, and a
  scan that read it would report the constraint as its own violator.
*/
const SCANNED = ['app', 'components', 'hooks', 'lib', 'packages', 'apps'];

function sourceFiles(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of dirs) walk(join(ROOT, dir));
  return out;
}

/**
 * SQL with its comments removed.
 *
 * Learned immediately, and it is the third time in this repo:
 * `push-token-registration.test.ts` hit it, `create-vehicle-route.test.ts`
 * hit it, and the first run of the case below hit it again. **The A2a
 * migration's own header explains why `'manual_entry'` is deliberately not in
 * the CHECK** — good writing, and a substring that satisfies exactly the
 * absence assertion written to prove it is absent.
 *
 * Both comment forms, because migrations here use `/* … *​/` for the header and
 * `-- ───` for section rules.
 */
function code(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** The migration is found by content, not by filename. A rename must not silently skip this. */
function migrationDeclaring(needle: string): string {
  const match = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .filter((sql) => sql.includes(needle));

  // More than one migration touching the same constraint is legal — the source
  // CHECK is dropped and re-added here — so take the last, which is what the
  // database ends up with.
  return match[match.length - 1] ?? '';
}

/*
  Stripped at the source, so every assertion below reads DDL rather than prose.
  A *presence* check satisfied by a comment is the same defect as an absence
  check satisfied by one — it just fails in the direction that looks like
  success.
*/
const baseline = code(migrationDeclaring('mileage_at_service'));
const sourceCheck = code(migrationDeclaring('maintenance_line_items_source_check'));

describe('the A2a migration', () => {
  it('exists', () => {
    expect(baseline).not.toBe('');
  });

  it('adds mileage_at_service, the column maintenance-sync already reads', () => {
    /*
      `maintenance-sync.ts:52` is `item.service_mileage || item.mileage_at_service
      || 0`. Neither existed, so that expression has always resolved to 0 — a
      fallback chain quietly returning "no baseline" for every car.
    */
    expect(baseline).toMatch(/ADD COLUMN IF NOT EXISTS mileage_at_service integer/);
  });

  it('is additive — it drops no column and no table', () => {
    // The one hard rule for this migration. B1's destructive drop is a
    // separate, approved change; nothing here may quietly join it.
    expect(baseline).not.toMatch(/DROP\s+COLUMN/i);
    expect(baseline).not.toMatch(/DROP\s+TABLE/i);
  });

  it('refuses a negative odometer reading', () => {
    // Not a weaker fact but a wrong one: `nextDueMileage` would take it as a
    // real baseline and place the next service before the car was built.
    expect(baseline).toMatch(/mileage_at_service\s*>=\s*0/);
  });

  it('allows null, because most invoices do not print a mileage', () => {
    expect(baseline).toMatch(/mileage_at_service IS NULL/);
  });
});

describe('the source vocabulary', () => {
  const ALLOWED = ['vision', 'manual', 'seed', 'owner-onboarding'];

  it('admits owner-onboarding', () => {
    expect(sourceCheck).toMatch(/'owner-onboarding'/);
  });

  it.each(ALLOWED)('still admits %s', (value) => {
    // A re-added CHECK that quietly narrows is how existing rows become
    // unwritable. The three that predate A2a have to survive it.
    expect(sourceCheck).toMatch(new RegExp(`'${value}'`));
  });

  it('matches the values service-provenance can actually label', () => {
    /*
      The pairing that matters. `owner-onboarding` is a *storage* value and
      `owner-reported` is a *claim*; they are deliberately different words, but
      one has to exist for the other to mean anything. A migration admitting a
      source the vocabulary cannot name would put rows in the table whose
      provenance no screen can state — which is how the unconditional "AI
      Extracted" badge happened.
    */
    const provenance = readFileSync(
      join(ROOT, 'packages', 'core', 'src', 'service-provenance.ts'),
      'utf8'
    );

    expect(provenance).toMatch(/'owner-reported'/);
    expect(provenance).toMatch(/SERVICE_BASIS_LABELS[\s\S]*'owner-reported':/);
  });
});

describe('the vocabulary stays closed', () => {
  it('does not admit manual_entry', () => {
    /*
      It would be one word to add, and that is the trap. `20260801120000` added
      this constraint precisely to stop a fourth writer inventing a fourth
      meaning for the same fact, and `'manual'` already carries "a person typed
      this in". A second spelling of it is not a new meaning, it is a synonym —
      and two spellings of one meaning is how `service_mileage` and
      `mileage_at_service` happened one column over.
    */
    expect(sourceCheck).not.toMatch(/'manual_entry'/);
  });

  it('is not written by anything in the tree', () => {
    /*
      The other half, and the half that used to be a file read.

      `LogServiceModal.tsx` was the one writer of `'manual_entry'`, so this case
      pointed at that file and asserted the string was still in it — a tripwire
      for the component being wired up. The file is gone, and pointing at a
      named file was always the weaker form: it could only see the writer it
      already knew about.

      So it scans instead. Any *new* insert naming a value the CHECK does not
      admit fails here, whatever it is called and wherever it lives, which is
      the property the CHECK exists to have.
    */
    const offenders = sourceFiles(SCANNED)
      .filter((f) => /source:\s*['"]manual_entry['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });
});
