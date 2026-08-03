/**
 * Check every symbol CREWCHIEF_FEATURES.md names against the tree.
 *
 * ── Why this is a script and not a test ─────────────────────────────────────
 *
 * `CREWCHIEF_FEATURES.md` is not in this repository — it lives in the iCloud
 * docs folder, and `FeaturesDrawer.tsx` carries none of its pitch copy. So the
 * build cannot see the artifact, and the obvious model
 * (`provenance-claims.test.ts`, which fails the build on an unsubstantiated
 * claim rendered by the app) cannot be copied here. Making that possible means
 * moving the file into the repo, which is a real decision: it is the document
 * that gets sent to other people.
 *
 * Until then this runs by hand, like `audit-rls.mjs`.
 *
 * ── What it can and cannot catch ────────────────────────────────────────────
 *
 * It catches **drift**: a named function, table or path that no longer exists.
 * That is the failure mode that produced ten stale `lib/` paths after the
 * Phase 2.4 move into `@crewchief/core` — including `lib/onboarding.ts`, which
 * the knowledge base corrected on 28 Jul while this file kept the old path.
 *
 * It cannot catch a **false capability claim**, which is a semantic statement
 * about what the product does. Two of those have been found in this file by
 * reading it: "with the invoice attached", and "compare that against what you
 * were quoted" — the latter being where roadmap task 2.98b came from, a task
 * costed and sequenced off a sentence rather than off the tree. Those need a
 * person. This narrows where a person has to look.
 *
 * READ-ONLY.
 *
 *   node scripts/audit-feature-claims.mjs [path-to-features-doc]
 *
 * The path is an argument rather than an environment variable on purpose:
 * `env-parity.test.ts` requires every variable the code reads to be documented
 * in `.env.example`, and listing one there would imply this is application
 * configuration. It is a script parameter. The test was right to catch it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC =
  process.argv[2] ??
  '/Users/dm/Documents/Claude/Projects/davidmasterson.co/CREWCHIEF_FEATURES.md';

if (!existsSync(DOC)) {
  // Absent is not the same as failing. On any machine but David's Mac — or from
  // a Cowork sandbox, where ~95% of that folder reads EDEADLK — the file simply
  // is not there, and reporting that as drift would be exactly the
  // present-but-unreadable confusion `gl-tech-0006` warns about.
  console.log(`Features doc not readable at ${DOC} — skipping, not failing.`);
  process.exit(0);
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_./[\]-]*$/;
const SEARCH_DIRS = ['app', 'lib', 'components', 'packages', 'supabase', 'scripts'];

/**
 * Things that legitimately do not resolve against this tree.
 *
 * A checker that reports fourteen benign misses every run is one nobody runs
 * twice, and then it stops catching the one that matters. These are separated
 * out and reported quietly rather than being silently dropped — a category that
 * swallows a real defect is worse than noise.
 */
const SOURCE_EXT = /\.(ts|tsx|sql|mjs|js|toml|json)$/;

