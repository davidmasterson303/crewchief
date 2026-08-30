/**
 * When to explain notifications, and when to say nothing.
 *
 * @jest-environment node
 *
 * Phase 5, C5. The behaviour under test is **irreversible and observable once
 * per install**: iOS shows its permission dialog exactly once, and a "no" is
 * only undoable in Settings. There is no way to get this wrong in production
 * and then try again — which is the whole argument for the rule living in a
 * pure function with a suite around it rather than inside a screen.
 *
 * Every test below is a refusal except two. That asymmetry is the design: the
 * cost of not asking yet is a delay, and the cost of Apple's dialog appearing
 * uninvited is permanent.
 */

import {
  shouldShowPushPrimer,
  shouldRegisterSilently,
  PRIMER_COOLDOWN_DAYS,
  PRIMER_MIN_VEHICLES,
  PUSH_PRIMER_COPY,
  type PrimingInput,
} from '@wellkept/core/push-priming';
import { SERVICE_COOLDOWN_DAYS } from '@wellkept/core/notification-sweep';

const TODAY = '2026-08-12';

function input(overrides: Partial<PrimingInput> = {}): PrimingInput {
  return {
    permission: 'undetermined',
    dismissedOn: null,
    vehicleCount: 1,
    today: TODAY,
    ...overrides,
  };
}

describe('shouldShowPushPrimer', () => {
  it('shows for a first-time user who has added a car', () => {
    // The one case the screen exists for.
    expect(shouldShowPushPrimer(input())).toBe(true);
  });

  it('never shows to someone who already granted permission', () => {
    /*
      The regression most likely to be introduced later, and the most visibly
      wrong: a screen asking you to enable something you enabled months ago
      reads as a broken app, not as a considerate one.
    */
    expect(shouldShowPushPrimer(input({ permission: 'granted' }))).toBe(false);
    expect(shouldShowPushPrimer(input({ permission: 'granted', vehicleCount: 9 }))).toBe(false);
  });

  it('never shows to someone who already declined at the system level', () => {
    /*
      iOS will not re-prompt, so the screen could only send them to Settings.
      Someone who said no once and is then shown a screen about it has been
      nagged, and one notification is not worth that.
    */
    expect(shouldShowPushPrimer(input({ permission: 'denied' }))).toBe(false);
    expect(shouldShowPushPrimer(input({ permission: 'denied', dismissedOn: null }))).toBe(false);
  });

  it('does not ask before there is anything to notify about', () => {
    /*
      Earning the ask. Someone with an empty garage is being asked to agree to
      something abstract, and an abstract yes is the one most likely to be no.
    */
    expect(shouldShowPushPrimer(input({ vehicleCount: 0 }))).toBe(false);
    expect(shouldShowPushPrimer(input({ vehicleCount: PRIMER_MIN_VEHICLES }))).toBe(true);
  });

  it('waits out the cooldown after a "not now"', () => {
    expect(shouldShowPushPrimer(input({ dismissedOn: '2026-08-11' }))).toBe(false);
    expect(shouldShowPushPrimer(input({ dismissedOn: '2026-08-01' }))).toBe(false);
  });

  it('offers again once the cooldown has passed', () => {
    /*
      The pair to the test above. Without it, "never show again" would satisfy
      the cooldown assertions completely — and a primer that only ever appears
      once is a worse product than no primer, because the person who was busy
      the first time never gets asked at all.
    */
    expect(shouldShowPushPrimer(input({ dismissedOn: '2026-07-13' }))).toBe(true);
  });

  it('treats the cooldown boundary as elapsed', () => {
    const dismissed = new Date(
      Date.parse(`${TODAY}T00:00:00Z`) - PRIMER_COOLDOWN_DAYS * 86_400_000
    )
      .toISOString()
      .slice(0, 10);

    expect(shouldShowPushPrimer(input({ dismissedOn: dismissed }))).toBe(true);
  });

  it('stays quiet on an unreadable dismissal date', () => {
    /*
      Same direction as the sweep's cooldown, for the same reason: reading "we
      cannot tell, so ask" turns one corrupt value into a screen that appears
      on every launch, and no dedupe recovers from that.
    */
    expect(shouldShowPushPrimer(input({ dismissedOn: 'never' }))).toBe(false);
    expect(shouldShowPushPrimer(input({ dismissedOn: '' }))).toBe(false);
  });

  it('shares one cooldown number with the service sweep', () => {
    /*
      Not a coincidence to be tidied away later. Both answer "how long before
      raising the same subject again", and two different numbers for one idea
      is how a product starts feeling inconsistent for reasons nobody can name.
    */
    expect(PRIMER_COOLDOWN_DAYS).toBe(SERVICE_COOLDOWN_DAYS);
  });
});

