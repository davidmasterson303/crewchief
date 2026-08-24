import { render, userEvent } from '@testing-library/react-native';

import TabBar from '../TabBar';
import { withSafeArea } from '../../test-support/safe-area';

/**
 * The bar is how the app is navigated, and one of its three destinations is a
 * compliance requirement.
 *
 * ── What App Store 5.1.1(v) needs from this file ────────────────────────────
 *
 * Account deletion must be initiated from inside the app and must be genuinely
 * available. It used to be a text link in the garage header, guarded by five
 * cases in `GarageScreen.test.tsx` asserting that every one of that screen's
 * states still rendered it — a guarantee held together by vigilance, and one
 * that had already been lost when the loading and error states returned early.
 *
 * As a tab it cannot be lost that way: the bar is a sibling of the navigator,
 * not a child of any screen. What is left to check is that the control is
 * there, that it is named, and that it announces which position is current —
 * because a bar whose state is carried entirely by a tint is unusable to anyone
 * who cannot separate the two, and this bar is the app's navigation.
 */
describe('the tab bar', () => {
  it('offers all three destinations, by name', async () => {
    const view = await render(withSafeArea(<TabBar current="Garage" onSelect={jest.fn()} />));

    for (const label of ['Garage', 'Advisor', 'Account']) {
      expect(view.getByLabelText(label)).toBeTruthy();
    }
  });

  it('announces which one is current, not only tints it', async () => {
    const view = await render(withSafeArea(<TabBar current="Advisor" onSelect={jest.fn()} />));

    expect(view.getByLabelText('Advisor').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(view.getByLabelText('Garage').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('reports the tab that was pressed', async () => {
    const onSelect = jest.fn();
    const view = await render(withSafeArea(<TabBar current="Garage" onSelect={onSelect} />));

    await userEvent.press(view.getByLabelText('Account'));
    expect(onSelect).toHaveBeenCalledWith('Account');
  });

  it('is reachable from every position, including its own', async () => {
    /*
      The anti-vacuous half of the compliance claim: a bar that hid the current
      tab's own control would pass both cases above and would strand somebody on
      the account screen — which is the screen a departing user is on.
    */
    const view = await render(withSafeArea(<TabBar current="Account" onSelect={jest.fn()} />));

    expect(view.getByLabelText('Account')).toBeTruthy();
    expect(view.getByLabelText('Garage')).toBeTruthy();
  });
});
