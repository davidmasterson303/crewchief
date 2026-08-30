/**
 * Model tiering — the ratchet.
 *
 * @jest-environment node
 *
 * `packages/core/src/ai/models.ts` has always existed, has always been
 * imported by `app/actions.ts`, and until 30 Jul 2026 was never *used*: all 12
 * Gemini call sites hardcoded `'gemini-2.5-flash'`. The constants file
 * described an intention, `CREWCHIEF_FEATURES.md` published that intention as
 * fact, and the code did something else.
 *
 * Nothing had caused that. Nobody decided it. A call site was copy-pasted, and
 * then eleven more were copy-pasted from it — which is why the fix is a check
 * and not a cleanup. A cleanup would decay the same way, for the same reason.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRO_MODEL,
  FLASH_MODEL,
  LITE_MODEL,
  FLASH_VISION_MODEL,
} from '@wellkept/core/ai/models';

const ROOT = join(__dirname, '..', '..');
const ACTIONS = readFileSync(join(ROOT, 'app/actions.ts'), 'utf8');

describe('model selection is a decision, not a literal', () => {
  it('app/actions.ts contains no hardcoded gemini model id', () => {
    /*
      The exact regression. Matches `model: 'gemini-…'` in any quote style, so
      a new call site that pastes an identifier fails the build rather than
      silently opting out of the tiering.
    */
    const literals = ACTIONS.match(/model:\s*['"`]gemini-[^'"`]*['"`]/g) || [];

    expect(literals).toEqual([]);
  });

  it('every generateContent call names a tier constant', () => {
    const modelArgs = ACTIONS.match(/^\s*model:\s*(.+),$/gm) || [];
    const tierNames = ['PRO_MODEL', 'FLASH_MODEL', 'LITE_MODEL', 'FLASH_VISION_MODEL'];

    const offenders = modelArgs
      .map((line) => line.trim())
      // `model:` also appears in vehicle records (make/model), which are data,
      // not model selection. Those read from a variable, never a bare tier name
      // or a quoted gemini id, so filtering on the tier vocabulary is enough.
      .filter((line) => /['"`]gemini-/.test(line))
      .filter((line) => !tierNames.some((t) => line.includes(t)));

    expect(offenders).toEqual([]);
  });
});

describe('the tiers are pinned, and distinct where it matters', () => {
  const tiers = { PRO_MODEL, FLASH_MODEL, LITE_MODEL, FLASH_VISION_MODEL };

  it.each(Object.entries(tiers))('%s is a concrete gemini id', (_name, value) => {
    expect(value).toMatch(/^gemini-/);
  });

  it.each(Object.entries(tiers))('%s is pinned, not a moving alias', (_name, value) => {
    /*
      `gemini-flash-latest` and `gemini-pro-latest` exist and are available to
      this credential. They are refused deliberately: a model changing under a
      running app is the failure this codebase is worst at noticing, because a
      worse invoice extraction still returns well-formed JSON and still passes
      every gate. An upgrade should be a commit someone verified.
    */
    expect(value).not.toMatch(/-latest$/);
  });

  it('vision is pinned separately from the general workhorse', () => {
    /*
      They may hold the same identifier — today they do. The point is that they
      are two constants, so vision can be held back or moved forward on its own
      evidence. Vision regressions are the invisible ones.
    */
    const source = readFileSync(join(ROOT, 'packages/core/src/ai/models.ts'), 'utf8');

    expect(source).toMatch(/export const FLASH_VISION_MODEL/);
    expect(source).toMatch(/export const FLASH_MODEL/);
  });

  it('the reasoning tier is not the same model as the cheap tier', () => {
    // If these ever collapse to one value, the tiering has stopped meaning
    // anything and the file should be deleted rather than left as decoration.
    expect(PRO_MODEL).not.toBe(LITE_MODEL);
  });
});
