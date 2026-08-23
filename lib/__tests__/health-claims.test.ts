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

import {
  healthClaim,
  mayReassure,
  recallEvidenceForPrompt,
  type ClaimKind,
} from '@crewchief/core/health-claims';

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

describe('the narrative cannot claim what the tile refused', () => {
  /*
    ⚠ Found 22 Aug on a live run, one element over from the defect this file
    was written for. The tile said "We have not checked this vehicle for
    recalls yet… This is not a clear result." and the generated prose on the
    same screen said **"While there are no active recalls, key high-mileage
    services must be evaluated."**

    The tile had been fixed and the prompt had not, because the prompt held its
    own copy of the question: `nhtsa?.recalls?.length || 0`. A model handed
    "Active Recalls: 0" writes "there are no active recalls", correctly.
  */

  it('never states a count when nothing was checked', () => {
    const block = recallEvidenceForPrompt({ checked: false, count: 0 });

    // The zero is the whole bug. It must not reach the model in any form.
    expect(block).not.toMatch(/Active Recalls:/);
    expect(block).not.toMatch(/\b0\b/);
  });

  it('forbids the inference rather than merely omitting the number', () => {
    /*
      Omission is not enough and this is the assertion that says so. A model
      given no recall section fills the silence with the reassuring reading —
      the summary's whole job is to sound confident. The prohibition is the
      payload.
    */
    const block = recallEvidenceForPrompt({ checked: false, count: 0 });

    expect(block).toMatch(/NOT CHECKED/);
    expect(block).toMatch(/UNKNOWN — it is not zero/);
    expect(block).toMatch(/must NOT write that there are no recalls/i);
  });

  it('still reports a real check, including a clean one', () => {
    /*
      Anti-vacuous in the direction that matters. A rule that refused to state
      any recall information would pass every assertion above while making the
      summary useless — "we checked and found nothing" is a real answer and the
      owner is entitled to it.
    */
    const clean = recallEvidenceForPrompt({ checked: true, count: 0 });
    expect(clean).toMatch(/Active Recalls: 0/);
    expect(clean).toMatch(/none found/);

    const found = recallEvidenceForPrompt({
      checked: true,
      count: 24,
      headlines: ["Driver's air bag inflator may rupture"],
    });
    expect(found).toMatch(/Active Recalls: 24/);
    expect(found).toMatch(/inflator may rupture/);
  });

  it('agrees with the tile on the same evidence', () => {
    /*
      The two halves that drifted, pinned to one flag. Whatever `checked` says,
      the tile and the prompt must be making the same claim — that is the
      property whose absence produced a screen contradicting itself.
    */
    for (const checked of [true, false]) {
      const tileReassures = mayReassure(healthClaim('recall', '', checked));
      const promptAllowsAllClear = !/must NOT write/i.test(
        recallEvidenceForPrompt({ checked, count: 0 })
      );

      expect(`checked=${checked}:${tileReassures}`).toBe(
        `checked=${checked}:${promptAllowsAllClear}`
      );
    }
  });
});
