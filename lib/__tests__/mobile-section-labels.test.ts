/**
 * No uppercased label is built from a car's name.
 *
 * @jest-environment node
 *
 * `SectionHeader` and `ListGroup` both call `.toUpperCase()` on the label they
 * are given — that is the system's `.label-uppercase` role, 12px/600/0.08em, and
 * it is right for a noun that names a group.
 *
 * It is wrong for anything containing a **model designation**. The build screen
 * shipped `title={\`Next steps for ${state.name}\`}`, which rendered
 * **`NEXT STEPS FOR 2015 BMW M235I`**. The lower-case `i` in `M235i` is part of
 * BMW's name for the car, not a typographic choice, and uppercasing it produces
 * a model that does not exist. Nothing failed; the header simply named the wrong
 * car, on the screen about that car.
 *
 * ── What is actually checkable ──────────────────────────────────────────────
 *
 * "Do not uppercase a model designation" cannot be checked from source — the
 * string is not there to look at. What *is* checkable is whether the label
 * expression reaches for a vehicle at all, and `VEHICLE_WORDS` below is that
 * list. Counts are fine: `${shown.length} matching` is uppercased to
 * `3 MATCHING` and loses nothing.
 *
 * ⚠ **The hole this leaves, stated rather than papered over.** A label built
 * into a variable somewhere else in the file and passed in as `label={heading}`
 * is invisible here. It is a real gap and the honest trade: catching it would
 * need to follow the assignment, and a guard that tries to be a type-checker is
 * the guard that starts crying wolf — which §5 rates worse than none. What is
 * covered is the shape that shipped and every direct rewrite of it.
 *
 * ── What this deliberately does not cover ───────────────────────────────────
 *
 * `BayRoom`'s wordmark uppercases the **make** (`BMW`, `HONDA`). A make is not a
 * model designation, it is set as a wordmark on purpose, and the component owns
 * the decision rather than taking it from a caller. Different question.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');

/** Every `.tsx` under `apps/mobile/src`, tests excluded. */
function screens(dir: string, found: Array<{ rel: string; code: string }> = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'test-support') screens(full, found);
      continue;
    }

    if (entry.endsWith('.tsx')) {
      found.push({ rel: full.slice(full.indexOf(join('apps', 'mobile'))), code: readFileSync(full, 'utf8') });
    }
  }

  return found;
}

/** A label prop whose value is an expression rather than a string literal. */
const COMPUTED_LABEL = /<(?:SectionHeader|ListGroup)\b[^>]*?\b(?:title|label)=\{([^}]*)\}/;

/**
 * Identifiers that mean a car is being interpolated into a label.
 *
 * `state.name` is the one that shipped. The rest are the other spellings this
 * codebase uses for the same value, so the next version of the mistake is
 * caught in whichever vocabulary it arrives in.
 */
const VEHICLE_WORDS = /\b(name|title|vehicle|car|make|model)\b/i;

/** The same props given a literal, for the anti-vacuous check. */
const LITERAL_LABEL = /<(?:SectionHeader|ListGroup)\b[^>]*?\b(?:title|label)="/;

function offendingLines(code: string): string[] {
  return code
    .split('\n')
    .filter((line) => {
      const expression = COMPUTED_LABEL.exec(line)?.[1];
      return expression !== undefined && VEHICLE_WORDS.test(expression);
    })
    .map((line) => line.trim());
}

const sources = screens(MOBILE_SRC);

describe('section labels are nouns, not sentences built from a car', () => {
  it('finds the labels it is meant to be checking', () => {
    /*
      The anti-vacuous half, and this one has teeth: the regex matches a single
      line, so a `<SectionHeader` broken across lines by a formatter would make
      every assertion below pass while checking nothing. Counting the literals
      proves the shape it expects is the shape on disk.
    */
    const withLiterals = sources.filter((file) => LITERAL_LABEL.test(file.code));

    expect(sources.length).toBeGreaterThan(20);
    expect(withLiterals.length).toBeGreaterThanOrEqual(3);
  });

  it('builds no label out of a car', () => {
    const offenders = sources.flatMap((file) =>
      offendingLines(file.code).map((line) => `${file.rel} — ${line}`)
    );

    expect(offenders).toEqual([]);
  });

  it('can still detect one', () => {
    /*
      Rule 5's other half. The exact line that shipped, and a plainer variable
      form — both have to fire, or this guard is a comment.
    */
    expect(
      offendingLines('          <SectionHeader title={`Next steps for ${state.name}`} />')
    ).toHaveLength(1);

    expect(offendingLines('<ListGroup label={`${vehicle.model} parts`}>')).toHaveLength(1);

    // A literal must not fire…
    expect(offendingLines('<SectionHeader title="Order of work" />')).toEqual([]);
    // …and neither must a count, which uppercases harmlessly.
    expect(offendingLines('<ListGroup key={label} label={label}>')).toEqual([]);
    expect(offendingLines('<ListGroup label={`${shown.length} matching`}>')).toEqual([]);
  });
});
