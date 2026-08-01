/**
 * No table may gain a new blanket RLS policy.
 *
 * @jest-environment node
 *
 * Roadmap item E, and the thing that makes 20260731030000 and its successor
 * stick. Those migrations close blanket policies on four tables; **neither is
 * enforced by anything**, so a future migration could reopen the hole and every
 * check in this repo would stay green.
 *
 * `vehicles-rls-posture.test.ts` has asserted this exact property since 29 Jul
 * and is pointed at one table. This is the same idea across all of them.
 *
 * ── What a blanket policy is, and why it is not a style problem ─────────────
 *
 * A PERMISSIVE policy whose USING or WITH CHECK expression is literally `true`
 * grants unrestricted access for its command. Postgres ORs permissive policies
 * together, so **one blanket policy nullifies every scoped policy beside it**.
 * A file that adds a careful `user_id = auth.uid()` policy to a table that
 * already has `USING (true)` reads as though it closed a hole and closes
 * nothing.
 *
 * That is not hypothetical here. It nearly caused a leak on 30 Jul: a one-line
 * `GRANT SELECT … TO anon` on `maintenance_line_items` rested on "RLS still
 * decides which rows", which was true only if the scoped policy were the only
 * policy. It was not. David caught it in review — this is what would have
 * caught it without him.
 *
 * ── What this does and does not prove ──────────────────────────────────────
 *
 * A static replay of the migration corpus: it proves what a **rebuild** would
 * produce, not what the live database is running. That distinction is the
 * finding `vehicles-rls-posture.test.ts` records — live was fixed by hand
 * through a dashboard under policy names that appear nowhere in this repo, so
 * history and database have already been proved to disagree.
 *
 * Which makes this more useful, not less. A fresh environment is built from
 * these files. If they declare an open database, that is what a rebuild gets.
 *
 * ── Measured against live, 31 Jul. The two disagree, and by how much ────────
 *
 * Read-only probe of the live project, so this is not an argument from first
 * principles. **The baseline overstates live exposure, in the safe direction.**
 *
 *   - **Ten of the thirteen tables are not granted to `anon` at all.** They
 *     return `42501`, which is a GRANT failure — it happens *before* any policy
 *     is consulted. Their blanket policies are unreachable by an anonymous
 *     caller whatever the policy says. That grant-versus-RLS distinction is the
 *     thing both July migrations are built around, and it is the thing a
 *     confident wrong answer was given about on 30 Jul.
 *
 *   - **The three that are granted are already scoped in the database.**
 *     `nhtsa_data`, `vehicle_health_summary` and `vehicle_knowledge_base` each
 *     hold four rows; an anonymous reader sees three. A live `USING (true)`
 *     would return four. So those three are scoped live and this corpus does
 *     not know it — drift in the safe direction, and the same drift
 *     `vehicles-rls-posture.test.ts` found on `vehicles`.
 *
 * So the honest label for this list is **"blanket policies a rebuild would
 * declare"**, not "blanket policies this database has". Keeping the sixteen
 * frozen is still right — a rebuild really would produce them — but nobody
 * should read the number as live exposure. It is not.
 *
 * What is *not* measured: these policies are `TO public`, which includes
 * `authenticated`. Measuring what a signed-in account can reach needs a user
 * JWT, and none was available when this was written. That is the larger
 * surface, since an authenticated caller plausibly holds grants `anon` does
 * not — and it is the open question this file cannot answer.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

export interface Policy {
  table: string;
  name: string;
  /** The migration that last created it. */
  file: string;
  body: string;
}

/**
 * Replay migrations in filename order; return the policies still standing.
 *
 * Order is the whole point: a permissive policy later dropped is not a finding,
 * and a scoped policy later replaced by a permissive one is. Keyed by
 * `table:name` because two tables legitimately carry same-named policies.
 *
 * Takes its file list and reader as arguments so the replay can be probed with
 * synthetic migrations — the standard `cc-tech-0004` sets, and the only way to
 * show this fires without stripping a real policy to watch it go red.
 */
