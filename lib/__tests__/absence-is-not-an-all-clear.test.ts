/**
 * Nothing tells a user a check came back clean without going through the rule.
 *
 * @jest-environment node
 *
 * ── Why this is a ratchet and not another paragraph ─────────────────────────
 *
 * The same defect has been found in **five separate places**, each of the
 * first three by a person looking at a screen rather than by anything in the
 * build:
 *
 *   21 Aug  the web recall tile — a green tick and "No active recalls" on a
 *           2003 Accord inside the Takata campaigns, because its NHTSA record
 *           had never been fetched.
 *   22 Aug  the web health summary's generated prose — "While there are no
 *           active recalls…" sitting directly above the fixed tile, because
 *           the prompt was handed `nhtsa?.recalls?.length || 0`.
 *   22 Aug  the mobile recall screen — "NHTSA has no open recalls listed for
 *           this vehicle" for a car with no `nhtsa_data` row at all.
 *
 * ⚠ **The last two were found by this scan, on its first run**, which is the
 * argument for it existing:
 *
 *   22 Aug  `RecallHistoryModal` — a **green** icon, "No recalls to date" and
 *           "This vehicle has a clean safety record". A claim about the *car*
 *           rather than about NHTSA's list, and it sat behind the very tile
 *           that correctly said nothing had been checked.
 *   22 Aug  `IssuesTab` — "No known issues for this vehicle" on an empty list.
 *           ⚠ This one was **true**, by an upstream early return in
 *           `VehicleInsights` that nothing in the file stated. Made explicit
 *           rather than left ambient; see the note there on required props.
 *
 * `health-claims.ts` was written for the first. It did not prevent any of the
 * others, because none of them *used* it — each kept its own copy of the
 * question. CLAUDE.md's own account of `truncate-revoked` names this shape
 * exactly: a rule "correctly identified, correctly written down, and ignored"
 * is something that needs a ratchet rather than a paragraph.
 *
 * ── What this asserts, and what it deliberately does not ────────────────────
 *
 * **Any source that states a check came back clean must import the module that
 * decides whether it may.** Not that it renders correctly — a static scan
 * cannot know that — but that the file has the rule in scope at all. Every one
 * of the five defects above would have failed this: each stated a clean
 * result in a file that had never heard of `health-claims.ts`.
 *
 * ⚠ It cannot catch a *silence*. `VehicleDetailScreen` renders its recall
 * banner behind `recalls > 0`, so an unchecked car and a clean one both show
 * nothing — that is a weaker failure than a false sentence, and it is a design
 * decision rather than a lie, so it is recorded in the roadmap rather than
 * failed here. A test that demanded a claim on every screen would be inventing
 * product design.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { healthClaim } from '@wellkept/core/health-claims';

const ROOT = join(__dirname, '..', '..');

/**
 * Sentences that tell a reader a check ran and found nothing.
 *
 * Drawn from the copy that actually shipped, including the two that were
 * wrong. Deliberately not a clever pattern: a regex broad enough to catch
 * every phrasing would catch prose about recalls in general, and a guard that
 * cries wolf gets made to pass.
 */
const ALL_CLEAR = [
  'No active recalls',
  'No recalls on record',
  'no open recalls',
  'No recalls to date',
  'No known issues',
  'No items due',
];

/** The module that decides whether an all-clear may be stated. */
const RULE = 'health-claims';

/** Directories whose UI can make a claim to a user. */
const SURFACES = [
  join(ROOT, 'app'),
  join(ROOT, 'components'),
  join(ROOT, 'apps', 'mobile', 'src'),
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;

      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };

  walk(dir);
  return out;
}

/** Source with comments stripped — prose about a rule is not the rule. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const files = SURFACES.flatMap(sourceFiles);

describe('the scan looks at real sources', () => {
  it('walks every surface that can make a claim', () => {
    /*
      ⚠ The failure this repo keeps finding in its own instruments: a walker
      that silently returns nothing reports a clean app forever. Three
      directories, hundreds of files.
    */
    expect(files.length).toBeGreaterThan(100);

    for (const surface of SURFACES) {
      expect(files.some((f) => f.startsWith(surface))).toBe(true);
    }
  });

  it('can still detect an all-clear where one exists', () => {
    /*
      Anti-vacuous. If the phrasings drift and this list matches nothing, every
      assertion below passes while checking nothing — which is exactly how the
      21 Aug defect survived review.
    */
    const claiming = files.filter((f) => ALL_CLEAR.some((phrase) => code(f).includes(phrase)));

    expect(claiming.length).toBeGreaterThan(0);
  });
});

describe('stating a clean result requires the rule in scope', () => {
  it('every source that says a check found nothing imports health-claims', () => {
    /*
      ⚠ The assertion all three defects would have failed. Each hardcoded a
      reassuring sentence in a file that had never heard of the module written
      to govern exactly that sentence.

      Reported as paths so a failure names the file rather than a count.
    */
    const offenders = files
      .filter((f) => ALL_CLEAR.some((phrase) => code(f).includes(phrase)))
      .filter((f) => !code(f).includes(RULE))
      .map((f) => f.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });
});

describe('the rule itself still refuses an unchecked all-clear', () => {
  /*
    The scan above is about *reach* — which files have the rule available. This
    is about the rule still doing its job, so that satisfying the scan by
    importing a module that had gone soft would not be enough.
  */
  it('will not reassure about a check that never ran', () => {
    const claim = healthClaim('recall', '', false);

    expect(claim.state).toBe('unknown');
    expect(claim.text).toMatch(/not a clear result/i);
    for (const phrase of ALL_CLEAR) {
      expect(claim.text).not.toContain(phrase);
    }
  });

  it('still says so plainly when the check did run', () => {
    // The reassuring answer is one people are entitled to when it is true.
    expect(healthClaim('recall', '', true).text).toBe('No active recalls');
  });
});

/*
  ── ⚠ What this scan cannot do ────────────────────────────────────────────────

  It proves the rule is **in scope**, not that it is **used correctly**. A file
  can import `health-claims` and still render an all-clear on an unchecked car
  — verified by mutation: forcing `RecallHistoryModal`'s empty state back to
  the green branch leaves every assertion here green.

  So this file is the ratchet and `recall-dialog-claims.test.tsx` is the
  assertion. Saying which does what matters more than either: a reader who
  believed this scan covered rendering would stop writing the other kind.
*/
