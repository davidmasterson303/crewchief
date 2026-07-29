/**
 * The `vehicles` table must not carry an unrestricted RLS policy.
 *
 * @jest-environment node
 *
 * Every child table is scoped with `user_owns_vehicle(vehicle_id)`. The
 * `vehicles` table itself was not: `20260103030740` gave it
 * `USING (true)` for SELECT, INSERT, UPDATE and DELETE, and nothing replaced
 * them for six months. `20260314234029_enforce_vehicle_ownership_and_rls` is
 * the migration that sounds like it would have — it adds the NOT NULL and the
 * foreign key to auth.users — but its own notes say the ownership checks live
 * on child tables, and it leaves those four policies alone.
 *
 * That matters because RLS is the *only* enforcement for anything the browser
 * queries directly, and `components/VehicleCard.tsx:170` deletes a vehicle
 * straight from the browser client. `lib/api-auth.ts` is not in that path.
 *
 * This is a static read of the migration corpus, so it proves what the
 * migrations declare and not what the live database does.
 *
 * **That gap turned out to be the actual finding.** Measured 29 Jul against
 * the live project: anon cannot read a private vehicle, by list or by direct
 * id, nor any of its child tables — so the `USING (true)` policy in the
 * history is not what is running. Someone fixed it outside the migrations,
 * almost certainly through a dashboard.
 *
 * Which means the real defect is not an open database, it is that **the
 * migrations do not reproduce the live one**. A fresh environment built from
 * `supabase/migrations` comes up wide open while production is fine, and
 * nothing would say so. This suite is what makes that visible: it asserts what
 * a rebuild would get, which is exactly the thing no one was checking.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

interface PolicyStatement {
  name: string;
  file: string;
  body: string;
}

/**
 * Replay every migration in filename order and return the policies on
 * `vehicles` still standing at the end.
 *
 * Order matters: a permissive policy that is later dropped is not a finding,
 * and a scoped policy that is later replaced by a permissive one is.
 */
function survivingVehiclePolicies(): PolicyStatement[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const alive = new Map<string, PolicyStatement>();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    // `tsconfig` targets below ES2015, so no iterating a matchAll result.
    const dropRe = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?vehicles\s*;/gi;
    let drop: RegExpExecArray | null;
    while ((drop = dropRe.exec(sql)) !== null) alive.delete(drop[1]);

    const createRe = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?vehicles\b([\s\S]*?);/gi;
    let create: RegExpExecArray | null;
    while ((create = createRe.exec(sql)) !== null) {
      alive.set(create[1], { name: create[1], file, body: create[2] });
    }
  }

  const out: PolicyStatement[] = [];
  alive.forEach((p) => out.push(p));
  return out;
}

describe('vehicles RLS, as declared by the migrations', () => {
  const policies = survivingVehiclePolicies();

  it('declares policies on the vehicles table at all', () => {
    // A parser that silently matched nothing would make everything below pass.
    expect(policies.length).toBeGreaterThan(0);
  });

  it('has no surviving policy with an unrestricted USING clause', () => {
    const permissive = policies.filter((p) => /USING\s*\(\s*true\s*\)/i.test(p.body));

    expect(permissive.map((p) => `${p.name} (${p.file})`)).toEqual([]);
  });

  it('has no surviving policy with an unrestricted WITH CHECK clause', () => {
    // The one that lets a user hand their vehicle to someone else, or flip
    // is_demo and publish a row into the public demo.
    const permissive = policies.filter((p) => /WITH\s+CHECK\s*\(\s*true\s*\)/i.test(p.body));

    expect(permissive.map((p) => `${p.name} (${p.file})`)).toEqual([]);
  });

  it('scopes every write policy to the owner', () => {
    const writes = policies.filter((p) => /FOR\s+(INSERT|UPDATE|DELETE)/i.test(p.body));

    expect(writes.length).toBeGreaterThan(0);
    for (const p of writes) {
      expect(p.body).toMatch(/user_id\s*=\s*auth\.uid\(\)|user_owns_vehicle/i);
    }
  });

  /*
    ── A guard that was removed on purpose, and the reason, so it is not
       quietly restored or quietly forgotten ────────────────────────────────

    This assertion used to require `NOT is_demo` on every write policy, matching
    the first draft of 20260727150000.

    That draft was never applied, and a read-only sweep of production on 28 Jul
    2026 showed why it must not be: **none of the policy names it dropped exist
    live.** Live had been fixed by hand through the dashboard, under different
    names. Applying it would have left the four live policies in place and added
    four more beside them — and because permissive policies OR together, the
    `NOT is_demo` guard would have been nullified by the broader live policy
    next to it. The file would have read as though the hole was closed.

    So the migration was rewritten to *reproduce* live rather than change it,
    and live protects demo rows through ownership: `user_id = auth.uid()` never
    matches for a demo row, because no user owns one.

    The explicit flag guard is still worth having as defence in depth — it is
    what stops a user flipping `is_demo` true on their own row and publishing it
    into the public demo. But that is a **change to production behaviour**, and
    folding it into a reconciliation is exactly how the first version went
    wrong. It gets its own migration, applied deliberately, once history and
    database agree.

    Until then this asserts the property that actually holds, and the one below
    keeps the deferral honest.
  */
  it('scopes every write policy so no user can reach a row they do not own', () => {
    const writes = policies.filter((p) => /FOR\s+(INSERT|UPDATE|DELETE)/i.test(p.body));

    expect(writes.length).toBeGreaterThan(0);
    for (const p of writes) {
      // Ownership is the boundary. A demo row has no owner, so this covers the
      // demo case without naming it.
      expect(p.body).toMatch(/user_id\s*=\s*auth\.uid\(\)|user_owns_vehicle/i);
      expect(p.body).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    }
  });

  it('records that the is_demo write guard is deferred, not lost', () => {
    /*
      The deferral only stays honest if it is written down where the next person
      to read these policies will see it. If someone adds the guard, this fails
      and they delete it — which is the correct outcome, and the point.
    */
    const migration = readFileSync(
      join(MIGRATIONS, '20260727150000_scope_vehicles_rls_to_owner.sql'),
      'utf8'
    );

    /*
      Comments are stripped before looking for the guard, and this is the whole
      trick. The first version of this assertion scanned the raw file, so the
      sentence *explaining why the guard is absent* satisfied it — the test was
      vacuous and passed against a file with no guard and no explanation. It was
      caught by probing it with a real violation, which is the only reason it is
      not still sitting here green and meaningless.

      Same technique the illustration-tokens guard uses, for the same reason:
      a guard that can be satisfied by its own rationale is not a guard.
    */
    const sql = migration.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

    const hasGuard = /NOT\s+is_demo/i.test(sql);
    const explainsDeferral = /deliberately does NOT do/i.test(migration);

    expect({ hasGuard, explainsDeferral }).not.toEqual({
      hasGuard: false,
      explainsDeferral: false,
    });
  });

  it('keeps demo rows readable without a session, or the public demo dies', () => {
    // §3 item 6: the demo went down once when protection stopped accounting
    // for anonymous visitors. The SELECT policy is where that would happen
    // again, and it would happen at the database rather than in a route.
    const selects = policies.filter((p) => /FOR\s+SELECT/i.test(p.body));

    expect(selects.length).toBeGreaterThan(0);
    for (const p of selects) {
      expect(p.body).toMatch(/is_demo/i);
    }
  });
});