export function survivingPolicies(
  files: string[],
  read: (file: string) => string
): Policy[] {
  const alive = new Map<string, Policy>();

  for (const file of files) {
    // Comments are stripped first: these migrations quote the policies they are
    // removing, at length, and a commented CREATE POLICY must not register as
    // one. 20260731030000 alone would otherwise report three phantoms.
    const sql = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

    const dropRe = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?(\w+)\s*;/gi;
    let drop: RegExpExecArray | null;
    while ((drop = dropRe.exec(sql)) !== null) alive.delete(`${drop[2]}:${drop[1]}`);

    const createRe = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)\b([\s\S]*?);/gi;
    let create: RegExpExecArray | null;
    while ((create = createRe.exec(sql)) !== null) {
      alive.set(`${create[2]}:${create[1]}`, {
        table: create[2],
        name: create[1],
        file,
        body: create[3],
      });
    }
  }

  const out: Policy[] = [];
  alive.forEach((p) => out.push(p));
  return out;
}

/** `USING (true)` or `WITH CHECK (true)` — unrestricted for its command. */
export function isBlanket(policy: Policy): boolean {
  return (
    /USING\s*\(\s*true\s*\)/i.test(policy.body) ||
    /WITH\s+CHECK\s*\(\s*true\s*\)/i.test(policy.body)
  );
}

/**
 * Reachable by an untrusted caller.
 *
 * A policy with no `TO` clause defaults to PUBLIC, which includes `anon`. Only
 * an explicit `TO service_role` puts it out of reach, because the service role
 * bypasses RLS anyway — a blanket policy there grants nothing it did not
 * already have.
 */
export function isReachableByUntrusted(policy: Policy): boolean {
  /*
    The role list is identifiers separated by commas, and it must stop there.

    An earlier version matched `[a-z_, ]+`, which includes a space — so on a
    single-line policy it ran straight past the role into the next keyword and
    read the audience of `TO service_role USING (true)` as
    "service_role USING". It happened to work on this corpus only because those
    policies put `USING` on the following line, and a newline is not in the
    class. Caught by the synthetic probe below, which is the entire reason that
    probe exists.
  */
  const to = /\bTO\s+([a-z_]+(?:\s*,\s*[a-z_]+)*)/i.exec(policy.body);
  if (!to) return true;

  const roles = to[1].split(',').map((r) => r.trim().toLowerCase());
  return !roles.every((r) => r === 'service_role');
}

export function key(policy: Policy): string {
  return `${policy.table}:${policy.name}`;
}

/**
 * The blanket policies a rebuild would currently produce, reachable by
 * untrusted callers. **This list may only ever SHRINK.**
 *
 * Frozen as a baseline rather than fixed in one go, deliberately. Sixteen
 * policies across **thirteen** tables — twelve with one each, plus
 * `service_items` with four — cannot be closed in a single reviewed change,
 * and demanding that as the price of having a ratchet is how a project ends up
 * with no ratchet. Freezing them makes the *next* one fail the build, which is
 * the property actually worth having.
 *
 * Removing an entry requires a migration that drops it. Adding one is not a
 * way to make a failing build pass.
 *
 * **Was sixteen, then ten; is eight.** `20260731030000` closed
 * `maintenance_line_items` and `20260731040000` closed `service_items` ×4,
 * `known_issue_tracking` and `modification_tracking`. `20260801140000` closed
 * the last two that hold user content: `vehicle_documents` and
 * `consultant_conversations`. All are absent below because the replay sees
 * their drops — and the honesty assertion is what forced this list to be
 * updated rather than left stale, which is the ratchet working as designed. It
 * fired on exactly those two entries when that migration landed.
 *
 * Eight remain. What a rebuild from these files would expose, by kind — and
 * note the framing, which is "a rebuild would", not "the database does":
 *
 *   - `consultant_documents`, `quote_requests`, `labor_bundles` — empty.
 *   - `location_zones`, `modification_details` — shared reference data, the
 *     same rows for everybody.
 *   - `vehicle_knowledge_base`, `vehicle_health_summary`, `nhtsa_data` — per
 *     vehicle, and therefore per user. Derived rather than authored — a
 *     research profile, a computed health band, NHTSA recall lookups — so none
 *     of it is a document or transcript someone wrote.
 *
 * Whether live is scoped on any of these is a separate question with a separate
 * instrument. On the last two measured, it was.
 *
 * **What this list is, restated because it was just misread — by the person
 * editing it.** These entries describe what a rebuild from these files would
 * declare. They are not a report of live exposure, and the two have now been
 * measured apart four times.
 *
 * `20260801140000` was written and committed on the premise that the
 * `vehicle_documents` and `consultant_conversations` entries below meant a
 * signed-in user could read another user's invoices and transcripts. A live
 * catalog read on 1 Aug found both already scoped with owner and demo arms,
 * RLS enabled, and no unconditional policy on either. Live was *tighter* than
 * this list implies — the first drift in that direction.
 *
 * So: an entry here is a rebuild hazard and a reason to write a migration. It
 * is never, on its own, evidence that the database is open. That takes a
 * catalog read, and the header above has said so since the file was written.
 */
