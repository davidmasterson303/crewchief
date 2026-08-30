/**
 * Turning a car's research into things you could put on a list.
 *
 * @jest-environment node
 *
 * The fixtures are trimmed copies of a **live** `vehicle_knowledge_base` row,
 * read on 23 Aug 2026 — not invented shapes. That matters more than usual here
 * because all three sources are `jsonb` written by a model, so the only real
 * check on their shape is what is actually stored.
 */

import {
  filterSuggestions,
  learnMoreQuestion,
  suggestionsFor,
} from '@wellkept/core/wishlist-suggestions';
import { wishlistItemIdentifier } from '@wellkept/core/wishlist-identifier';

/** The Accord's row, trimmed. Field names as PostgREST returns them. */
const KNOWLEDGE = {
  known_issues: [
    {
      part: '10th Gen CVT Transmission',
      severity: 'Medium',
      description: 'CVT fluid degradation leads to hesitation and hunting.',
      mileage_range: '80,000-120,000 mi',
    },
    { part: 'Fuel injector seals', severity: 'High', description: 'Seals harden and weep.' },
  ],
  maintenance_schedule: [
    {
      service: 'Engine Oil (0W-20 Full Synthetic)',
      priority: 'Critical',
      description: 'Lubricates the turbo engine.',
      interval_miles: 5000,
      interval_months: null,
    },
    { service: 'Brake fluid', priority: 'Normal', description: 'Absorbs water.', interval_months: 36 },
  ],
  common_mods: [
    { name: 'K&N Drop-in Air Filter', purpose: 'Modest airflow improvement.', difficulty: 'Easy' },
  ],
};

describe('reading the three sources', () => {
  const all = suggestionsFor(KNOWLEDGE);

  it('maps each source onto the wishlist type it belongs to', () => {
    /*
      The good sign that this was always the intended shape: `wishlist_items`
      accepts exactly `issue | maintenance | modification`, and the knowledge
      base holds exactly three lists. Nothing had to be invented to make them
      fit.
    */
    const byName = new Map(all.map((s) => [s.name, s]));

    expect(byName.get('Fuel injector seals')?.type).toBe('issue');
    expect(byName.get('Brake fluid')?.type).toBe('maintenance');
    expect(byName.get('K&N Drop-in Air Filter')?.type).toBe('modification');
    expect(all).toHaveLength(5);
  });

  it('uses the shared identifier so nothing builds a fourth spelling', () => {
    // `wishlist-identifier.ts` exists because three call sites once built this
    // three ways: duplicate rows, a lying "already added", and silent deletes.
    const filter = all.find((s) => s.name === 'K&N Drop-in Air Filter')!;
    expect(filter.identifier).toBe(
      wishlistItemIdentifier('modification', 'K&N Drop-in Air Filter')
    );
  });

  it('colours only what the research called urgent', () => {
    /*
      ⚠ The spec's rule, and the reason it matters: "priority chips are neutral
      unless the item is genuinely urgent." Exactly two things can raise a chip
      — a High severity and a Critical priority — and both are values research
      wrote rather than judgements made here.
    */
    const urgent = all.filter((s) => s.urgent).map((s) => s.name);
    expect(urgent.sort()).toEqual(['Engine Oil (0W-20 Full Synthetic)', 'Fuel injector seals']);

    // Anti-vacuous: the rest exist and are deliberately not urgent.
    expect(all.filter((s) => !s.urgent)).toHaveLength(3);
  });

  it('never marks a modification urgent, whatever it says about itself', () => {
    // Nothing an owner chooses to add is overdue. An amber chip on an intake
    // beside one on a failing rod bearing is how amber stops meaning anything.
    const loud = suggestionsFor({
      common_mods: [{ name: 'Turbo', purpose: 'Critical high severity urgent', difficulty: 'Hard' }],
    });

    expect(loud[0].urgent).toBe(false);
    expect(loud[0].chip).toBe('Modification');
  });

  it('orders urgent first, then by how much it can hurt you', () => {
    // Not grouped by type: grouping would file a critical service below a
    // cosmetic mod whenever the alphabet said so.
    const names = all.map((s) => s.name);
    expect(names.indexOf('Fuel injector seals')).toBeLessThan(names.indexOf('10th Gen CVT Transmission'));
    expect(names.indexOf('Engine Oil (0W-20 Full Synthetic)')).toBeLessThan(names.indexOf('Brake fluid'));
    expect(names.indexOf('Brake fluid')).toBeLessThan(names.indexOf('K&N Drop-in Air Filter'));
  });

  it('always has a reason, because a bare part name is a catalogue', () => {
    for (const suggestion of all) expect(suggestion.reason.length).toBeGreaterThan(0);

    // And a row whose description is missing still gets one.
    const bare = suggestionsFor({ known_issues: [{ part: 'Something', severity: 'Low' }] });
    expect(bare[0].reason.length).toBeGreaterThan(0);
  });

  it('writes the interval as a person would say it', () => {
    const byName = new Map(all.map((s) => [s.name, s]));
    expect(byName.get('Engine Oil (0W-20 Full Synthetic)')?.note).toBe('Every 5,000 mi');
    expect(byName.get('Brake fluid')?.note).toBe('Every 36 months');
    expect(byName.get('10th Gen CVT Transmission')?.note).toBe('Typically 80,000-120,000 mi');
  });

  it('survives every shape a jsonb column can actually hold', () => {
    // ⚠ Written by a model into `jsonb`, so none of it is guaranteed. A crash
    // here is a blank screen on the one surface that exists to suggest things.
    expect(suggestionsFor(null)).toEqual([]);
    expect(suggestionsFor({})).toEqual([]);
    expect(suggestionsFor({ known_issues: 'nope', common_mods: 42 })).toEqual([]);
    expect(suggestionsFor({ common_mods: [{ purpose: 'no name' }, null, 7] })).toEqual([]);
  });
});

