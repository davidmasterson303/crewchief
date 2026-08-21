/**
 * What the health report is allowed to claim.
 *
 * @jest-environment node
 *
 * Written after a live defect on the App Store reviewer's account: a 2003 Honda
 * Accord — inside the Takata airbag campaigns — showed a green tick and "No
 * active recalls" because its NHTSA record had never been fetched. Nothing
 * errored. The check had simply never run, and absence rendered as an
 * all-clear on a safety claim.
 */

import { healthClaim, mayReassure, type ClaimKind } from '@crewchief/core/health-claims';

const KINDS: ClaimKind[] = ['recall', 'maintenance', 'issues'];

describe('an unrun check is never good news', () => {
  it.each(KINDS)('does not reassure about %s when nothing was checked', (kind) => {
    /*
      ⚠ The assertion the defect would have failed. `mayReassure` gates the
      green ground and the tick, so this is the one that keeps a safety claim
      off a car nobody looked at.
    */
    const claim = healthClaim(kind, '', false);

    expect(claim.state).toBe('unknown');
    expect(mayReassure(claim)).toBe(false);
  });

  it.each([[''], ['   '], [null], [undefined], ['null']])(
    'treats %p as unchecked rather than clear',
    (status) => {
      // Every shape an absent status arrives in, including the literal 'null'
      // the old helper special-cased.
      expect(healthClaim('recall', status as string | null, false).state).toBe('unknown');
    }
  );

  it('says plainly that it is not a clear result', () => {
    /*
      The copy carries the load here. Somebody looking at a blank recall panel
      will infer "nothing found" unless told otherwise, so it is told
      otherwise, in the panel, rather than left to a banner elsewhere.
    */
    const text = healthClaim('recall', '', false).text;

    expect(text).toMatch(/not checked|have not checked/i);
    expect(text).toMatch(/not a clear result/i);
    // And it must not contain the sentence that caused this.
    expect(text.toLowerCase()).not.toContain('no active recalls');
  });
});

describe('a check that ran and found nothing is good news', () => {
  it.each(KINDS)('reassures about %s when checked and empty', (kind) => {
    // Anti-vacuous: if this failed, "never reassure" would pass trivially and
    // every clean vehicle would be told we had not looked.
    const claim = healthClaim(kind, '', true);

    expect(claim.state).toBe('clear');
    expect(mayReassure(claim)).toBe(true);
  });

  it('uses the reassuring wording only in that state', () => {
    expect(healthClaim('recall', '', true).text).toBe('No active recalls');
    expect(healthClaim('maintenance', '', true).text).toBe('No items due');
    expect(healthClaim('issues', '', true).text).toBe('No known issues');
  });
});

describe('a written finding is always shown', () => {
  it('reports what was found rather than the flag', () => {
    /*
      Deliberately independent of `checked`. Something produced that sentence,
      and suppressing a real finding because a flag disagreed is the failure in
      the dangerous direction.
    */
    for (const checked of [true, false]) {
      const claim = healthClaim('recall', 'Takata airbag inflator — do not drive', checked);
      expect(claim.state).toBe('attention');
      expect(mayReassure(claim)).toBe(false);
      expect(claim.text).toContain('Takata');
    }
  });

  it('trims, so whitespace is not mistaken for a finding', () => {
    expect(healthClaim('issues', '  \n ', true).state).toBe('clear');
  });
});

describe('the three states stay three', () => {
  it('never returns empty text in any state', () => {
    // A blank panel is the thing a reader fills in with their own optimism.
    for (const kind of KINDS) {
      for (const checked of [true, false]) {
        expect(healthClaim(kind, '', checked).text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('reassures in exactly one of the three states', () => {
    const states = new Set(
      [
        healthClaim('recall', '', true),
        healthClaim('recall', '', false),
        healthClaim('recall', 'something', true),
      ].map((c) => `${c.state}:${mayReassure(c)}`)
    );

    expect(Array.from(states).sort()).toEqual(['attention:false', 'clear:true', 'unknown:false']);
  });
});
