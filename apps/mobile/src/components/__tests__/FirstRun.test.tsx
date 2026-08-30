import { render, userEvent } from '@testing-library/react-native';

import { verdictTermsIn } from '@wellkept/core/advice-range';

import FirstRun from '../FirstRun';

/**
 * The opening explanation, and the claims it is allowed to make.
 *
 * ── Why the copy is under test at all ───────────────────────────────────────
 *
 * Normally it should not be — a test that restates a string proves nothing and
 * fails on every edit. This screen is the exception, and the reason is that its
 * claims are **unfalsifiable at the moment they are read**: the person seeing
 * them has no car in the product yet, so there is nothing for them to check the
 * promises against. Every other surface is disciplined by the data next to it.
 *
 * So what is pinned here is not the wording. It is the boundary between what
 * this product does and what it does not, on the one screen where crossing it
 * is invisible.
 */

describe('the promises it makes', () => {
  it('offers the one action there is', async () => {
    const onAddVehicle = jest.fn();
    const view = await render(<FirstRun onAddVehicle={onAddVehicle} />);

    await userEvent.setup().press(view.getByText('Add your first car'));

    expect(onAddVehicle).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('does not claim recalls are matched to the car', async () => {
    /*
      ⚠ The assertion this file exists for.

      `lib/vehicle-research.ts` fetches from
      `recallsByVehicle?make=…&model=…&modelYear=…`. The match is at **model
      level**, so "checked against your VIN" is the more impressive sentence and
      a false one — false in the direction that matters, telling an owner their
      particular car is clear when only its model was looked at.

      A VIN is collectable and the endpoint exists, so someone will reasonably
      add one later. This is here so the copy has to move at the same time.
    */
    const view = await render(<FirstRun onAddVehicle={jest.fn()} />);

    expect(view.queryByText(/VIN/i)).toBeNull();
    expect(view.getByText(/year, make and model/)).toBeTruthy();
    await view.unmount();
  });

  it('sets the expectation that costs are ranges, before any cost is shown', async () => {
    /*
      `advice-range.ts` holds this posture for every advice surface. This screen
      is where the expectation gets set: somebody told "what the work should
      cost" will read a single number as a promise of one, and one sentence here
      is cheaper than the product being wrong later.
    */
    const view = await render(<FirstRun onAddVehicle={jest.fn()} />);

    expect(view.getByText(/Costs come as ranges/)).toBeTruthy();
    await view.unmount();
  });

  it('never promises a verdict on what a shop charges', async () => {
    /*
      Run through the product's **own** guard rather than a hand-copied list of
      words. `verdictTermsIn` is what `cc-design-0003` is enforced with
      everywhere else, and a second copy of the terms here would be the one that
      drifts — the failure the rule itself warns about.

      Hand-written copy is exactly what it was built for: its docblock says the
      risk is someone adding "that looks like too much" to a template because it
      reads better, with no diff that looks like a policy change.
    */
    const view = await render(<FirstRun onAddVehicle={jest.fn()} />);

    const rendered = renderedText(view.toJSON());

    // Proves the walker actually reached the copy. A `verdictTermsIn('')` is
    // clean for the wrong reason, and would stay clean whatever anyone wrote.
    expect(rendered).toContain('Start with one car');
    expect(rendered).toContain('Costs come as ranges');

    expect(verdictTermsIn(rendered)).toEqual([]);

    await view.unmount();
  });
});

/** Every string the screen actually draws, flattened. */
function renderedText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  if (node && typeof node === 'object' && 'children' in node) {
    return renderedText((node as { children: unknown }).children);
  }
  return '';
}
