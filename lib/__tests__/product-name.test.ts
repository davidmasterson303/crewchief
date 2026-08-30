/**
 * The product is called **Well Kept**, and this is what stops the old name
 * coming back one call site at a time.
 *
 * ── Why a scanner rather than a checklist ───────────────────────────────────
 *
 * The 30 Aug rename touched 355 files. A rename that size is not finished when
 * the suites pass — it is finished when nothing can quietly reintroduce the old
 * name, and the failure mode is somebody copying a string from an older file,
 * or a merge landing a branch written before the rename.
 *
 * ⚠ **This scans stripped source, not raw text.** Every exemption below is
 * explained in a comment directly above the line it exempts, so a raw-text
 * scan would pass for a file where somebody deleted the code and left the
 * paragraph — the `.tap-target-44` trap from CLAUDE.md rule 5, which this
 * project has already paid for once.
 *
 * ── The exemptions are the interesting half ─────────────────────────────────
 *
 * Each one names something the rename deliberately did not touch, with the
 * reason. A hit that matches none of them fails, and the fix is either to
 * rename it or to add it here with an argument — which is the point: the list
 * is the record of what "CrewChief" still legitimately means in this tree.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const ROOTS = ['app', 'components', 'packages/core/src', 'apps/mobile/src'];
const EXTRA_FILES = ['apps/mobile/app.json', 'public/manifest.json'];

const OLD_NAME = /crew[-_ ]?chief/i;

type Exemption = { reason: string; pattern: RegExp };

/*
  Ordered loosest-last. Every entry is a thing that is NOT the product's name:
  an address that exists, an identifier something outside this repo already
  holds, or a character who has not been renamed yet.
*/
const EXEMPT: Exemption[] = [
  {
    reason: 'deep-link scheme — shipped builds already emit crewchief:// links',
    pattern: /crewchief:\/\//i,
  },
  {
    reason: 'Apple bundle identifier and the product ids built on it — permanent',
    pattern: /co\.davidmasterson\.crewchief/i,
  },
  {
    reason: 'live hostnames — the App Store URL and the demo',
    pattern: /crewchief(-demo)?\.davidmasterson\.co/i,
  },
  {
    reason: 'Expo slug and scheme in app.json — changing them moves EAS URLs',
    pattern: /"(slug|scheme)":\s*"crewchief"/i,
  },
  {
    reason: 'per-site Netlify environment variables — renamed only with Netlify',
    pattern: /CREWCHIEF_[A-Z_]+/,
  },
  {
    reason: 'persisted keys and the demo cookie — renaming them drops stored state',
    pattern: /['"`]crewchief[._-][A-Za-z-]|crewchief_demo|crewchief-failed-deletions/i,
  },
  {
    reason:
      'a window debug flag a developer types into a console — an internal identifier, not a name the product wears',
    pattern: /__CREW_CHIEF_DEBUG_VERBOSE/,
  },
  {
    reason: 'the support mailbox, which exists and is monitored',
    pattern: /crewchief\.support@gmail\.com/i,
  },
  {
    reason:
      'dead feedback address on a domain nobody here owns — flagged 30 Aug, David to decide whether it goes or moves',
    pattern: /feedback@crewchief\.app/i,
  },
  {
    reason:
      "the ADVISOR's name, not the product's — held until the persona is renamed, which is a voice rewrite and blocked on a name",
    pattern: /'CrewChief'|CrewChief:|Hey, CrewChief here\.|You are CrewChief|>CrewChief</,
  },
];

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, acc);
    else if (/\.(ts|tsx|json)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/* Comments carry the explanations, including this file's own reasoning about
   the old name. Scanning them would make every well-documented decision look
   like an unfinished rename.

   ⚠ A block comment is blanked in place rather than deleted. Deleting it
   collapses every line below it, so the line numbers stop matching the file —
   the first draft reported a docblock's `*` as a finding on the wrong line,
   which is a report nobody can act on. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');
}

function findings(): { file: string; line: number; text: string }[] {
  const files = [
    ...ROOTS.flatMap((r) => sources(join(ROOT, r))),
    ...EXTRA_FILES.map((f) => join(ROOT, f)),
  ];

  expect(files.length).toBeGreaterThan(300); // the walker returning nothing must not read as clean

  const out: { file: string; line: number; text: string }[] = [];
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const code = file.endsWith('.json') ? raw : stripComments(raw);
    const rawLines = raw.split('\n');
    /*
      The stripped copy decides whether a hit is in code or in prose; the RAW
      line is what gets matched against the exemptions and reported.

      ⚠ Not interchangeable: `stripComments` cuts `//` out of `crewchief://`,
      so a scheme line reaches the exemptions as `crewchief:` and matches none
      of them. Reading the verdict off the stripped text would have reported
      every deep link as an unfinished rename.
    */
    code.split('\n').forEach((stripped, i) => {
      if (!OLD_NAME.test(stripped)) return;
      const text = rawLines[i] ?? stripped;
      if (EXEMPT.some((e) => e.pattern.test(text))) return;
      out.push({ file: file.slice(ROOT.length + 1), line: i + 1, text: text.trim() });
    });
  }
  return out;
}

describe('the product is called Well Kept everywhere it is named', () => {
  it('no shipped source names the old product outside the exemption list', () => {
    expect(findings()).toEqual([]);
  });

  it('can still detect one', () => {
    /*
      The anti-vacuous case. `findings()` returning `[]` is the pass condition,
      and an empty result is also what a broken walker, a too-greedy stripper
      or an exemption that matches everything would produce.
    */
    const planted = 'const heading = "What CrewChief does for your car";';
    expect(OLD_NAME.test(planted)).toBe(true);
    expect(EXEMPT.some((e) => e.pattern.test(planted))).toBe(false);
  });

  it('strips comments in both directions', () => {
    // Too-greedy stripping is the other way this passes while checking nothing.
    expect(stripComments('/* CrewChief */ const a = 1;')).not.toMatch(OLD_NAME);
    expect(stripComments('const label = "CrewChief"; // note')).toMatch(OLD_NAME);
    // And line numbers survive, or a finding points at the wrong line.
    expect(stripComments('/* a\n b */\nconst x = 1;').split('\n')).toHaveLength(3);
  });

  it('the persona exemption covers the advisor and not the product', () => {
    const persona = EXEMPT.find((e) => e.reason.startsWith('the ADVISOR'))!;
    expect(persona.pattern.test("? 'Owner' : 'CrewChief'")).toBe(true);
    expect(persona.pattern.test('Everything else in CrewChief works the same')).toBe(false);
  });
});
