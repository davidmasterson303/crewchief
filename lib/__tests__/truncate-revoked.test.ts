/**
 * Every table in `public` must have TRUNCATE taken off `authenticated`.
 *
 * @jest-environment node
 *
 * **RLS cannot gate TRUNCATE.** It is a table-level operation, so no policy,
 * however carefully scoped, restricts it — a role holding it empties the table
 * outright. That is the one privilege in this schema where the row-level
 * machinery this project relies on does not apply at all.
 *
 * ── Why this test exists, and why now ───────────────────────────────────────
 *
 * `20260801150000` revoked it with `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA
 * public`, which binds **only the tables that existed at that moment**.
 * Postgres expands `ALL TABLES` once; it is not a standing rule. That migration
 * knew, and wrote down the fix:
 *
 * > if a later table needs it, the honest fix is a line in that table's own
 * > migration
 *
 * Four tables were then created over eleven days and **not one carried that
 * line.** Found by Cowork on 12 August while verifying something else.
 *
 * So the rule had been correctly identified, correctly written down, and
 * ignored four times — which is the definition of something that needs a
 * ratchet rather than a paragraph. This is the paragraph made executable.
 *
 * ── What this proves, and what it does not ──────────────────────────────────
 *
 * A static replay of the migration corpus: what a **rebuild** would produce,
 * not what the live database is running — the standing caveat in
 * `rls-blanket-policies.test.ts`, and this project has measured those apart
 * four times. Live confirmation needs `information_schema.role_table_grants`,
 * which is a dashboard read.
 *
 * It is still the right instrument, because the failure is one of *omission* at
 * authoring time, and that is exactly what a corpus scan sees.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

/** Migration filenames, oldest first. */
function migrations(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** SQL with comments stripped — prose about a revoke is not a revoke. */
function statements(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * The date `ALL TABLES IN SCHEMA public` was expanded. Tables created in a
 * migration at or before this are covered by it; later ones are not.
 */
const BLANKET_REVOKE = '20260801150000';

describe('TRUNCATE is not held by authenticated', () => {
  const files = migrations();

  it('finds the migration corpus', () => {
    // A scan matching nothing would pass everything below while checking
    // nothing — the failure this repo keeps finding in its own instruments.
    expect(files.length).toBeGreaterThan(10);
  });

  it('the blanket revoke exists and is where this rule starts', () => {
    const blanket = files.find((f) => f.startsWith(BLANKET_REVOKE));
    expect(blanket).toBeDefined();
    expect(statements(blanket!)).toMatch(
      /REVOKE\s+TRUNCATE\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+FROM\s+authenticated/i
    );
  });

  it('every table created after the blanket revoke has its own revoke', () => {
    /*
      The rule, and the thing that was violated four times.

      Collected across the whole corpus rather than per-file, because a table's
      revoke may legitimately arrive in a later migration than its CREATE —
      which is exactly what `20260813020000` does for the four that were missed.
    */
    const createdLate: string[] = [];
    const revoked = new Set<string>();

    for (const file of files) {
      const sql = statements(file);
      const late = file > BLANKET_REVOKE;

      if (late) {
        const creates = sql.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?(\w+)/gi) ?? [];
        for (const stmt of creates) {
          const name = stmt.split(/\s+/).pop()!.replace('public.', '');
          createdLate.push(name);
        }
      }

      const revokes = sql.match(/REVOKE[\s\S]*?FROM\s+authenticated\s*;/gi) ?? [];
      for (const stmt of revokes) {
        if (!/\bTRUNCATE\b|\bALL\b/i.test(stmt)) continue;
        const on = stmt.match(/ON\s+(?:TABLE\s+)?(?:public\.)?(\w+)/i);
        if (on) revoked.add(on[1]);
      }
    }

    expect(createdLate.length).toBeGreaterThan(0);

    const unprotected = createdLate.filter((t) => !revoked.has(t));
    expect(unprotected).toEqual([]);
  });

  it('names the four tables this rule was written for', () => {
    /*
      Pinned by name as well as by rule. The general assertion above would stay
      green if someone deleted all four migrations; this one says which tables
      the 12 August finding was actually about, so a future reader can match the
      fix to the report.
    */
    const corpus = files.map(statements).join('\n');

    for (const table of [
      'device_push_tokens',
      'recall_notifications',
      'service_notifications',
      'account_entitlements',
    ]) {
      expect(corpus).toMatch(
        new RegExp(`REVOKE\\s+TRUNCATE\\s+ON\\s+(?:public\\.)?${table}\\s+FROM\\s+authenticated`, 'i')
      );
    }
  });
});