describe('the typeahead', () => {
  const all = suggestionsFor(KNOWLEDGE);

  it('returns everything for an empty query', () => {
    expect(filterSuggestions('', all)).toHaveLength(all.length);
    expect(filterSuggestions('   ', all)).toHaveLength(all.length);
  });

  it('matches the reason, not only the name', () => {
    /*
      Somebody searching "hesitation" should find "10th Gen CVT Transmission".
      A name-only filter looks broken to everyone who does not already know the
      part's formal title — which is most people, and the whole audience for a
      suggestion list.
    */
    const hit = filterSuggestions('hesitation', all);
    expect(hit.map((s) => s.name)).toEqual(['10th Gen CVT Transmission']);
  });

  it('requires every term, in any field and any order', () => {
    expect(filterSuggestions('fluid brake', all).map((s) => s.name)).toEqual(['Brake fluid']);
    expect(filterSuggestions('brake turbo', all)).toEqual([]);
  });

  it('does not strip punctuation, so "k&n" finds K&N', () => {
    // ⚠ `catalogKey`'s punctuation-collapsing is deliberately not reused here:
    // this is prose, and folding "K&N" to "kn" would stop it matching itself.
    expect(filterSuggestions('k&n', all).map((s) => s.name)).toEqual(['K&N Drop-in Air Filter']);
  });

  it('is case-insensitive both ways', () => {
    expect(filterSuggestions('ENGINE OIL', all)).toHaveLength(1);
  });
});

describe('learn more', () => {
  it('names the car and quotes the finding', () => {
    // The advisor takes the vehicle record in context; a bare part name makes
    // it guess which car and which symptom.
    const [first] = suggestionsFor(KNOWLEDGE);
    const question = learnMoreQuestion(first, '2018 Honda Accord');

    expect(question).toContain('Fuel injector seals');
    expect(question).toContain('2018 Honda Accord');
    expect(question).toContain('Seals harden and weep.');
  });
});
