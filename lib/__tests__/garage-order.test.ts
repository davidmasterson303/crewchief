/**
 * The garage opens on the car that needs the owner.
 *
 * @jest-environment node
 *
 * Ordered by `created_at`, three cards carried identical weight and the page
 * said nothing about which car mattered — a database view rather than a
 * composition. A garage whose promise is "we watch this for you" should lead
 * with the one asking for something.
 */

import { byAttention } from '@wellkept/core/garage-order';

const car = (id: string, recalls: number, score: number | null) => ({
  id,
  nhtsa_data: { recalls: Array.from({ length: recalls }, (_, i) => i) },
  vehicle_health_summary: score === null ? null : { health_score: score },
});

const ids = (list: { id: string }[]) => list.map((v) => v.id);

describe('byAttention', () => {
  it('puts an open recall above everything else', () => {
    /*
      A federal defect notice outranks a health score, however bad the score.
      The 40 has real problems; the recall is somebody else telling us the car
      may be unsafe.
    */
    const ordered = byAttention([car('healthy', 0, 90), car('bad-score', 0, 40), car('recall', 1, 88)]);

    expect(ids(ordered)[0]).toBe('recall');
  });

  it('ranks more recalls above fewer', () => {
    expect(ids(byAttention([car('one', 1, 70), car('two', 2, 70)]))).toEqual(['two', 'one']);
  });

  it('falls back to the lowest score', () => {
    expect(ids(byAttention([car('b', 0, 74), car('a', 0, 61), car('c', 0, 88)]))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('sorts an unscored car as neutral, never as worst', () => {
    /*
      ⚠ The rule this codebase applies everywhere: `null` is "we have not
      assessed this", not zero. Floating an unassessed car to the top would
      claim it is the one in trouble on the strength of nobody having looked.
    */
    const ordered = byAttention([car('unscored', 0, null), car('poor', 0, 30), car('good', 0, 90)]);

    expect(ids(ordered)).toEqual(['poor', 'unscored', 'good']);
  });

  it('is stable when nothing distinguishes two cars', () => {
    // A garage where nothing is wrong must not reshuffle between renders.
    const input = [car('first', 0, 80), car('second', 0, 80), car('third', 0, 80)];
    expect(ids(byAttention(input))).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the array it was given', () => {
    const input = [car('b', 0, 40), car('a', 1, 90)];
    const before = ids(input);
    byAttention(input);
    expect(ids(input)).toEqual(before);
  });

  it('reads embeds in either shape', () => {
    // PostgREST sends an object for a to-one relation and an array for
    // to-many — the defect `firstEmbed` exists for.
    const asArray = {
      id: 'array-shaped',
      nhtsa_data: [{ recalls: [1] }],
      vehicle_health_summary: [{ health_score: 20 }],
    };
    expect(ids(byAttention([car('plain', 0, 90), asArray]))).toEqual(['array-shaped', 'plain']);
  });
});
