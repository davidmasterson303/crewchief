/**
 * `$rules.noShadowedPrimitives` — nothing may be named after a primitive it is
 * not.
 *
 * @jest-environment node
 *
 * ── The pattern, three times ────────────────────────────────────────────────
 *
 * A private copy of a primitive is easy to spot when it is called
 * `emptyBlock`. One wearing the primitive's **own name** is invisible: it reads
 * as adoption, so an audit walks past it and the import it shadows is never
 * reached for.
 *
 * It cost three audits before it was named:
 *
 *   - `AdvisorScreen` defined `function EmptyState()` — which is why
 *     `EmptyState` reached 16 Aug with **zero callers** while four screens
 *     rolled their own.
 *   - `MarkDoneSheet` defined `function Field()` — the last screen in the app
 *     with no primitives, and the reason was sitting in its own file.
 *   - Four screens carried a style literally named `card` on the wrong ladder
 *     step. Same family, different mechanism, already guarded by
 *     `mobile-surface-ladder.test.ts`.
 *
 * ── The rule, and why it is a name check rather than a shape check ──────────
 *
 * "Do not reimplement a primitive" is not decidable from source — plenty of
 * local components legitimately resemble one. **A name collision is.** And it
 * is the collision, not the resemblance, that does the damage: `FieldGroup`
 * next to `Field` is honest and reviewable; a second `Field` is camouflage.
 *
 * So a local component may be as similar as it likes, provided it is not
 * lying about which one it is.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { surface, radius } from '../../apps/mobile/src/theme';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile', 'src');
const COMPONENTS = join(MOBILE_SRC, 'components');

/** Every primitive's name, taken from the directory rather than a list. */
function primitiveNames(): string[] {
  return readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => f.replace(/\.tsx$/, ''));
}

function sourceFiles(dir: string, acc: { rel: string; name: string; code: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, acc);
    } else if (entry.endsWith('.tsx')) {
      acc.push({
        rel: full.slice(full.indexOf(join('apps', 'mobile'))),
        name: entry.replace(/\.tsx$/, ''),
        code: readFileSync(full, 'utf8'),
      });
    }
  }
  return acc;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `function Name(` or `const Name = (` — the two ways a component is declared here. */
function declares(code: string, name: string): boolean {
  return (
    new RegExp(`function\\s+${name}\\s*\\(`).test(code) ||
    new RegExp(`const\\s+${name}\\s*[:=]`).test(code)
  );
}

describe('no local component wears a primitive s name', () => {
  const primitives = primitiveNames();
  const files = sourceFiles(MOBILE_SRC).map((f) => ({ ...f, code: stripComments(f.code) }));

  it('found the primitives and the sources to check them against', () => {
    // A broken read of either directory makes the rule below vacuous — the
    // failure mode this repo has now been caught by four times.
    expect(primitives.length).toBeGreaterThan(10);
    expect(files.length).toBeGreaterThan(15);
  });

  it('is anchored to a tree that actually resolves', () => {
    /*
      ⚠ Required by `tests-test-real-code`, and it caught this suite the day it
      was written: a rule that only reads strings can rot against a moved or
      renamed tree and go on reporting a clean app.

      The link is honest about being indirect. This rule is about **names**, and
      there is no plain-TypeScript module that holds them — every primitive is a
      `.tsx` that cannot be imported in a node environment. So it anchors to the
      layer those primitives are built from, exactly as the sibling static
      guards do. If `apps/mobile/src/theme` ever moved, this fails loudly rather
      than scanning a path that no longer means anything.
    */
    expect(surface.card).toMatch(/^#[0-9A-F]{6}$/i);
    expect(radius.card).toBe(14);
    expect(primitives).toContain('Field');
    expect(primitives).toContain('EmptyState');
  });

  it('has no shadow', () => {
    const offenders = files.flatMap((file) =>
      primitives
        // A primitive is allowed to declare itself.
        .filter((primitive) => primitive !== file.name)
        .filter((primitive) => declares(file.code, primitive))
        .map((primitive) => `${file.rel} — declares ${primitive}`)
    );

    expect(offenders).toEqual([]);
  });

  it('can still detect one, so this is not vacuous', () => {
    // The exact shape `AdvisorScreen` and `MarkDoneSheet` both carried.
    expect(declares('function EmptyState() {', 'EmptyState')).toBe(true);
    expect(declares('const Field = ({ label }) => {', 'Field')).toBe(true);

    // And clears the honest neighbour, which is the whole point of the rule.
    expect(declares('function FieldGroup({ label }) {', 'Field')).toBe(false);
    expect(declares('function AdvisorEmptyState() {', 'EmptyState')).toBe(false);
  });
});
