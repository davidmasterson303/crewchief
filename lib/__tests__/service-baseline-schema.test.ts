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
 * There is a live example sitting in the tree. `LogServiceModal` inserts
 * `service_mileage` — a column that has never existed — with
 * `source: 'manual_entry'`, which is not in the CHECK either. Two rejections in
 * one statement, shipped, and invisible because the component is reached only
 * through `UpcomingMaintenance`, which nothing renders. That is the shape this
 * pins: not a bug someone will see, a bug nobody will see until it is on the
 * critical path.
 *
 * Read off disk rather than executed. Running the insert needs a live Supabase,
 * and the property that matters is what the migration declares against what the
 * code names — both static.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

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

describe('what is deliberately still broken', () => {
  it('does not legalise LogServiceModal-s dead insert', () => {
    /*
      `source: 'manual_entry'` is not in the CHECK and is not being added.

      It would be one word to "fix", and that is the trap: the component is
      unreachable, so adding a fourth stored meaning would be inventing
      vocabulary for code nobody runs — and `20260801120000` added this
      constraint precisely to stop a fourth writer inventing a fourth meaning.
      The dead writer is a separate clean-up, and deleting it is the likelier
      right answer than legalising it.
    */
    expect(sourceCheck).not.toMatch(/'manual_entry'/);

    const modal = readFileSync(join(ROOT, 'components', 'LogServiceModal.tsx'), 'utf8');
    // If this ever fails, the component was wired up — at which point the
    // insert above is a live defect and this test is the thing that says so.
    expect(modal).toMatch(/'manual_entry'/);
  });
});
