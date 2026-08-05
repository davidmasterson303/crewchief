/**
 * Two clients, one set of words for where an answer came from.
 *
 * @jest-environment node
 *
 * The "Based on" row is a **provenance claim**, and it has been wrong before:
 * `wishlist` and `service` were once collapsed into a single chip, and the app
 * asserted a mod profile for a car that had none. That bug is recorded in
 * `loadedContextKinds`; this file exists so the next version of it fails a test
 * rather than shipping.
 *
 * Phase 3.4 put a second renderer on the same claim — the Expo advisor screen —
 * and a phone and a laptop describing one answer differently is the same defect
 * at two-clients scale, invisible until someone holds them side by side. So the
 * labels moved to `@crewchief/core/consultant-context-kinds` and these are the
 * three things that keep them there.
 *
 * ── Why this is a static scan and not a render test ─────────────────────────
 *
 * Same reasoning as `mobile-api-only.test.ts`: it reads source text, so it
 * needs no React Native runtime and no second toolchain, and it therefore runs
 * on every `npm test` from the day the rule exists rather than from the day
 * someone configures a mobile runner.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONTEXT_KIND_LABELS,
  isContextKind,
  type ContextKind,
} from '@crewchief/core/consultant-context-kinds';

const REPO_ROOT = join(__dirname, '..', '..');

function source(...parts: string[]): string {
  return readFileSync(join(REPO_ROOT, ...parts), 'utf8');
}

/**
 * Read the kinds `loadedContextKinds` can actually push, from its body.
 *
 * Deliberately parsed rather than listed here. A hand-maintained copy is the
 * very thing this file is testing against — it would pass while the server
 * emitted a seventh kind no client could name.
 */
function kindsTheServerCanEmit(): string[] {
  const body = source('lib', 'consultant-context.ts');
  const fn = body.slice(body.indexOf('export function loadedContextKinds'));
  const end = fn.indexOf('\n}');
  return [...fn.slice(0, end).matchAll(/kinds\.push\('([a-z]+)'\)/g)].map((m) => m[1]);
}

describe('context kind labels', () => {
  it('names every kind the server can emit', () => {
    const emitted = kindsTheServerCanEmit();

    // Guards the parser itself. If the loader is refactored into a shape this
    // regex cannot read, an empty list would make the assertion below vacuous.
    expect(emitted.length).toBeGreaterThan(0);

    for (const kind of emitted) {
      expect(CONTEXT_KIND_LABELS[kind as ContextKind]).toBeTruthy();
    }
  });

  it('has no label for a kind the server cannot emit', () => {
    // The other direction, and the one that would otherwise rot quietly: a
    // label left behind after a kind is removed claims a source that no longer
    // exists.
    expect(Object.keys(CONTEXT_KIND_LABELS).sort()).toEqual(kindsTheServerCanEmit().sort());
  });

  it('distinguishes wishlist from service, because they were collapsed once', () => {
    // Not a tautology — it is the specific regression. `wishlist` means the
    // `wishlist_items` table (mods the owner wants); `service` means completed
    // work and maintenance lines. One chip for both claimed a mod profile the
    // demo Accord does not have.
    expect(CONTEXT_KIND_LABELS.wishlist).not.toBe(CONTEXT_KIND_LABELS.service);
    expect(new Set(Object.values(CONTEXT_KIND_LABELS)).size).toBe(
      Object.keys(CONTEXT_KIND_LABELS).length
    );
  });
});

describe('isContextKind', () => {
  it('accepts every declared kind', () => {
    for (const kind of Object.keys(CONTEXT_KIND_LABELS)) {
      expect(isContextKind(kind)).toBe(true);
    }
  });

  it('rejects what arrives off the wire when it is not a kind', () => {
    // The mobile client reads `contextKinds` out of parsed JSON, so these are
    // the shapes that actually turn up — not hypotheticals.
    for (const value of [undefined, null, 7, {}, [], 'KNOWLEDGE', 'quotes', '']) {
      expect(isContextKind(value)).toBe(false);
    }
  });

  it('is not fooled by inherited object properties', () => {
    // `value in CONTEXT_KIND_LABELS` walks the prototype chain, so 'toString'
    // and 'constructor' are `in` any object literal. A kind named by an
    // attacker-controlled response must not resolve to `undefined` at render.
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(isContextKind(inherited)).toBe(false);
    }
  });
});

describe('neither client keeps its own copy of the words', () => {
  /*
    The rule, stated once: the labels are declared in core and nowhere else.
    A literal like `knowledge: 'Knowledge base'` in a client is the drift this
    whole file is about, so it is matched directly rather than by counting
    imports — an import can coexist with a stale local copy, which is exactly
    how `CONTEXT_LABELS` survived in the web chat while core already existed.
  */
  const CLIENTS = [
    ['components', 'ConsultantChat.tsx'],
    ['apps', 'mobile', 'src', 'screens', 'AdvisorScreen.tsx'],
    ['apps', 'mobile', 'src', 'api', 'consultant.ts'],
  ];

  it.each(CLIENTS)('%s/%s declares no labels of its own', (...parts: string[]) => {
    const body = source(...parts);

    for (const [kind, label] of Object.entries(CONTEXT_KIND_LABELS)) {
      // The label text may appear in prose; a `kind: 'Label'` pair is a
      // redeclaration.
      expect(body).not.toMatch(new RegExp(`${kind}\\s*:\\s*['"\`]${label}['"\`]`));
    }
  });

  it.each(CLIENTS)('%s/%s says "Based on", not "Sources"', (...parts: string[]) => {
    const body = source(...parts);

    /*
      The wording is load-bearing and both clients have to hold it. These kinds
      report what was *loaded and put in front of the model* — checkable on the
      server. What the model used is not knowable anywhere, and an earlier
      version of this row claimed it.

      Matched only in rendered strings, since the docblocks discuss the word
      "Sources" precisely to explain why it is wrong.
    */
    expect(body).not.toMatch(/>\s*Sources\s*</);
  });
});
