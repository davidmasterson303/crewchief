/**
 * Thinking level — the ratchet.
 *
 * @jest-environment node
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 *
 * 2.95a reads like a ten-minute change: add `thinkingConfig` to `flashConfig`
 * and stop paying for reasoning nobody asked for. Done that way it takes
 * production down.
 *
 * The generation configs in `lib/gemini.ts` are shared across model families.
 * `flashConfig` is used with `FLASH_MODEL` (3.6) *and* with a 2.5 model on the
 * consultant health route. Measured against the live key on 2 Aug 2026,
 * sending a thinking level to `gemini-2.5-flash` returns:
 *
 *   400 INVALID_ARGUMENT — "Thinking level is not supported for this model."
 *
 * Not ignored. Refused. So a level baked into a shared config kills every 2.5
 * call site at once, and `tsc` is perfectly happy about it — the shapes match,
 * the model is a string, and nothing in the type system knows the two are
 * related.
 *
 * `withThinking` is the guard. This is what keeps the guard honest.
 *
 * ── The numbers behind the levels ───────────────────────────────────────────
 *
 * Same prompt, live key, 2 Aug 2026, `gemini-3.6-flash`:
 *
 *   unset 861 thinking tokens · HIGH 726 · LOW 424 · MINIMAL 0
 *
 * against ~150 tokens of visible answer in every case. Thinking bills at the
 * output rate, which is what made this the largest single cost lever in the
 * application.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptsThinkingLevel,
  CONSULTANT_HEALTH_MODEL,
  FLASH_MODEL,
  FLASH_VISION_MODEL,
  LITE_MODEL,
  PRO_MODEL,
} from '@wellkept/core/ai/models';
import { withThinking, flashConfig } from '@/lib/gemini';

const ROOT = join(__dirname, '..', '..');

describe('acceptsThinkingLevel', () => {
  it('accepts the 3.x models this application actually calls', () => {
    expect(acceptsThinkingLevel(FLASH_MODEL)).toBe(true);
    expect(acceptsThinkingLevel(FLASH_VISION_MODEL)).toBe(true);
    expect(acceptsThinkingLevel(LITE_MODEL)).toBe(true);
  });

  it('refuses 2.5, which answers a level with a 400', () => {
    // The measured failure. Both of these are live call sites.
    expect(acceptsThinkingLevel('gemini-2.5-flash')).toBe(false);
    expect(acceptsThinkingLevel(PRO_MODEL)).toBe(false);
  });

  it('refuses anything it does not recognise', () => {
    // Guessing "supported" costs an endpoint; guessing "unsupported" costs a
    // few tokens. The default leans to the cheap mistake.
    expect(acceptsThinkingLevel('')).toBe(false);
    expect(acceptsThinkingLevel('gpt-4o')).toBe(false);
    expect(acceptsThinkingLevel('gemini-2.0-flash')).toBe(false);
  });
});

describe('withThinking', () => {
  it('attaches the level for a model that takes one', () => {
    const cfg = withThinking(flashConfig, FLASH_MODEL, 'LOW');

    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('attaches nothing at all for a model that does not', () => {
    // Not `{ thinkingLevel: undefined }` — the key must be absent, because the
    // SDK serialises what it is given and the API rejects the field itself.
    const cfg = withThinking(flashConfig, 'gemini-2.5-flash', 'LOW');

    expect('thinkingConfig' in cfg).toBe(false);
  });

  it('never mutates the shared config it was handed', () => {
    /*
      These configs are module-level singletons imported by every call site. A
      version of this that assigned into `base` would re-tune every other
      caller, including the 2.5 ones, from whichever call ran first — a bug
      that would depend on request ordering and never reproduce locally.
    */
    const before = JSON.stringify(flashConfig);

    withThinking(flashConfig, FLASH_MODEL, 'HIGH');
    withThinking(flashConfig, LITE_MODEL, 'MINIMAL');

    expect(JSON.stringify(flashConfig)).toBe(before);
    expect('thinkingConfig' in flashConfig).toBe(false);
  });

  it('keeps the base settings alongside the level', () => {
    const cfg = withThinking(flashConfig, FLASH_MODEL, 'MINIMAL');

    expect(cfg.temperature).toBe(flashConfig.temperature);
    expect(cfg.maxOutputTokens).toBe(flashConfig.maxOutputTokens);
  });
});

describe('no call site sets a thinking level behind the guard', () => {
  const SOURCES = ['app/actions.ts', 'app/api/health/consultant/route.ts', 'lib/performance-stats.ts'];

  it.each(SOURCES)('%s never writes thinkingConfig by hand', (rel) => {
    /*
      The whole protection is that the level goes on through `withThinking`,
      where `acceptsThinkingLevel` can veto it. A hand-written `thinkingConfig`
      bypasses the veto, and it is exactly what someone reaches for when they
      want a level on one call and do not know why the helper exists.
    */
    const source = readFileSync(join(ROOT, rel), 'utf8');
    const handWritten = source.match(/thinkingConfig\s*:/g) || [];

    expect(handWritten).toEqual([]);
  });
});

describe('the consultant health check tests the consultant', () => {
  /*
    It did not. The route hardcoded `'gemini-2.5-flash'` while the consultant
    ran `FLASH_MODEL`, so the canary could report a healthy consultant on the
    strength of a different model answering a question nobody asked — and it
    would have stayed green through a 3.6 outage.

    `cc-product-0003` applied to an instrument: a green check is evidence only
    of what it actually examines.
  */
  const ROUTE = readFileSync(join(ROOT, 'app/api/health/consultant/route.ts'), 'utf8');

  it('runs the same model the consultant runs', () => {
    expect(CONSULTANT_HEALTH_MODEL).toBe(FLASH_MODEL);
  });

  it('names the constant rather than a literal', () => {
    expect(ROUTE).not.toMatch(/model:\s*['"`]gemini-/);
    expect(ROUTE).toMatch(/model:\s*CONSULTANT_HEALTH_MODEL/);
  });

  it('exercises the thinking level the consultant ships with', () => {
    // A gate that measured the unthrottled model would pass on quality the
    // real consultant no longer has.
    expect(ROUTE).toMatch(/withThinking\(flashConfig, CONSULTANT_HEALTH_MODEL, 'LOW'\)/);
  });
});
