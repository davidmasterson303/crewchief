/**
 * No free tier, and a lapse drops to read-only.
 *
 * @jest-environment node
 *
 * Both are David's decisions of 30 Aug, and between them they replace a tier
 * system with an access system. The assertions here are about the two
 * properties that make that safe rather than merely different:
 *
 *   **Nobody unpaid can spend money.** `canGenerate` is false for every state
 *   except `subscribed`. That is what makes the pricing model's "worst case per
 *   prospect is zero" a fact rather than an intention.
 *
 *   **Nobody is locked out of their own records.** Reading, exporting and
 *   deleting survive a lapse, because the argument in `paid-features.ts` — that
 *   a garage which stops working when a subscription ends is a hostage — was
 *   never about tiers.
 */

import {
  RECALL_ALERTS_AFTER_LAPSE,
  canGenerate,
  permits,
  refusalCopy,
  type AccessState,
  type Capability,
} from '@wellkept/core/access';

const STATES: AccessState[] = ['demo', 'subscribed', 'lapsed', 'unsubscribed'];

describe('only a subscriber can spend money', () => {
  it.each(STATES.filter((s) => s !== 'subscribed'))('%s cannot generate', (state) => {
    /*
      The whole pricing model rests on this one line. "Worst case per prospect
      is zero" is only true while no unpaid state can reach a model, and a
      fourth state added later without a rule here would break it silently —
      which is why the table below is exhaustive rather than a spot check.
    */
    expect(canGenerate(state)).toBe(false);
  });

  it('a subscriber can', () => {
    // Anti-vacuous: a `canGenerate` that returned false for everything would
    // pass every assertion above and ship a product nobody can use.
    expect(canGenerate('subscribed')).toBe(true);
  });
});

describe('a lapse takes the writing, never the reading', () => {
  const KEPT: Capability[] = ['read-own-records', 'export', 'delete-account'];
  const LOST: Capability[] = ['write-own-records', 'generate'];

  it.each(KEPT)('lapsed keeps %s', (capability) => {
    expect(permits('lapsed', capability)).toBe(true);
  });

  it.each(LOST)('lapsed loses %s', (capability) => {
    expect(permits('lapsed', capability)).toBe(false);
  });

  it('keeps deletion reachable in every state that has an account', () => {
    /*
      Guideline 5.1.1(v). A deletion path that a lapsed account cannot reach is
      a rejection, and it is the kind of thing that gets gated by accident when
      somebody wraps a screen in a subscription check.
    */
    for (const state of ['subscribed', 'lapsed', 'unsubscribed'] as const) {
      expect(`${state}: ${permits(state, 'delete-account')}`).toBe(`${state}: true`);
    }
  });

  it('leaves nothing to export or delete in the demo, rather than refusing it', () => {
    // A demo visitor has no account. "Sign in to export your data" offers
    // something that does not exist yet.
    expect(permits('demo', 'export')).toBe(false);
    expect(permits('demo', 'delete-account')).toBe(false);
  });
});

describe('⛔ recall alerts after a lapse — one boolean, one decision', () => {
  it('follows the instruction as given', () => {
    /*
      ⚠ This test is a record of a live question, not an endorsement of the
      answer. "Read only" says a recall refresh — a fetch, a write and a push
      nobody asked for — stops with everything else, and that is what ships.

      The argument for flipping it is `paid-features.ts`'s own, pointed at
      exactly this person: a federal defect notice an owner cannot see because
      their card expired. A lookup costs nothing — NHTSA is free, no model is
      involved, and the nightly sweep already runs.

      When David decides, `RECALL_ALERTS_AFTER_LAPSE` is the only line that
      moves, and this assertion is what fails to prove it moved.
    */
    expect(RECALL_ALERTS_AFTER_LAPSE).toBe(false);
    expect(permits('lapsed', 'recall-alerts')).toBe(RECALL_ALERTS_AFTER_LAPSE);
  });

  it('a subscriber gets them either way', () => {
    expect(permits('subscribed', 'recall-alerts')).toBe(true);
  });
});

describe('a refusal says what happened and what changes it', () => {
  it('says nothing when the thing is permitted', () => {
    expect(refusalCopy('subscribed', 'generate')).toBeNull();
  });

  it('tells a lapsed owner their records are still there', () => {
    /*
      The sentence that matters most in this file. Somebody whose subscription
      ended is deciding whether their two years of history is gone, and a
      refusal that does not answer that reads as one that took it.
    */
    const copy = refusalCopy('lapsed', 'write-own-records');

    expect(copy).toMatch(/records stay readable and exportable/i);
    expect(copy).toMatch(/renew/i);
  });

  it('never tells a demo visitor their subscription ended', () => {
    // The reason `lapsed` and `unsubscribed` are two states with one rule.
    for (const capability of ['generate', 'write-own-records'] as const) {
      expect(`${capability}: ${refusalCopy('demo', capability)}`).not.toMatch(
        /subscription has ended/i
      );
      expect(`${capability}: ${refusalCopy('unsubscribed', capability)}`).not.toMatch(
        /subscription has ended/i
      );
    }
  });

  it('tells a demo visitor that a sample answer is a sample', () => {
    /*
      ⚠ The honesty rule for demo mode, asserted where the copy lives. A canned
      answer presented as though a model had just read this car is the same
      defect as the fake scan sweep and the fake progress bar — three of which
      have been removed in the last week. It looks real; it says what it is.
    */
    expect(refusalCopy('demo', 'generate')).toMatch(/sample answer, written in advance/i);
  });

  it('every state and capability either permits or explains', () => {
    // Exhaustive, so a capability added without copy fails here rather than
    // rendering an empty refusal at a call site.
    const ALL: Capability[] = [
      'read-own-records',
      'write-own-records',
      'generate',
      'export',
      'delete-account',
      'recall-alerts',
    ];

    for (const state of STATES) {
      for (const capability of ALL) {
        const allowed = permits(state, capability);
        const copy = refusalCopy(state, capability);
        expect(`${state}/${capability}: ${allowed || (copy ?? '').length > 20}`).toBe(
          `${state}/${capability}: true`
        );
      }
    }
  });
});