const NOT_A_TREE_PATH = [
  { name: 'commit SHA', test: (s) => /^[0-9a-f]{7,40}$/.test(s) },
  { name: 'GitHub slug', test: (s) => /^davidmasterson303\//.test(s) },
  { name: 'npm import', test: (s) => /^(next|react|@[a-z]+)\//.test(s) },
  { name: 'git branch', test: (s) => s === 'demo-live' || s === 'main' },
  // Checked last, and never applied to anything carrying a source extension:
  // an earlier version of this list matched on "has dots" and quietly swallowed
  // `storage-paths.test.ts` as a URL. A category that absorbs a real reference
  // is worse than the noise it was added to remove.
  { name: 'external URL', test: (s) => !SOURCE_EXT.test(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(s) },
];

let feature = '';
const missing = [];
const unverifiable = [];
const checked = new Set();

for (const line of readFileSync(DOC, 'utf8').split('\n')) {
  if (line.startsWith('### ')) feature = line.slice(4).trim();
  // `internal:` is included: the ten stale paths were spread across all three
  // fields, and two of them were only in internal notes.
  if (!/^- (how|pitch|internal):/.test(line)) continue;

  for (const m of line.matchAll(/`([^`]+)`/g)) {
    const sym = m[1];
    if (!IDENT.test(sym)) continue;
    if (checked.has(sym)) continue;
    checked.add(sym);

    const category = NOT_A_TREE_PATH.find((c) => c.test(sym));
    if (category) {
      unverifiable.push([feature, sym, category.name]);
      continue;
    }

    // A path-like symbol is a claim about the filesystem, not about source
    // text. Grepping file *contents* for it always misses, which made the first
    // run of this audit report six false negatives on paths that were correct.
    const looksLikePath = sym.includes('/') || /\.(ts|tsx|sql|mjs|toml|json)$/.test(sym);

    let found;
    if (looksLikePath) {
      found = existsSync(join(ROOT, sym));

      // A bare filename — `storage-paths.test.ts` — is a real reference written
      // without its directory. Fall back to locating it anywhere in the tree
      // before calling it stale.
      if (!found && !sym.includes('/')) {
        try {
          const hit = execFileSync(
            'find',
            ['.', '-name', sym, '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.claude/*'],
            { cwd: ROOT, encoding: 'utf8' }
          ).trim();
          found = hit.length > 0;
        } catch {
          found = false;
        }
      }

      // A directory fragment — `auth/callback`, `invoices/` — resolves against
      // the app router as often as against the root.
      if (!found && sym.includes('/')) {
        found = ['app', 'lib', 'components'].some((d) =>
          existsSync(join(ROOT, d, sym.replace(/\/$/, '')))
        );
      }
    } else {
      try {
        execFileSync(
          'grep',
          ['-rqF', '--include=*.ts', '--include=*.tsx', '--include=*.sql', '--', sym, ...SEARCH_DIRS],
          { cwd: ROOT, stdio: 'ignore' }
        );
        found = true;
      } catch {
        found = false;
      }
    }

    if (found) continue;

    /*
      An `internal:` note legitimately names things that are gone — that is what
      a note recording a fix is for. `uploadInvoiceForCompletion` "used to write
      `invoices/{file}`" is a correct sentence about a path that must *not*
      exist, and flagging it forever would train the reader to ignore this
      script's one real output.

      Scoped deliberately: only applies to a symbol that already failed to
      resolve, and only on a line explicitly narrating a change. It can still
      hide a genuine defect if such a line also happens to name a path that
      broke for an unrelated reason — so these are printed, not dropped.
    */
    if (/\b(used to|no longer|legacy|stopped being|previously|has been removed|instead of)\b/i.test(line)) {
      unverifiable.push([feature, sym, 'historical — named as removed']);
      continue;
    }

    missing.push([feature, sym]);
  }
}

console.log(
  `Symbols named in CREWCHIEF_FEATURES.md: ${checked.size} ` +
    `(${checked.size - unverifiable.length} checked against the tree, ` +
    `${unverifiable.length} not tree paths)`
);

if (unverifiable.length > 0) {
  console.log('\nNot checkable from here, and not defects:');
  for (const [f, s, why] of unverifiable) {
    console.log(`   ${f.padEnd(30)} ${s.padEnd(38)} ${why}`);
  }
}

if (missing.length === 0) {
  console.log('\n\x1b[32mEvery tree path in the document resolves.\x1b[0m');
  console.log(
    'Note: this proves nothing about whether the *claims* are true. Two false\n' +
      'capability claims have been found in this file by reading it, and neither\n' +
      'would have failed this check.'
  );
  process.exit(0);
}

console.log(`\n\x1b[31m${missing.length} stale reference(s):\x1b[0m`);
for (const [f, s] of missing) console.log(`   ${f.padEnd(34)} -> ${s}`);
process.exit(1);
