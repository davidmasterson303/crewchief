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

  /*
    ── Widened on 1 Aug, in the way this file said to widen it ───────────────

    The original assertion was `not.toMatch` on the whole file, with a note:
    "If a genuine, data-driven badge is added later, this will fail — and the
    right response is to widen the check to require the claim sit inside a
    conditional on a provenance field, not to delete the test."

    That is what happened. `20260801120000` adds `maintenance_line_items.source`,
    both write sites set it, and the badge is now gated on `visit.allVision`. So
    the rule is no longer "this phrase is absent" but "this phrase is guarded",
    which is the property that was actually wanted all along — the earlier form
    was the strongest check available while no provenance existed.
  */
  /** The exact JSX gate the badge is allowed to live behind. */
  const GATE = "{visit.allVision && (";

  /**
   * The file with the gated badge block cut out of it.
   *
   * Everything this returns is, by construction, *not* behind the provenance
   * conditional — so no provenance phrase may appear anywhere in it.
   *
   * ── The version of this that passed while proving nothing ─────────────────
   *
   * The first attempt split the file on `/allVision/` and checked the segments.
   * It failed a probe: `allVision` appears in the `ServiceRecord` interface and
   * in `groupIntoVisits`, both of which sit *above* the page heading, so the
   * heading landed in a mid-file segment that the check then skipped. Restoring
   * `Digitized by ...` to the heading — the exact page-scale defect `9597869`
   * removed — passed all four patterns.
   *
   * That is the same failure as the fixed-byte window in the demo-consultant
   * guard: an assertion that runs, goes green, and examines the wrong bytes.
   * Anchoring on the literal gate rather than on the field name is what fixes
   * it, because the field name occurs in three places and the gate in one.
   */
  function outsideTheGate(src: string): string {
    const open = src.indexOf(GATE);
    if (open === -1) return src; // No gate: nothing is exempt.

    // The badge block is flat JSX — one <span>, no parenthesised children — so
    // the first `)}` after the opener is its close.
    const close = src.indexOf(')}', open + GATE.length);
    if (close === -1) return src; // Unterminated: exempt nothing.

    return src.slice(0, open) + src.slice(close + 2);
  }

  it('derives its provenance flag from the source column, not from a guess', () => {
    /*
      The gate has to be computed from data. A `visit.allVision` that was itself
      hardcoded true would satisfy every assertion below while restoring the
      exact bug — so pin it to the column that feeds it.
    */
    expect(rendered).toMatch(/row\.source === 'vision'/);
    expect(rendered).toMatch(/visit\.allVision = visit\.allVision &&/);
    expect(rendered).toMatch(/source/);
  });

  it('exempts only the badge, and nothing else', () => {
    /*
      Pins the carve-out itself. If `outsideTheGate` ever started returning the
      whole file minus half the page, the assertions below would go quiet
      without anyone noticing — so state its size: it removes a short block, not
      a large region.
    */
    const removed = rendered.length - outsideTheGate(rendered).length;
    expect(removed).toBeGreaterThan(0);
    expect(removed).toBeLessThan(400);
  });

  it.each(PROVENANCE_CLAIMS.map((p) => [String(p), p] as const))(
    'makes no provenance claim outside the badge conditional, matching %s',
    (_label, pattern) => {
      /*
        Deliberately not a JSX parser: a parser clever enough to decide "is this
        element gated?" would be a parser clever enough to be wrong about it.
        One literal gate is cut out; everything remaining must be clean. A claim
        re-added anywhere else — a second badge, a card subtitle, or the page
        heading where `Digitized by` lived — is outside, and fails here.
      */
      expect(outsideTheGate(rendered)).not.toMatch(pattern);
    }
  );

  it('fails if the badge stops being conditional', () => {
    /*
      The specific regression: delete `visit.allVision &&` and leave the JSX.
      `outsideTheGate` returns the whole file when the gate is missing, so the
      assertions above already catch it — this states the rule directly so the
      reason is legible when it fires.
    */
    if (PROVENANCE_CLAIMS.some((p) => p.test(rendered))) {
      expect(rendered).toContain(GATE);
    }
  });

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
