/**
 * Marking a wishlist item done — the only wishlist action that writes history.
 *
 * @jest-environment node
 *
 * `POST /api/v1/wishlist/complete` inserts a `maintenance_line_items` row and
 * deletes the wishlist entry. There is no undo, and that row is what the
 * advisor, the health score and the service schedule all read afterwards.
 *
 * The route is deliberately forgiving — missing shop becomes `'Unknown'`,
 * missing costs become `0`, missing date becomes today. **Forgiving is right for
 * a route and wrong for a form.** Submitted empty it writes something that looks
 * like a maintenance record and carries nothing, which is the shape this repo
 * already named: a UI implying data it does not have.
 */

import {
  completionProblems,
  completionPayload,
  describeCompletion,
  emptyCompletion,
  parseCost,
  type CompletionDraft,
} from '@crewchief/core/wishlist-completion';

const TODAY = '2026-08-12';

function draft(overrides: Partial<CompletionDraft> = {}): CompletionDraft {
  return { ...emptyCompletion(TODAY), isDIY: true, ...overrides };
}

describe('completionProblems', () => {
  it('accepts the fastest honest completion — DIY, today, no costs', () => {
    /*
      The case the phone exists for. One tap on "I did it" and the record is
      already worth having: what, when, and by whom.
    */
    expect(completionProblems(draft(), TODAY)).toEqual([]);
  });

  it('requires a shop when the work was not DIY', () => {
    /*
      The one required field, and it is *who* rather than *how much*.

      Without it the route stores `'Unknown'`, which is its default and tells a
      reader nothing a year later — not even whether the job really happened.
    */
    const problems = completionProblems(draft({ isDIY: false, shopName: '' }), TODAY);
    expect(problems.map((p) => p.field)).toEqual(['shopName']);
  });

  it('accepts a named shop', () => {
    expect(completionProblems(draft({ isDIY: false, shopName: "Ken's Auto" }), TODAY)).toEqual([]);
  });

  it('does not require a cost', () => {
    /*
      Deliberate, and the opposite of what a form usually does. A cost is often
      genuinely unknown when the job finishes — the invoice comes later, the
      parts were bought over three weeks. Requiring it makes people type a
      guess, and **a guessed cost in permanent history is worse than an absent
      one**, because nothing downstream can tell the two apart.
    */
    expect(completionProblems(draft({ partsCost: '', laborCost: '' }), TODAY)).toEqual([]);
  });

  it('refuses a service date in the future', () => {
    /*
      Refused rather than clamped. The schedule reads these rows to work out
      when a service is next due, so a future date silently pushes the next
      interval out — the car looks freshly serviced and the reminder never
      fires. Clamping would hide a typo the person could have fixed.
    */
    const problems = completionProblems(draft({ serviceDate: '2026-09-01' }), TODAY);
    expect(problems.map((p) => p.field)).toEqual(['serviceDate']);
  });

  it('accepts today and the past', () => {
    expect(completionProblems(draft({ serviceDate: TODAY }), TODAY)).toEqual([]);
    expect(completionProblems(draft({ serviceDate: '2025-01-30' }), TODAY)).toEqual([]);
  });

  it('refuses an unparseable date', () => {
    expect(completionProblems(draft({ serviceDate: 'last tuesday' }), TODAY).map((p) => p.field))
      .toEqual(['serviceDate']);
  });

  it('refuses a cost that is not a number, but not a blank one', () => {
    expect(completionProblems(draft({ partsCost: 'about 200' }), TODAY).map((p) => p.field))
      .toEqual(['partsCost']);
    expect(completionProblems(draft({ laborCost: '-40' }), TODAY).map((p) => p.field))
      .toEqual(['laborCost']);
    expect(completionProblems(draft({ partsCost: '', laborCost: '0' }), TODAY)).toEqual([]);
  });

  it('reports every problem at once rather than one at a time', () => {
    // A form that reveals its objections one tap at a time is the thing people
    // abandon. All of them, first time.
    const problems = completionProblems(
      draft({ isDIY: false, shopName: '', serviceDate: '2027-01-01', partsCost: 'lots' }),
      TODAY
    );
    expect(problems.map((p) => p.field).sort()).toEqual(['partsCost', 'serviceDate', 'shopName']);
  });
});

describe('completionPayload', () => {
  it('omits a blank cost rather than sending zero', () => {
    /*
      The route reads `partsCost || 0`, so the stored column is `0` either way.
      The difference is what the code *says*: an explicit zero is a claim the
      job was free, and omission is "not recorded", which is true.
    */
    const payload = completionPayload('item-1', draft({ partsCost: '', laborCost: '' }));

    expect(payload).not.toHaveProperty('partsCost');
    expect(payload).not.toHaveProperty('laborCost');
  });

  it('sends a real zero when someone types one', () => {
    // "It cost nothing" is a fact worth keeping, and distinguishable from
    // silence only if a typed 0 survives.
    const payload = completionPayload('item-1', draft({ partsCost: '0' }));
    expect(payload.partsCost).toBe(0);
  });

  it('omits the shop for DIY so the route and the client cannot disagree', () => {
    /*
      The route sets `shop_name` to `'DIY'` itself when `isDIY` is true. Sending
      a name as well would create two writers for one column, and the loser
      would be whichever the route happened to read second.
    */
    const payload = completionPayload('item-1', draft({ isDIY: true, shopName: 'stale text' }));

    expect(payload.isDIY).toBe(true);
    expect(payload).not.toHaveProperty('shopName');
  });

  it('trims the shop name', () => {
    const payload = completionPayload('item-1', draft({ isDIY: false, shopName: '  Ken\'s Auto ' }));
    expect(payload.shopName).toBe("Ken's Auto");
  });

  it('sends a date-only service date', () => {
    // `maintenance_line_items.service_date` is a date column; a timestamp
    // would be coerced, and which day it lands on depends on the timezone.
    const payload = completionPayload('item-1', draft({ serviceDate: '2026-08-12T22:00:00Z' }));
    expect(payload.serviceDate).toBe('2026-08-12');
  });
});

describe('parseCost', () => {
  it('distinguishes blank from zero', () => {
    expect(parseCost('')).toBeUndefined();
    expect(parseCost('   ')).toBeUndefined();
    expect(parseCost('0')).toBe(0);
  });

  it('rejects nonsense and negatives rather than coercing them', () => {
    expect(parseCost('lots')).toBeUndefined();
    expect(parseCost('-5')).toBeUndefined();
  });
});

describe('describeCompletion', () => {
  /*
    The action is irreversible and its result lands somewhere the user is not
    looking — the service history, not this screen. Naming the destination is
    what makes "Done" an informed tap.
  */
  it('names the destination, not just the outcome', () => {
    const text = describeCompletion('Front brake pads', draft());
    expect(text.toLowerCase()).toContain('service history');
    expect(text.toLowerCase()).toContain('leaves the wishlist');
  });

  it('names who did the work', () => {
    expect(describeCompletion('Oil change', draft({ isDIY: true }))).toContain('you');
    expect(
      describeCompletion('Oil change', draft({ isDIY: false, shopName: "Ken's Auto" }))
    ).toContain("Ken's Auto");
  });

  it('mentions a cost only when there is one', () => {
    expect(describeCompletion('Oil change', draft())).not.toMatch(/\$/);
    expect(
      describeCompletion('Oil change', draft({ partsCost: '180', laborCost: '260' }))
    ).toContain('$440');
  });
});
