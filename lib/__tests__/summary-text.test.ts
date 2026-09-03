/**
 * A card shows a whole sentence or nothing — never a fragment.
 *
 * @jest-environment node
 *
 * The garage card ran model-written summaries under `line-clamp-2`, which cuts
 * at whatever character the line box ends on. Cards finished mid-clause, and
 * where the cut landed beside the text's own full stop it rendered as a run of
 * dots — on a product whose pitch is "every invoice read".
 */

import { firstSentence } from '@wellkept/core/summary-text';

describe('firstSentence', () => {
  it('takes the lead sentence whole', () => {
    expect(
      firstSentence(
        'Solid daily driver at 94k miles. No major issues but approaching several key service intervals.'
      )
    ).toBe('Solid daily driver at 94k miles.');
  });

  it('does not end on a decimal or a trim designation', () => {
    /*
      ⚠ The reason the pattern requires whitespace after the terminator. "1.5T"
      and "2.0 litre" both carry a full stop mid-token, and a naive split on
      '.' would cut the sentence at the engine size — which is exactly the
      fragment this function exists to prevent.
    */
    expect(firstSentence('The 1.5T engine dilutes oil in short trips. Watch it.')).toBe(
      'The 1.5T engine dilutes oil in short trips.'
    );
  });

  it('keeps a question or an exclamation as the boundary', () => {
    expect(firstSentence('Is the CVT fluid overdue? Almost certainly.')).toBe(
      'Is the CVT fluid overdue?'
    );
  });

  it('returns the whole string when there is no terminator', () => {
    // Rather than guessing a cut. Inventing a boundary is how a fragment gets
    // back in.
    expect(firstSentence('Rod bearing health is the single biggest concern')).toBe(
      'Rod bearing health is the single biggest concern'
    );
  });

  it('answers null for nothing, so a caller renders no element', () => {
    expect(firstSentence(null)).toBeNull();
    expect(firstSentence(undefined)).toBeNull();
    expect(firstSentence('   ')).toBeNull();
  });

  it('never returns text ending mid-word', () => {
    /*
      The anti-vacuous case: whatever comes back has to be something a reader
      can finish. A fragment always ends on a word character with more text
      following it in the source.
    */
    const source =
      'High-mileage M3 entering the zone where proactive maintenance separates a healthy car from a costly one. Budget accordingly.';
    const result = firstSentence(source)!;

    expect(result.endsWith('.')).toBe(true);
    expect(source.startsWith(result)).toBe(true);
  });
});
