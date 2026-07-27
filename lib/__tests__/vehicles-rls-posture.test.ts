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
 * migrations declare and not what the live database does — the project's
 * Supabase is Bolt-managed and can drift. It is still the right ratchet: the
 * next permissive policy someone writes will fail here, and the reason it was
 * missed the first time is that nothing was looking.
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

  it('never lets a write policy touch a demo row', () => {
    // Demo vehicles are shared and recruiter-facing. The application layer
    // already refuses writes to them (authorizeVehicleAccess rejects
    // intent:'write'); the database should not be the weaker of the two.
    const writes = policies.filter((p) => /FOR\s+(INSERT|UPDATE|DELETE)/i.test(p.body));

    for (const p of writes) {
      expect(p.body).toMatch(/NOT\s+is_demo/i);
    }
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
