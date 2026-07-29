/**
 * Every environment variable the code reads must be documented in .env.example.
 *
 * @jest-environment node
 *
 * Found by audit on 27 Jul: the code had been reading
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and
 * `CREWCHIEF_CI_URL` for some time while `.env.example` listed none of them.
 *
 * That failure mode is quiet and expensive. A missing key does not break the
 * build — it breaks at runtime, in the deployment, usually as a feature that
 * silently returns nothing. This session already spent real time on two of
 * them: a dead deployed service-role key, and an expired
 * `GOOGLE_SEARCH_API_KEY` that made vehicle image lookup fail without an error.
 * `.env.example` is the only checklist that exists for a fresh clone or a new
 * Netlify environment, so it drifting is a deployment hazard rather than a
 * documentation nit.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SOURCE_DIRS = ['app', 'lib', 'packages', 'scripts', 'components'];
const SOURCE_FILES = ['middleware.ts'];

/**
 * Variables the platform provides, which nobody sets by hand.
 *
 * Netlify injects the build-metadata group; `NODE_ENV` is set by the runtime.
 * Documenting these in `.env.example` would invite someone to set them, which
 * is worse than leaving them out.
 */
const PLATFORM_PROVIDED = new Set([
  'NODE_ENV',
  'BRANCH',
  'COMMIT_REF',
  'HEAD',
  'BUILD_TIME',
  'NEXT_PUBLIC_COMMIT_SHA',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

function referenced(): Map<string, string[]> {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    try {
      walk(join(ROOT, dir), files);
    } catch {
      // A directory that does not exist is not a failure; the workspace moved
      // modules around in 2.4 and will again.
    }
  }
  for (const f of SOURCE_FILES) files.push(join(ROOT, f));

  const found = new Map<string, string[]>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const re = /process\.env\.([A-Z0-9_]+)/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const name = m[1];
      if (PLATFORM_PROVIDED.has(name)) continue;
      const where = found.get(name) ?? [];
      if (!where.includes(file)) where.push(file);
      found.set(name, where);
    }
  }
  return found;
}

function documented(): Set<string> {
  const text = readFileSync(join(ROOT, '.env.example'), 'utf8');
  const names = new Set<string>();
  const re = /^([A-Z0-9_]+)=/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) names.add(m[1]);
  return names;
}

describe('.env.example is the complete checklist', () => {
  it('found variables to check', () => {
    expect(referenced().size).toBeGreaterThan(5);
  });

  it('documents every variable the code reads', () => {
    const docs = documented();
    const missing = Array.from(referenced().entries())
      .filter(([name]) => !docs.has(name))
      .map(([name, files]) => `${name} (read in ${files[0].replace(ROOT + '/', '')})`);

    expect(missing).toEqual([]);
  });

  it('does not document variables nothing reads', () => {
    /*
      The other direction, and it matters just as much: a stale entry sends
      someone hunting for a key that no longer does anything, and makes the
      genuine entries look equally optional.

      SUPABASE_DB_URL is the one allowed exception — the migration and RLS
      verification scripts take it from the shell rather than through
      process.env, but a fresh clone still needs to know it exists.
      */
    const SET_BUT_NOT_READ_BY_CODE = new Set(['SUPABASE_DB_URL']);
    const refs = referenced();

    const orphans = Array.from(documented()).filter(
      (name) => !refs.has(name) && !SET_BUT_NOT_READ_BY_CODE.has(name)
    );
    expect(orphans).toEqual([]);
  });
});
