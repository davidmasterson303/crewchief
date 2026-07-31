/**
 * The app must not claim a record came from a model unless it did.
 *
 * @jest-environment node
 *
 * `ae45710` removed fabricated maintenance records from the demo: two
 * hardcoded visits rendered for every vehicle, each badged "AI Verified", with
 * a "View PDF" button that toasted a fabricated 99.2% confidence.
 *
 * A smaller version survived that clean-up and shipped to the public demo on
 * 31 Jul: an unconditional **AI Extracted** badge on every maintenance visit.
 * Its comment argued it was safe "because the only writer of this table is the
 * vision extraction path". Two writers say otherwise:
 *
 *   - `moveServiceItemToHistory` builds a row from a user-typed completion
 *     form — date, shop, cost, notes. Nothing is read by a model.
 *   - `20260314142241_seed_demo_vehicles.sql` INSERTs the history for all
 *     three demo cars. On the recruiter-facing surface, *every* record carried
 *     a provenance claim that was false.
 *
 * ── Why a test and not just a fix ──────────────────────────────────────────
 *
 * Because the fix is a deletion, and deletions come back. The badge is worth
 * having once provenance is actually recorded, and the tempting way to restore
 * it is to re-add the JSX — which is exactly how it got here. This fails the
 * build if a provenance claim is rendered on that page while nothing on the
 * row substantiates it.
 *
 * ── What it can and cannot do ──────────────────────────────────────────────
 *
 * Static: it reads the page source. It cannot prove a badge that *is* gated is
 * gated correctly. It can prove an ungated one is absent, which is the whole
 * of the bug that shipped.
 *
 * **To restore the badge legitimately:** add a column recording where a row
 * came from, set it at every write site, and render the badge from that. Then
 * the assertion below passes because the claim is conditional on data rather
 * than absent.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MAINTENANCE_PAGE = 'app/documents/[vehicleId]/page.tsx';

/** Phrases that assert a machine produced the record. */
const PROVENANCE_CLAIMS = [
  /AI\s+Extracted/i,
  /AI\s+Verified/i,
  /\d+(\.\d+)?%\s*confidence/i,
  /Digitized\s+by/i,
];

function source(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

/** Strip comments — this file's own explanation must not trip it. */
function code(file: string): string {
  return source(file)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the maintenance page', () => {
  const rendered = code(MAINTENANCE_PAGE);

  it('is still the page this guard is about', () => {
    // A renamed route would make every assertion below vacuous.
    expect(rendered).toMatch(/maintenance_line_items/);
  });

  it.each(PROVENANCE_CLAIMS.map((p) => [String(p), p] as const))(
    'makes no unconditional provenance claim matching %s',
    (_label, pattern) => {
      /*
        Deliberately a whole-file check rather than a per-element one. The
        badge that shipped was three lines of JSX with no condition anywhere
        near it, and any parser clever enough to decide "is this element
        gated?" would be a parser clever enough to be wrong about it.

        If a genuine, data-driven badge is added later, this will fail — and
        the right response is to widen the check to require the claim sit
        inside a conditional on a provenance field, not to delete the test.
      */
      expect(rendered).not.toMatch(pattern);
    }
  );

  it('still renders real maintenance history', () => {
    // The fix was to drop a false claim, not the data. If this page stopped
    // showing history, the 31 Jul migration bought nothing.
    expect(rendered).toMatch(/visits/);
    expect(rendered).toMatch(/from\('maintenance_line_items'\)/);
  });
});

describe('the writers of maintenance_line_items', () => {
  const actions = code('app/actions.ts');

  it('still has more than one, which is why the badge was wrong', () => {
    /*
      The premise the badge rested on. If this ever becomes true — one writer,
      the vision path — the badge could return unconditionally and this test
      is the record of why that would be legitimate.

      Counted rather than named: the point is "more than the extraction path",
      and naming them would break every time one is refactored.
    */
    const writers = actions.match(
      /from\('maintenance_line_items'\)\s*\.\s*(insert|upsert)/g
    );

    expect(writers).not.toBeNull();
    expect(writers!.length).toBeGreaterThan(1);
  });

  it('includes a path that writes user-entered data', () => {
    // moveServiceItemToHistory: a completion form, not an invoice.
    const start = actions.indexOf('export async function moveServiceItemToHistory');
    expect(start).toBeGreaterThan(-1);

    const next = actions.indexOf('\nexport async function', start + 1);
    const body = actions.slice(start, next === -1 ? actions.length : next);

    expect(body).toMatch(/from\('maintenance_line_items'\)/);
    expect(body).toMatch(/completionDetails/);
  });
});

describe('the demo seed', () => {
  it('writes maintenance history no model has ever read', () => {
    /*
      The half that made this a public problem rather than an internal one.
      Every row on all three demo cars is an INSERT in a migration, and the
      demo is the surface recruiters are sent to.
    */
    const seed = source('supabase/migrations/20260314142241_seed_demo_vehicles.sql');

    expect(seed).toMatch(/INSERT INTO (public\.)?maintenance_line_items/i);
  });
});
