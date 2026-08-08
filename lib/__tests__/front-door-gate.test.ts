/**
 * The order the anonymous front door's controls run in. Phase 2.97a/b.
 *
 * @jest-environment node
 *
 * Erratum T1 did not add a control — it **reordered** two that both already
 * existed, and the reorder was the entire finding. That makes ordering the
 * thing under test here, because an ordering is exactly what survives review
 * and dies in implementation: every check is present, the diff looks complete,
 * and the wrong one is load-bearing.
 *
 * Most assertions below would still pass if the checks ran in any order. The
 * ones that would not are marked, and they are the reason this file exists.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decideFrontDoorGate, tooFastMessage } from '@crewchief/core/front-door';
import { decideFrontDoor, frontDoorClosedMessage } from '@crewchief/core/ai/budget';

const OPEN = decideFrontDoor({ usedToday: 0, manuallyDisabled: false });
const EXHAUSTED = decideFrontDoor({ usedToday: Number.MAX_SAFE_INTEGER, manuallyDisabled: false });
const KILLED = decideFrontDoor({ usedToday: 0, manuallyDisabled: true });

const VISITOR = 'v1_8f3a2c9e4b7d1056';

describe('the happy path', () => {
  it('serves an ordinary request and carries the visitor through', () => {
    expect(decideFrontDoorGate({ budget: OPEN, rateLimited: false, visitorId: VISITOR })).toEqual({
      allow: true,
      visitorId: VISITOR,
    });
  });

  it('serves a request it cannot measure', () => {
    /*
      Deliberate. Refusing to answer a stranger because the funnel cannot record
      them would be instrumenting over serving — the measurement exists for the
      product, not the reverse. The funnel drops the event; the person still
      gets their answer.
    */
    expect(decideFrontDoorGate({ budget: OPEN, rateLimited: false, visitorId: null })).toEqual({
      allow: true,
      visitorId: null,
    });
  });
});

describe('the ordering — this is what the file is for', () => {
  it('the kill switch beats a rate limit', () => {
    // ORDER-SENSITIVE. If the bucket ran first, a flood arriving while someone
    // is trying to shut the door would be answered with 429s and the operator
    // would not be able to tell whether the switch had taken effect.
    const gate = decideFrontDoorGate({ budget: KILLED, rateLimited: true, visitorId: VISITOR });
    expect(gate.allow).toBe(false);
    expect(gate).toMatchObject({ refusal: 'disabled', status: 503 });
  });

  it('a closed door beats a rate limit', () => {
    /*
      ORDER-SENSITIVE, and the one with a real user cost. If the bucket ran
      first, a visitor would spend rate-limit budget on a request that was never
      going to be served — and be throttled tomorrow for it. The primary control
      is primary in sequence, not only in the comment above it.
    */
    const gate = decideFrontDoorGate({ budget: EXHAUSTED, rateLimited: true, visitorId: VISITOR });
    expect(gate.allow).toBe(false);
    expect(gate).toMatchObject({ refusal: 'closed', status: 503 });
  });

  it('the rate limit is only reached on a door that is open', () => {
    const gate = decideFrontDoorGate({
      budget: OPEN,
      rateLimited: true,
      retryAfterSeconds: 42,
      visitorId: VISITOR,
    });
    expect(gate).toMatchObject({ refusal: 'rate_limited', status: 429, retryAfterSeconds: 42 });
  });
});

describe('the statuses say the right thing', () => {
  it('a closed door is 503, not 429', () => {
    /*
      Not pedantry. 429 says "you did too much" and invites a retry in seconds —
      wrong on both counts, since the visitor did nothing and the door reopens
      at midnight UTC. 503 is also the correct signal to a crawler, which should
      back off rather than keep hammering a surface that is already over budget.
    */
    for (const budget of [EXHAUSTED, KILLED]) {
      const gate = decideFrontDoorGate({ budget, rateLimited: false, visitorId: VISITOR });
      expect(gate).toMatchObject({ status: 503 });
      expect(gate).not.toMatchObject({ status: 429 });
    }
  });

  it('distinguishes the operator turning it off from the ceiling being hit', () => {
    // Same status and same copy to the visitor, different `refusal` — so the
    // log can tell an incident from a deliberate act.
    expect(decideFrontDoorGate({ budget: KILLED, rateLimited: false, visitorId: null })).toMatchObject({
      refusal: 'disabled',
    });
    expect(
      decideFrontDoorGate({ budget: EXHAUSTED, rateLimited: false, visitorId: null })
    ).toMatchObject({ refusal: 'closed' });
  });
});

