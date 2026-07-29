/**
 * `bufferutil` and `utf-8-validate` must stay declared dependencies.
 *
 * @jest-environment node
 *
 * ── The evening this cost ───────────────────────────────────────────────────
 *
 * After a routine `rm -rf .next`, **every request touching the Gemini path
 * hung indefinitely** — no error, no timeout, no log line. Vehicle onboarding
 * sat on "Researching Vehicle…" forever across a reload and wrote no row.
 * `/api/health/ai` timed out locally while returning 200 on CI and the demo
 * throughout, which made it look like a deployment difference rather than a
 * missing package.
 *
 * The chain:
 *
 *     @google/genai -> ws -> bufferutil / utf-8-validate   (neither installed)
 *        -> webpack "Module not found"
 *        -> any request through lib/gemini.ts hangs rather than errors
 *
 * `npm install bufferutil utf-8-validate` fixed it immediately. The `.next`
 * wipe did not cause it — **it revealed it.** The bug had been latent, and
 * routine maintenance exposed it.
 *
 * ── Why a test and not just a package.json entry ────────────────────────────
 *
 * These arrived only because they were installed by hand. A fresh clone
 * reproduced the hang, because the working tree had them and the commit did
 * not. **A dependency that works because it happens to be there is not a fixed
 * bug** — so this asserts the declaration, where the fix actually lives.
 *
 * ── The lesson worth keeping ────────────────────────────────────────────────
 *
 * `Module not found` scrolled past in the dev log all day and was called
 * benign twice, in writing. It was the entire problem.
 *
 * **A permanent warning is a hiding place.** When something always warns, the
 * day it matters looks exactly like every other day. Same family as
 * `security.test.ts` passing without running, `load-maintenance-data`
 * reporting success after every query failed, and the `/api/health/ai` 404
 * that §25 degraded to a shrug: **a signal that is always the same carries no
 * information.**
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const REQUIRED = ['bufferutil', 'utf-8-validate'];

function manifest() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

describe("ws's optional native deps are declared, not incidental", () => {
  it.each(REQUIRED)('%s is a declared dependency', (name) => {
    const { dependencies = {}, devDependencies = {} } = manifest();
    expect(dependencies[name] ?? devDependencies[name]).toBeDefined();
  });

  it.each(REQUIRED)('%s is in dependencies, not devDependencies', (name) => {
    /*
      They are needed wherever the Gemini path runs, which includes the
      production server — not only during development. Netlify installs
      devDependencies today, so putting them there would work by accident and
      break the day that changes.
    */
    const { dependencies = {} } = manifest();
    expect(dependencies[name]).toBeDefined();
  });

  it('records why these exist, so nobody prunes them as unused', () => {
    /*
      Nothing in this repo imports either one. They are transitive optionals of
      `ws`, reached through @google/genai, so a dependency-pruning pass would
      read them as dead weight and remove them — reintroducing an indefinite
      hang that produces no error.

      The note lives in package.json itself because that is what someone
      pruning is looking at.
    */
    const raw = readFileSync(join(ROOT, 'package.json'), 'utf8');
    expect(raw).toMatch(/bufferutilNote|_comment|ws.*optional|do not remove/i);
  });
});
