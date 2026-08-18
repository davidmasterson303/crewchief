import { render, userEvent } from '@testing-library/react-native';

import { MarkDoneSheet } from '../MarkDoneSheet';

/**
 * The sheet that writes permanent service history.
 *
 * ── Why this was worth writing before anything else touched the screen ──────
 *
 * It had **no behavioural tests at all**. `contrast.test.tsx` mounts it through
 * the wishlist and measures its colours, and that was the whole net — on the
 * one surface in this product that writes into a car's permanent history and
 * deletes the wishlist row, with no undo.
 *
 * That gap was load-bearing on 16 Aug: migrating this screen onto the primitive
 * set, I deliberately left two compound controls hand-rolled rather than
 * reshape a form I could not verify. These are what make the next change to it
 * a normal change.
 *
 * ── What is deliberately *not* covered here ─────────────────────────────────
 *
 * The validation rules themselves. `completionProblems` decides what is wrong
 * and `wishlist-completion.test.ts` owns that; re-asserting "a future date is
 * refused" here would test the same judgement twice and pin it to a screen it
 * does not belong to. These cover what the **screen** does with the answer:
 * when it shows a problem, what it refuses to send, and what it hands over.
 */

const PROPS = {
  visible: true,
  itemName: 'Front brake pads',
  /** Injected, because the sheet deliberately has no clock of its own. */
  today: '2026-08-16',
  saving: false,
  onCancel: jest.fn(),
  onConfirm: jest.fn(),
};

/**
 * ⚠ `render` is awaited, and the first version of this file did not.
 *
 * RNTL 14 made `render`, `fireEvent` and `userEvent` all async for React 19's
 * concurrent renderer. An un-awaited one leaves React's act scope open, which
 * stops every later render in the file from committing — `jest.setup.js` threw
 * on all nine of these within a second of the suite existing, which is exactly
 * what that guard was written for.
 */
async function mount(overrides: Partial<typeof PROPS> = {}) {
  const props = { ...PROPS, ...overrides, onCancel: jest.fn(), onConfirm: jest.fn() };
  return { props, view: await render(<MarkDoneSheet {...props} />) };
}

describe('problems are computed continuously and shown late', () => {
  it('says nothing is wrong before the first submit', async () => {
    /*
      A form that turns red while you are still typing the first field is
      telling you off for not having finished — and on a phone it does that
      while the keyboard covers half the screen. The draft opens invalid,
      because "who did the work" is required and empty.
    */
    const { view } = await mount();

    expect(await view.findByText('Front brake pads')).toBeTruthy();
    expect(view.queryByText('Say who did the work, or mark it as DIY.')).toBeNull();
  });

  it('shows them once, after a submit that could not go through', async () => {
    const { view, props } = await mount();

    await userEvent.setup().press(view.getByLabelText('Mark done'));

    expect(await view.findByText('Say who did the work, or mark it as DIY.')).toBeTruthy();
    // ⚠ The half that matters on a screen with no undo: nothing was sent.
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

describe('who did the work', () => {
  it('sends the draft once a shop is named', async () => {
    const { view, props } = await mount();
    const user = userEvent.setup();

    await user.type(view.getByLabelText('Shop'), 'Willow Run Auto');
    await user.press(view.getByLabelText('Mark done'));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onConfirm.mock.calls[0][0]).toMatchObject({
      shopName: 'Willow Run Auto',
      isDIY: false,
      serviceDate: '2026-08-16',
    });
  });

  it('takes DIY as an answer to the same question', async () => {
    /*
      "Who did the work" is the one required field, and marking it yourself is
      a complete answer to it — not a way of skipping it. So the shop field
      disappears rather than sitting there empty and invalid.
    */
    const { view, props } = await mount();
    const user = userEvent.setup();

    await user.press(view.getByLabelText('I did it'));

    expect(view.queryByLabelText('Shop')).toBeNull();

    await user.press(view.getByLabelText('Mark done'));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onConfirm.mock.calls[0][0]).toMatchObject({ isDIY: true });
  });
});

describe('the date', () => {
  it('opens on today, so the common case needs no input', async () => {
    const { view, props } = await mount();
    const user = userEvent.setup();

    await user.press(view.getByLabelText('I did it'));
    await user.press(view.getByLabelText('Mark done'));

    expect(props.onConfirm.mock.calls[0][0].serviceDate).toBe('2026-08-16');
  });

  it('refuses a future date rather than clamping it', async () => {
    /*
      The screen's job here is to *stop*, and the reason is in
      `wishlist-completion.ts`: the schedule reads these rows to work out when a
      service is next due, so a date in the future silently pushes the next
      interval out — the car looks freshly serviced and the reminder never
      fires. Clamping would hide a typo the person could have corrected.
    */
    const { view, props } = await mount();
    const user = userEvent.setup();

    await user.press(view.getByLabelText('I did it'));
    await user.clear(view.getByLabelText('Service date'));
    await user.type(view.getByLabelText('Service date'), '2027-01-01');
    await user.press(view.getByLabelText('Mark done'));

    expect(await view.findByText('That date has not happened yet.')).toBeTruthy();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

describe('while it is saving', () => {
  it('blocks a second submit, because there is no undo for the first', async () => {
    const { view, props } = await mount({ saving: true });

    await userEvent.setup().press(view.getByLabelText('Mark done'));

    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('keeps its accessible name while it works', async () => {
    /*
      The visible label changes to "Saving…", so a control named by its `<Text>`
      child would go anonymous at exactly the moment it has something to say.
      This one is named explicitly for that reason.
    */
    const { view } = await mount({ saving: true });

    const control = view.getByLabelText('Mark done');
    expect(control.props.accessibilityState).toMatchObject({ disabled: true });
    expect(view.getByText('Saving…')).toBeTruthy();
  });
});

describe('backing out', () => {
  it('cancels without sending anything', async () => {
    const { view, props } = await mount();

    /*
      Queried by text, not by label. This control has no `accessibilityLabel`
      and does not need one — unlike "Mark done", its `<Text>` child is never
      swapped for a spinner, so the child *is* the accessible name and stays
      that way.
    */
    await userEvent.setup().press(view.getByText('Cancel'));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
