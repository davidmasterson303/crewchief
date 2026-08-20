/**
 * `account_entitlements` must never become user-writable.
 *
 * @jest-environment node
 *
 * Phase 6, E7. This is the one table in the product where the *correct* policy
 * shape for every other table is a defect.
 *
 * ── Why the existing guards do not cover this ───────────────────────────────
 *
 * `rls-blanket-policies.test.ts` catches `USING (true)` — a policy that grants
 * unrestricted access and nullifies every scoped policy beside it. That is a
 * data-exposure rule and it is a good one, and it would say nothing at all
 * about the hazard here.
 *
 * The dangerous policy on this table is not blanket. It is:
 *
 *     CREATE POLICY "Users manage their own entitlement"
 *       ON public.account_entitlements FOR ALL
 *       USING (auth.uid() = user_id);
 *
 * — properly scoped, indistinguishable in review from the pattern most of this
 * schema uses, and it lets any signed-in user `UPDATE` their own row to
 * `tier = 'paid'`. **A user-writable entitlement is a free subscription.** The
 * failure is not a leak; it is revenue quietly going to zero while every
 * security check in the repo stays green.
 *
 * ── What this proves, and what it does not ──────────────────────────────────
 *
 * A static replay of the migration corpus, with the same caveat that suite
 * records: it proves what a **rebuild** would produce, not what the live
 * database is running — and those have already been measured apart four times
 * in this project, in both directions. Live has to be confirmed by reading
 * `pg_policies` and `information_schema.role_table_grants` through the
 * dashboard.
 *
 * It is still worth having, because a fresh environment is built from these
 * files, and because the mistake it pins is one a careful person makes while
 * trying to be consistent.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');
const TABLE = 'account_entitlements';

/** Every migration that mentions the table, oldest first. */
function migrationsTouching(table: string): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }))
    .filter(({ sql }) => sql.includes(table));
}

/** Strip block and line comments so prose about a rule is not read as the rule. */
function withoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * The same idea for TypeScript, and it is not decoration.
 *
 * ⚠ Found 18 Aug by mutation, not by review. The walk below asked
 * `source.includes('getServiceRoleClient')`. When E8's writer arrived it
 * carried a docblock *explaining* that it uses the service role — so switching
 * its actual client to a browser one left the guard green, because the promise
 * was still there in prose two hundred lines above the call.
 *
 * That is precisely the failure `CLAUDE.md` §5 records against `.tap-target-44`
 * ("found the string in a comment 600 lines above the rule"), reproduced here
 * by the first file careful enough to document itself.
 *
 * `//` preceded by a colon is left alone so a URL in a string literal is not
 * mistaken for a comment and used to truncate the line.
 */
function withoutTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('account_entitlements is service-role-write-only', () => {
  const touching = migrationsTouching(TABLE);

  it('is created by a migration at all', () => {
    /*
      A scan that matched nothing would pass every assertion below while
      checking nothing — the shape this repo keeps catching in its own
      instruments. If the table is ever renamed, this is what fails first.
    */
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.some(({ sql }) => /CREATE TABLE[^;]*account_entitlements/i.test(sql))).toBe(
      true
    );
  });

  it('has row level security enabled', () => {
    const enabled = touching.some(({ sql }) =>
      new RegExp(`ALTER TABLE\\s+(public\\.)?${TABLE}\\s+ENABLE ROW LEVEL SECURITY`, 'i').test(
        withoutComments(sql)
      )
    );

    expect(enabled).toBe(true);
  });

  it('never grants a policy that can write', () => {
    /*
      The rule. A policy on this table may be `FOR SELECT` and nothing else.

      `FOR ALL` is the one to watch: it reads as "users manage their own row",
      it is correct on `vehicles` and `wishlist_items` and most of this schema,
      and here it hands out the paid tier.
    */
    const offenders: string[] = [];

    for (const { file, sql } of touching) {
      const clean = withoutComments(sql);
      const policies = clean.match(
        new RegExp(`CREATE POLICY[\\s\\S]*?ON\\s+(?:public\\.)?${TABLE}[\\s\\S]*?;`, 'gi')
      );

      for (const policy of policies ?? []) {
        if (!/FOR\s+SELECT/i.test(policy)) {
          offenders.push(`${file}: ${policy.slice(0, 90).replace(/\s+/g, ' ')}…`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never grants INSERT, UPDATE or DELETE to a client role', () => {
    /*
      Belt to the policy's braces, and the half that actually stops it: a policy
      can only narrow a privilege that was granted. With no write GRANT there is
      nothing for a mistaken policy to govern, which is why the migration
      REVOKEs explicitly rather than relying on defaults.
    */
    const offenders: string[] = [];

    for (const { file, sql } of touching) {
      const clean = withoutComments(sql);
      const grants = clean.match(
        new RegExp(`GRANT[\\s\\S]*?ON\\s+(?:public\\.)?${TABLE}[\\s\\S]*?;`, 'gi')
      );

      for (const grant of grants ?? []) {
        if (!/TO\s+(authenticated|anon)/i.test(grant)) continue;
        if (/\b(INSERT|UPDATE|DELETE|ALL)\b/i.test(grant)) {
          offenders.push(`${file}: ${grant.slice(0, 90).replace(/\s+/g, ' ')}…`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('grants anon nothing', () => {
    /*
      An unauthenticated caller has no entitlement to read and no business
      knowing the table exists. The public demo is anonymous and must never
      resolve to anything but the free ceiling.
    */
    const offenders: string[] = [];

    for (const { file, sql } of touching) {
      const clean = withoutComments(sql);
      const grants = clean.match(
        new RegExp(`GRANT[\\s\\S]*?ON\\s+(?:public\\.)?${TABLE}[\\s\\S]*?;`, 'gi')
      );

      for (const grant of grants ?? []) {
        if (/TO\s+anon/i.test(grant)) {
          offenders.push(`${file}: ${grant.slice(0, 90).replace(/\s+/g, ' ')}…`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is only ever written through the service-role client', () => {
    /*
      The application-side half. The browser client talks to the database
      directly in several places, so "only the service role writes it" has to
      be true of the code as well as the grants.

      Today nothing writes it at all — the writer arrives with Apple IAP (E8).
      This assertion is what makes that arrival deliberate: the first insert or
      update has to be in a file using `getServiceRoleClient`, or this fails.
    */
    const roots = ['app', 'components', 'hooks', 'lib'];
    const offenders: string[] = [];
    /** Every file the walk actually read that mentions the table. */
    const seen: string[] = [];

    function walk(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir, { withFileTypes: true }).map((e) =>
          e.isDirectory() ? `${e.name}/` : e.name
        );
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry === 'node_modules/' || entry === '__tests__/') continue;
        const full = join(dir, entry.replace(/\/$/, ''));

        if (entry.endsWith('/')) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;

        const source = withoutTsComments(readFileSync(full, 'utf8'));
        if (!source.includes(`'${TABLE}'`) && !source.includes(`"${TABLE}"`)) continue;
        seen.push(full);

        const writes = /\.(insert|update|upsert|delete)\s*\(/.test(source);
        if (writes && !source.includes('getServiceRoleClient')) {
          offenders.push(full);
        }
      }
    }

    for (const root of roots) walk(join(__dirname, '..', '..', root));

    expect(offenders).toEqual([]);

    /*
      ⚠ Anti-vacuous, and it could not be written until 18 Aug because until
      then nothing wrote this table at all.

      `walk` swallows unreadable directories and returns. If a rename, a moved
      root or a bad path ever made it traverse nothing, `offenders` would be
      empty and this test would report a clean application forever — the exact
      shape `CLAUDE.md` §5 records ("a suite whose walker silently returned
      nothing reported a clean app forever").

      E8's writer is now the thing that proves the walk reaches real files.
    */
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((f) => f.endsWith('entitlement-store.ts'))).toBe(true);
  });
});
