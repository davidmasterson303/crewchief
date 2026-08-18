/**
 * The way back goes both ways — v8 §6.
 *
 * @jest-environment jsdom
 *
 * Onboarding asks a single yes/no about modifications in the first sixty
 * seconds, and "not interested" hides an entire surface. The reversal is the
 * whole point, so the properties worth pinning are the ones that make it a
 * real reversal rather than a one-way door with a nice label:
 *
 *   · It turns the surface OFF as well as on. It was one-way until v8 —
 *     reversible exactly once, and only for someone who had never changed
 *     their mind before.
 *   · A refused write puts the UI back. An optimistic update that survives its
 *     own failure shows a surface that vanishes on the next load, which is
 *     worse than an error because nothing tells you it did not take.
 *   · It clears the 44px floor. RB0 rule 3 — this is a control, not a
 *     footnote, and the version it replaced was an 11px underline.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RegisterSwitch from '@/components/RegisterSwitch';
import { setModificationsVisible } from '@/app/actions';

jest.mock('@/app/actions', () => ({
  setModificationsVisible: jest.fn(),
}));

const errors: string[] = [];
jest.mock('sonner', () => ({
  toast: { error: (message: string) => errors.push(message) },
}));

const persist = setModificationsVisible as jest.MockedFunction<
  typeof setModificationsVisible
>;

beforeEach(() => {
  persist.mockReset();
  persist.mockResolvedValue({ success: true } as never);
  errors.length = 0;
});

function mount(visible: boolean) {
  const onApply = jest.fn();
  const view = render(
    <RegisterSwitch vehicleId="v1" visible={visible} onApply={onApply} />
  );
  return { onApply, view };
}

describe('the label', () => {
  it('offers to show the surface when it is hidden', () => {
    expect(mount(false).view.getByRole('button')).toHaveTextContent(
      'Show modifications'
    );
  });

  it('offers to hide it when it is shown', () => {
    /*
      The half that did not exist. `stock` is "not now", never "never" — and
      the label states the action rather than pitching it, symmetrically in
      both directions.
    */
    expect(mount(true).view.getByRole('button')).toHaveTextContent(
      'Hide modifications'
    );
  });
});

describe('turning the surface on', () => {
  it('persists the new value, not the old one', async () => {
    const user = userEvent.setup();
    mount(false);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(persist).toHaveBeenCalledWith('v1', true));
  });

  it('applies immediately rather than waiting for the round trip', async () => {
    /*
      A surface that waits for the server reads as the button not having
      worked, which is how somebody presses it twice.
    */
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    persist.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const { onApply } = mount(false);

    await user.click(screen.getByRole('button'));

    expect(onApply).toHaveBeenCalledWith(true);

    // Settle inside `act` so the trailing `setPending(false)` is flushed here
    // rather than escaping into the next test as an unwrapped update.
    await act(async () => resolve({ success: true }));
  });
});

describe('turning the surface off', () => {
  it('persists false — the direction that did not exist before v8', async () => {
    const user = userEvent.setup();
    mount(true);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(persist).toHaveBeenCalledWith('v1', false));
  });
});

describe('when the write is refused', () => {
  it('puts the UI back', async () => {
    /*
      The failure that matters. Leaving the optimistic state shows a surface
      that disappears on the next load, and a silent revert is worse than an
      error because nothing tells you it did not take.
    */
    const user = userEvent.setup();
    persist.mockResolvedValue({ success: false, error: 'nope' } as never);
    const { onApply } = mount(false);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(onApply).toHaveBeenLastCalledWith(false));
    expect(onApply).toHaveBeenNthCalledWith(1, true);
  });

  it('says so', async () => {
    const user = userEvent.setup();
    persist.mockResolvedValue({ success: false, error: 'nope' } as never);
    mount(false);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(errors).toContain('nope'));
  });

  it('does NOT put the UI back when the write succeeds', async () => {
    // The pair. Without it, "puts the UI back" is satisfied by a component
    // that reverts unconditionally — which would make the control do nothing.
    const user = userEvent.setup();
    const { onApply } = mount(false);

    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(persist).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(true);
  });
});

describe('while the write is in flight', () => {
  it('cannot be pressed twice', async () => {
    /*
      Two presses would send `true` then `false` for one intent, and the second
      write would win — leaving the surface in the state nobody asked for.
    */
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    persist.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    mount(false);

    const button = screen.getByRole('button');
    await user.click(button);
    await user.click(button);

    expect(persist).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ success: true }));
  });
});

describe('the target floor', () => {
  it('carries the class that clears 44px', () => {
    /*
      jsdom computes no layout, so the 44px itself is pinned in CSS and
      asserted there. What is checkable here is that the control opts into the
      class carrying it — the version this replaced was a bare `text-xs`
      underline with no floor at all.
    */
    expect(mount(false).view.getByRole('button')).toHaveClass('register-switch');
  });
});
