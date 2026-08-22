/**
 * The cache that stops the same car being researched twice.
 *
 * @jest-environment node
 *
 * `modification_details` was 89% of all AI spend in the first three weeks of
 * metering and had no cache at any level. This is the key that fixes it, and
 * the assertions below are mostly about one hazard: **a key narrower than the
 * prompt serves one car's answer for another's**, and that failure is silent
 * and confident — a fluent, specific analysis of the wrong vehicle, with no
 * error anywhere.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MOD_DETAIL_CACHE_TTL_MS,
  MOD_DETAIL_KEY_FIELDS,
  isModDetailCacheFresh,
  modDetailCacheKey,
  type ModDetailFacts,
} from '@crewchief/core/mod-detail-cache';

const BASE: ModDetailFacts = {
  year: 2018,
  make: 'Honda',
  model: 'Accord',
  modName: 'Cold air intake',
  performanceGoal: 'moderate',
  ownershipObjective: 'keep forever',
};

describe('the key contains everything the prompt varies on', () => {
  it.each(MOD_DETAIL_KEY_FIELDS.map((f) => [f]))(
    'changing %s changes the key',
    (field) => {
      /*
        ⚠ The assertion that keeps the cache honest. If any of these stopped
        affecting the key, two different questions would share one answer —
        and the reader would get a confident analysis of a car that is not
        theirs.
      */
      const changed = { ...BASE, [field as keyof ModDetailFacts]: 'something-else' };
      expect(modDetailCacheKey(changed)).not.toBe(modDetailCacheKey(BASE));
    }
  );

  it('pins the field list against the prompt itself', () => {
    /*
      Reads the actual prompt and asserts every value it interpolates is a key
      field. This is what makes adding a prompt input without widening the key
      a build failure rather than a poisoned cache.

      Matched on `vehicle.<field>` and the loose locals the prompt reads, rather
      than on prose, because the docblock beside it names the same words.
    */
    const actions = readFileSync(join(__dirname, '..', '..', 'app', 'actions.ts'), 'utf8');
    const start = actions.indexOf('export async function generateModificationDetails');
    expect(start).toBeGreaterThan(-1);

    const promptStart = actions.indexOf('You are an expert automotive consultant', start);
    const promptEnd = actions.indexOf('Format as valid JSON only', promptStart);
    expect(promptStart).toBeGreaterThan(-1);
    expect(promptEnd).toBeGreaterThan(promptStart);

    const prompt = actions.slice(promptStart, promptEnd);

    /*
      Every `${...}` the prompt interpolates, reduced to the underlying fact it
      reads. If a new one appears that is not in this map, the test fails and
      whoever added it has to decide whether it belongs in the key.
    */
    const KNOWN: Record<string, string> = {
      'vehicle.year': 'year',
      'vehicle.make': 'make',
      'vehicle.model': 'model',
      modName: 'modName',
      performanceGoal: 'performanceGoal',
      'performanceGoal.toUpperCase()': 'performanceGoal',
      'GOAL_CONTEXT[performanceGoal]': 'performanceGoal',
      'vehicle.ownership_objective': 'ownershipObjective',
    };

    const interpolations = Array.from(prompt.matchAll(/\$\{([^}]+)\}/g)).map((m) =>
      m[1].trim()
    );
    expect(interpolations.length).toBeGreaterThan(4);

    const unknown = interpolations.filter((raw) => {
      const head = raw.split('||')[0].trim().replace(/^'.*'$/, '');
      return !Object.keys(KNOWN).some((k) => head.startsWith(k));
    });

    expect(unknown).toEqual([]);
  });
});