describe('shouldRegisterSilently', () => {
  it('registers a device that already has permission, without any screen', () => {
    /*
      The upgrade path. Someone who granted on a previous version still needs
      their token filed against the account, and that must not sit behind a
      screen they will never be shown.
    */
    expect(shouldRegisterSilently('granted')).toBe(true);
  });

  it('does not register before permission exists', () => {
    expect(shouldRegisterSilently('undetermined')).toBe(false);
    expect(shouldRegisterSilently('denied')).toBe(false);
  });

  it('is the exact complement of showing the primer, for a user with a car', () => {
    /*
      The two functions must not both be false for a `granted` user (their
      token would never be filed) and must not both be true for anybody (they
      would be asked about something already on). Checked across every
      permission state rather than argued.
    */
    for (const permission of ['undetermined', 'granted', 'denied'] as const) {
      const primes = shouldShowPushPrimer(input({ permission }));
      const registers = shouldRegisterSilently(permission);
      expect(primes && registers).toBe(false);
    }

    expect(shouldRegisterSilently('granted')).toBe(true);
    expect(shouldShowPushPrimer(input({ permission: 'undetermined' }))).toBe(true);
  });
});

describe('the primer copy', () => {
  /*
    Placeholder copy, and David replaces it in Phase 5.5. These assertions are
    about the *shape* the screen needs rather than the words, so a rewrite does
    not fail them — but a rewrite that drops the part doing the work will.
  */

  it('names what arrives, so the screen answers the real objection', () => {
    const text = `${PUSH_PRIMER_COPY.title} ${PUSH_PRIMER_COPY.body} ${PUSH_PRIMER_COPY.detail}`.toLowerCase();

    // The honest question is "how much will this bother me". A primer that does
    // not answer it is decoration, and decoration gets declined.
    expect(text).toMatch(/recall/);
    expect(text).toMatch(/service|due/);
  });

  it('offers a refusal that costs nothing, and says so', () => {
    expect(PUSH_PRIMER_COPY.decline).toBeTruthy();
    expect(PUSH_PRIMER_COPY.reassurance.toLowerCase()).toMatch(/later|account|settings/);
  });

  it('does not promise anything the product cannot do', () => {
    /*
      The product sends exactly two kinds of notification — service due and
      recall — and both come from the nightly sweep. Copy implying real-time
      alerts, or anything about offers or deals, would be a promise no code
      keeps.

      ⚠ **Negations have to be stripped first, and the first version of this
      test did not.** The copy says "no offers, no news", which is a promise
      *not* to do the thing — and matching the bare word flagged it as the very
      claim it rules out. Same shape as `audit-feature-claims.mjs` learning that
      an `internal:` note legitimately names things that are gone: the sentence
      is about the absence, and a scanner that cannot see "no" reports the
      absence as a presence.

      So: remove `no <word>` and `nothing else` before looking. A promise that
      survives that is an actual promise.
    */
    const raw = `${PUSH_PRIMER_COPY.title} ${PUSH_PRIMER_COPY.body} ${PUSH_PRIMER_COPY.detail}`;
    const affirmative = raw
      .toLowerCase()
      .replace(/\bno\s+[\w-]+(?:,\s*no\s+[\w-]+)*/g, ' ')
      .replace(/\bnothing else\b/g, ' ')
      .replace(/\bnever\b/g, ' ');

    expect(affirmative).not.toMatch(/instant|real-?time|immediately|deal|offer|discount|promotion/);

    // And the strip must not have eaten the whole string, which would make the
    // assertion above vacuously true — the failure mode this repo keeps finding
    // in its own instruments.
    expect(affirmative.trim().length).toBeGreaterThan(80);
    expect(affirmative).toMatch(/recall/);
  });

  it('holds the house voice — plain, not cheeky', () => {
    // `cc-marketing-0001`: copy tone is plain and direct, no cocky lines. The
    // register is a visual decision; the voice is not.
    const text = `${PUSH_PRIMER_COPY.title} ${PUSH_PRIMER_COPY.body}`;
    expect(text).not.toMatch(/!/);
  });
});