const BLANKET_BASELINE = new Set<string>([
  'consultant_documents:Allow all operations on consultant_documents',
  'labor_bundles:Allow all operations on labor_bundles',
  'location_zones:Allow all operations on location_zones',
  'modification_details:Allow all operations on modification_details',
  'nhtsa_data:Allow all operations on nhtsa_data',
  'quote_requests:Allow all operations on quote_requests',
  'vehicle_health_summary:Allow all operations on vehicle_health_summary',
  'vehicle_knowledge_base:Allow all operations on vehicle_knowledge_base',
]);

// ---------------------------------------------------------------------------

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

describe('blanket RLS policies, as a rebuild would declare them', () => {
  const policies = survivingPolicies(migrationFiles(), (f) =>
    readFileSync(join(MIGRATIONS, f), 'utf8')
  );
  const blanket = policies.filter(isBlanket);
  const reachable = blanket.filter(isReachableByUntrusted).map(key).sort();

  it('parses the migration corpus', () => {
    // A replay that silently matched nothing makes every assertion below pass.
    expect(policies.length).toBeGreaterThan(50);
    expect(new Set(policies.map((p) => p.table)).size).toBeGreaterThan(10);
  });

  it('introduces no NEW blanket policy reachable by an untrusted caller', () => {
    const created = reachable.filter((k) => !BLANKET_BASELINE.has(k));

    expect(created).toEqual([]);
  });

  it('keeps the baseline honest — no already-closed entries left behind', () => {
    // The other half of the ratchet. An entry that has been fixed but left in
    // the list lets the baseline rot into decoration, and the next reader
    // cannot tell which of the sixteen are real.
    const alreadyClosed = Array.from(BLANKET_BASELINE).filter((k) => !reachable.includes(k));

    expect(alreadyClosed).toEqual([]);
  });

  it('ratchets down — the backlog never grows', () => {
    // Lower this as migrations close them. It must never be raised.
    // 16 → 10 on 31 Jul, when 20260731040000 closed service_items ×4,
    // known_issue_tracking and modification_tracking.
    // 10 → 8 on 1 Aug, when 20260801140000 closed vehicle_documents and
    // consultant_conversations — the last two holding user content.
    expect(BLANKET_BASELINE.size).toBeLessThanOrEqual(8);
  });

  it('leaves maintenance_line_items closed', () => {
    // The one 20260731030000 closes, asserted by name so a revert of that
    // migration fails here rather than only in production.
    expect(reachable.filter((k) => k.startsWith('maintenance_line_items:'))).toEqual([]);
  });

  /*
    Service-role-only blanket policies are tolerated and still counted. The
    service role bypasses RLS, so `USING (true) TO service_role` grants nothing
    it did not already have — but a policy that silently changed audience would
    move from harmless to reachable, and that transition is what the assertion
    above catches.
  */
  it('accounts for every blanket policy, reachable or not', () => {
    const serviceRoleOnly = blanket.filter((p) => !isReachableByUntrusted(p));

    expect(serviceRoleOnly.length + reachable.length).toBe(blanket.length);
    expect(serviceRoleOnly.length).toBe(7);
  });
});

/**
 * The replay, probed with real violations.
 *
 * This suite's whole value is that it would notice a reopened hole. Proving
 * that against the real corpus would mean adding a blanket policy to a live
 * migration, so it is proved against synthetic ones instead — the same
 * technique `auth-posture.test.ts` uses for its delegation detector.
 */