describe('what a stranger is told', () => {
  it('a closed door never mentions money', () => {
    const gate = decideFrontDoorGate({ budget: EXHAUSTED, rateLimited: false, visitorId: null });
    expect(gate).toMatchObject({ message: frontDoorClosedMessage() });
    for (const leak of ['budget', 'limit', 'cap', 'spend', 'cost', '$', 'quota']) {
      expect((gate as { message: string }).message.toLowerCase()).not.toContain(leak);
    }
  });

  it('the two refusals do not share copy', () => {
    /*
      They describe different situations with different remedies — one is about
      the visitor and resolves in seconds, the other is about us and resolves
      tomorrow. One shared string tells half of each group the wrong thing.
    */
    expect(tooFastMessage()).not.toBe(frontDoorClosedMessage());
  });

  it('the rate-limit copy does not blame the visitor for a fault', () => {
    expect(tooFastMessage().toLowerCase()).not.toContain('error');
    expect(tooFastMessage().toLowerCase()).toContain('try again');
  });
});

describe('D6 — no dossier generation on this path, ever', () => {
  /*
    An absence rather than a branch, because the correct implementation is that
    nothing on this path calls it. A $0.118 Pro dossier firing for anonymous
    traffic is the most expensive single mistake this surface could make, and it
    would arrive as an innocuous-looking import.

    Read off disk: the subject is what the modules reference, and importing them
    to check would prove nothing about what a future edit adds.
  */
  const CORE = join(__dirname, '..', '..', 'packages', 'core', 'src');
  const frontDoorModules = ['front-door.ts', 'funnel.ts', 'client-ip.ts', 'advice-range.ts'];

  const codeOf = (file: string) =>
    readFileSync(join(CORE, file), 'utf8')
      // Comments legitimately discuss the rule, so strip prose before asserting
      // — the same instrument failure `funnel-steps.test.ts` records.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  it.each(frontDoorModules)('%s names no dossier generation', (file) => {
    expect(codeOf(file)).not.toMatch(/dossier/i);
  });

  it.each(frontDoorModules)('%s survived the comment strip — the check is not vacuous', (file) => {
    /*
      An absence assertion passes trivially against an empty string, and the
      strip above is a regex over source. Prove the subject is still there
      before proving what it lacks.
    */
    const code = codeOf(file);
    expect(code).toMatch(/export/);
    expect(code.trim().length).toBeGreaterThan(200);
  });

  it('the four modules exist under the names asserted above', () => {
    /*
      Only an existence check, and named as one. An earlier version of this
      claimed to prove the list "still matches what is on disk" while filtering
      the directory by the same array it then compared against — tautological,
      and it would never have caught the thing it advertised.

      The real gap it pretended to close — a *fifth* front-door module nobody
      adds here — is not closable by filename, since nothing distinguishes a
      front-door module from any other in this directory. The honest guard is
      the route-level one, and it belongs with 2.97b when the route exists.
    */
    const present = new Set(readdirSync(CORE));
    for (const file of frontDoorModules) {
      expect(present.has(file)).toBe(true);
    }
  });
});

describe('nothing prefetches the front door', () => {
  /*
    A correctness requirement, not a style preference, and the reason is
    environmental rather than logical.

    Measured 3 Aug: **Next 13.5 strips `next-router-prefetch` and `RSC` before
    middleware runs.** During a prefetch-shaped request `handleFrontDoor`
    receives `accept`, `host` and `user-agent` and nothing else. A Next `<Link>`
    prefetch is a client `fetch()` that carries no browser prefetch header
    either, so from middleware it is indistinguishable from a person arriving.

    `isPrefetchRequest` still passes its own suite — it is correct, and it works
    in the route handler and against browser speculative loads. It simply cannot
    fire in the one position that mints visitor ids. That gap is closed here,
    at the only other place it can be: the links themselves.

    Without this, adding a nav link to the front door would silently inflate
    `landed` with everyone who merely saw the link, and every conversion rate
    below it would be divided by a made-up number — invisibly, and in the
    flattering direction for bounce.
  */
  const APP = join(__dirname, '..', '..', 'app');
  const COMPONENTS = join(__dirname, '..', '..', 'components');

  function tsxFiles(dir: string, acc: string[] = []): string[] {
    if (!existsSync(dir)) return acc;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) tsxFiles(full, acc);
      else if (entry.name.endsWith('.tsx')) acc.push(full);
    }
    return acc;
  }

  const files = [...tsxFiles(APP), ...tsxFiles(COMPONENTS)];

  it('found files to check — the sweep is not vacuous', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => f.slice(join(__dirname, '..', '..').length + 1)))(
    '%s does not link to the front door with prefetching on',
    (rel) => {
      const source = readFileSync(join(__dirname, '..', '..', rel), 'utf8');
      // Every <Link> whose href is the front door must disable prefetch.
      const links = source.match(/<Link\b[^>]*href=["'{]\/check["'}][^>]*>/g) || [];
      for (const link of links) {
        expect(link).toMatch(/prefetch=\{false\}/);
      }
    }
  );
});