describe('two owners of the same car share one answer', () => {
  it('produces the same key regardless of case and spacing', () => {
    // The database holds both 'HONDA' and 'Honda'; they are the same make.
    const other: ModDetailFacts = {
      year: '2018',
      make: '  HONDA ',
      model: 'accord',
      modName: 'Cold  air   intake',
      performanceGoal: 'MODERATE',
      ownershipObjective: 'Keep Forever',
    };

    expect(modDetailCacheKey(other)).toBe(modDetailCacheKey(BASE));
  });

  it('does not merge a missing objective with a present one', () => {
    /*
      Anti-vacuous in the direction that matters: normalisation must not be so
      eager that two genuinely different questions collide.
    */
    const noObjective = { ...BASE, ownershipObjective: null };
    expect(modDetailCacheKey(noObjective)).not.toBe(modDetailCacheKey(BASE));
  });

  it('cannot be collided by punctuation inside a field', () => {
    /*
      `modName` is free text from a model, so a separator that can appear inside
      a value is how `make = "a|b"` collides with a two-field key. The unit
      separator cannot occur in these strings.
    */
    const a = modDetailCacheKey({ ...BASE, make: 'Honda|Accord', model: 'x' });
    const b = modDetailCacheKey({ ...BASE, make: 'Honda', model: 'Accord|x' });
    expect(a).not.toBe(b);
  });
});

describe('freshness', () => {
  const now = new Date('2026-08-21T12:00:00Z');

  it('serves a recent entry', () => {
    expect(isModDetailCacheFresh('2026-08-20T12:00:00Z', now)).toBe(true);
  });

  it('regenerates past the window', () => {
    expect(isModDetailCacheFresh('2026-06-01T12:00:00Z', now)).toBe(false);
    expect(MOD_DETAIL_CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it.each([[null], [undefined], ['not a date'], ['']])(
    'treats %p as stale rather than fresh',
    (value) => {
      // Absence is never a reason to serve something.
      expect(isModDetailCacheFresh(value as string | null, now)).toBe(false);
    }
  );

  it('treats a future timestamp as stale', () => {
    /*
      Clock skew writing tomorrow's date would otherwise pin an entry as valid
      indefinitely. Regenerating once is cheaper than a permanently frozen
      answer.
    */
    expect(isModDetailCacheFresh('2027-01-01T00:00:00Z', now)).toBe(false);
  });
});

describe('the call site uses it, and does not cache a failure', () => {
  const actions = readFileSync(join(__dirname, '..', '..', 'app', 'actions.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('reads the cache before calling Gemini', () => {
    const read = actions.indexOf("from('mod_detail_cache')");
    const call = actions.indexOf('genAI.models.generateContent', actions.indexOf('generateModificationDetails'));

    expect(read).toBeGreaterThan(-1);
    expect(`readBeforeCall:${read < call}`).toBe('readBeforeCall:true');
  });

  it('only writes the cache on a clean parse', () => {
    /*
      ⚠ `details` starts as generic placeholder text — "Performance gains will
      vary" — which is fine to show once when a parse fails and is a thirty-day
      lie if cached and served to every other owner of that car.
    */
    expect(actions).toContain('parsedCleanly');
    const gate = actions.indexOf('if (parsedCleanly)');
    const upsert = actions.indexOf("upsert(", actions.indexOf("from('mod_detail_cache')", gate));

    expect(gate).toBeGreaterThan(-1);
    expect(`gatedBeforeWrite:${gate < upsert}`).toBe('gatedBeforeWrite:true');
  });

  it('runs the mod paths at MINIMAL thinking', () => {
    /*
      Measured 21 Aug, same prompt and model: LOW spent 544 thinking tokens for
      432 of output; MINIMAL spent 0 for 433, at 53% the cost and 46% the
      latency, with the same horsepower figures, costs, brands and warnings.
    */
    const modDetails = actions.slice(
      actions.indexOf('export async function generateModificationDetails')
    );
    const config = modDetails.slice(0, modDetails.indexOf('recordAiUsageInBackground'));
    expect(config).toContain("'MINIMAL'");
    expect(config).not.toContain("'LOW'");
  });

  it('leaves the prose and safety paths at LOW', () => {
    /*
      Anti-vacuous, and a real boundary. The consultant writes prose and the
      health summary feeds the recall and issues tiles — no money in either
      (3% and 0.3% of spend) and real judgment in both. Cheapening them would
      be trading quality for nothing.
    */
    for (const fn of ['sendConsultantMessage', 'generateVehicleHealthSummary']) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      const config = body.slice(0, body.indexOf('recordAiUsageInBackground'));
      expect(`${fn}:${config.includes("'LOW'")}`).toBe(`${fn}:true`);
    }
  });
});