describe('the replay itself', () => {
  const from = (files: Record<string, string>) =>
    survivingPolicies(Object.keys(files).sort(), (f) => files[f]);

  it('catches a blanket policy added by a later migration', () => {
    const policies = from({
      '001_init.sql': `CREATE POLICY "scoped" ON widgets FOR SELECT USING (user_id = auth.uid());`,
      '002_oops.sql': `CREATE POLICY "open" ON widgets FOR SELECT USING (true);`,
    });

    expect(policies.filter(isBlanket).map(key)).toEqual(['widgets:open']);
  });

  it('does not report one that a later migration drops', () => {
    const policies = from({
      '001_init.sql': `CREATE POLICY "open" ON widgets FOR ALL USING (true);`,
      '002_fix.sql': `DROP POLICY IF EXISTS "open" ON public.widgets;`,
    });

    expect(policies.filter(isBlanket)).toEqual([]);
  });

  it('reports a scoped policy that a later migration replaces with a blanket one', () => {
    // Same name, reopened. The failure mode a name-keyed set exists to catch.
    const policies = from({
      '001_init.sql': `CREATE POLICY "p" ON widgets FOR SELECT USING (user_id = auth.uid());`,
      '002_regress.sql': `DROP POLICY IF EXISTS "p" ON widgets;
                          CREATE POLICY "p" ON widgets FOR SELECT USING (true);`,
    });

    expect(policies.filter(isBlanket).map(key)).toEqual(['widgets:p']);
  });

  it('keeps same-named policies on different tables apart', () => {
    const policies = from({
      '001.sql': `CREATE POLICY "p" ON widgets FOR SELECT USING (true);
                  CREATE POLICY "p" ON gadgets FOR SELECT USING (user_id = auth.uid());`,
    });

    expect(policies.filter(isBlanket).map(key)).toEqual(['widgets:p']);
  });

  it('is not fooled by a CREATE POLICY inside a comment', () => {
    // These migrations quote the policies they remove, at length. Without
    // comment stripping, 20260731030000 alone reports three policies that do
    // not exist.
    const policies = from({
      '001.sql': `/* CREATE POLICY "ghost" ON widgets FOR ALL USING (true); */
                  -- CREATE POLICY "ghost2" ON widgets FOR ALL USING (true);
                  CREATE POLICY "real" ON widgets FOR SELECT USING (user_id = auth.uid());`,
    });

    expect(policies.map(key)).toEqual(['widgets:real']);
  });

  it('treats a policy with no TO clause as reachable', () => {
    // The default is PUBLIC, which includes anon. Every one of the sixteen in
    // the baseline is this shape.
    const [p] = from({ '001.sql': `CREATE POLICY "p" ON widgets FOR ALL USING (true);` });

    expect(isReachableByUntrusted(p)).toBe(true);
  });

  it('treats a service_role-only policy as out of reach', () => {
    const [p] = from({
      '001.sql': `CREATE POLICY "p" ON widgets FOR ALL TO service_role USING (true);`,
    });

    expect(isReachableByUntrusted(p)).toBe(false);
  });

  it('reads the audience the same way whatever the line breaks', () => {
    // The bug this caught: the role match ran past `service_role` into the
    // next keyword on a single-line policy, and stopped at the newline on a
    // wrapped one. Same policy, two answers.
    const inline = from({
      '001.sql': `CREATE POLICY "p" ON widgets FOR ALL TO service_role USING (true);`,
    })[0];
    const wrapped = from({
      '001.sql': `CREATE POLICY "p" ON widgets\n  FOR ALL\n  TO service_role\n  USING (true);`,
    })[0];

    expect(isReachableByUntrusted(inline)).toBe(isReachableByUntrusted(wrapped));
  });

  it('treats a mixed audience including service_role as reachable', () => {
    // `TO anon, service_role` is reachable by anon. Only an audience that is
    // entirely service_role is out of reach.
    const [p] = from({
      '001.sql': `CREATE POLICY "p" ON widgets FOR ALL TO anon, service_role USING (true);`,
    });

    expect(isReachableByUntrusted(p)).toBe(true);
  });

  it('catches WITH CHECK (true) as well as USING (true)', () => {
    // The one that lets a caller write a row it could not read.
    const policies = from({
      '001.sql': `CREATE POLICY "p" ON widgets FOR INSERT WITH CHECK (true);`,
    });

    expect(policies.filter(isBlanket).map(key)).toEqual(['widgets:p']);
  });
});
