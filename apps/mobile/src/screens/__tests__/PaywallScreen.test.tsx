/**
 * The screen where somebody spends money.
 *
 * Two classes of failure are worth the whole file. One is telling a customer
 * something the app does not know — that they are subscribed, or that a
 * completed payment failed. The other is a compliance miss that App Review
 * catches instead of us: guideline 3.1.2 wants the renewal terms and both legal
 * links in the binary, and a restore path to exist.
 *
 * The purchase *decisions* are tested in `purchase-flow.test.ts`. What is
 * tested here is that the screen renders the resolver's answer and never
 * substitutes its own.
 */

import { render, screen, userEvent, waitFor } from '@testing-library/react-native';

import PaywallScreen, { type SubscriptionOption } from '../PaywallScreen';
import type { PurchaseResolution } from '@crewchief/core/purchase-flow';

const OPTIONS: SubscriptionOption[] = [
  { productId: 'co.davidmasterson.crewchief.paid.monthly', displayPrice: '£7.99', period: 'month' },
  { productId: 'co.davidmasterson.crewchief.paid.annual', displayPrice: '£69.99', period: 'year' },
];

const ENTITLED: PurchaseResolution = {
  status: 'entitled',
  grantsAccess: true,
  message: 'Your subscription is active.',
  offerRestore: false,
};

async function setup(props: Partial<React.ComponentProps<typeof PaywallScreen>> = {}) {
  const onPurchase = jest.fn(async () => ENTITLED);
  const onRestore = jest.fn(async () => ENTITLED);
  const onClose = jest.fn();

  await render(
    <PaywallScreen
      visible
      options={OPTIONS}
      onPurchase={onPurchase}
      onRestore={onRestore}
      onClose={onClose}
      {...props}
    />
  );

  return { onPurchase, onRestore, onClose };
}

describe('prices are Apple’s, verbatim', () => {
  it('renders the storefront price string as given', async () => {
    /*
      StoreKit returns a price already formatted for the customer's storefront.
      Formatting a number here would be wrong for most of the world and would
      disagree with Apple's own confirmation sheet a second later.
    */
    await setup();

    expect(screen.getByText('£7.99 / month')).toBeTruthy();
    expect(screen.getByText('£69.99 / year')).toBeTruthy();
  });

  it('computes no saving between the two, because it does not own the numbers', async () => {
    /*
      The two prices are set independently per storefront in App Store Connect,
      so "save 27%" calculated on the device is a claim about numbers we do not
      control — and `advice-range.ts` is the standing argument against exactly
      that kind of invented precision.
    */
    await setup();

    expect(screen.queryByText(/save|%|best value|cheaper/i)).toBeNull();
  });
});

describe('it never decides anybody is entitled', () => {
  it('says nothing about a subscription until the resolver answers', async () => {
    await setup();

    expect(screen.queryByText(/your subscription is active/i)).toBeNull();
  });

  it('shows exactly what the resolver returned, and nothing it inferred', async () => {
    const waiting: PurchaseResolution = {
      status: 'waiting',
      grantsAccess: false,
      message: 'Your purchase went through. We are still setting up your subscription.',
      offerRestore: true,
    };
    const onPurchase = jest.fn(async () => waiting);
    await setup({ onPurchase });

    await userEvent.press(screen.getByText('£69.99 / year'));

    await waitFor(() => {
      expect(screen.getByText(/still setting up your subscription/i)).toBeTruthy();
    });
    // A successful StoreKit purchase is not an entitlement, and the screen
    // must not upgrade the message it was handed.
    expect(screen.queryByText(/your subscription is active/i)).toBeNull();
  });

  it('renders no message at all when the resolver returns none', async () => {
    /*
      Cancellation. The resolver returns `message: null` deliberately, and a
      screen that substituted "Purchase cancelled" would be arguing with a
      decision the customer just made.
    */
    const cancelled: PurchaseResolution = {
      status: 'declined',
      grantsAccess: false,
      message: null,
      offerRestore: false,
    };
    const onPurchase = jest.fn(async () => cancelled);
    await setup({ onPurchase });

    await userEvent.press(screen.getByText('£7.99 / month'));

    await waitFor(() => expect(onPurchase).toHaveBeenCalled());
    /*
      Asserted on the banner, not on the word "cancel" — which appears
      legitimately in the renewal terms above ("You can cancel any time").
      The first version of this matched that sentence and failed against a
      correct screen, which is the cheaper half of CLAUDE.md §5's warning about
      a guard that cries wolf.
    */
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears a previous answer before a second attempt', async () => {
    /*
      Leaving "your subscription is active" on screen while a retry runs is the
      most misleading thing this screen could do.
    */
    let resolve: (r: PurchaseResolution) => void = () => {};
    const onPurchase = jest
      .fn()
      .mockResolvedValueOnce(ENTITLED)
      .mockImplementationOnce(() => new Promise<PurchaseResolution>((r) => (resolve = r)));
    await setup({ onPurchase });

    await userEvent.press(screen.getByText('£7.99 / month'));
    await waitFor(() => expect(screen.getByText('Your subscription is active.')).toBeTruthy());

    await userEvent.press(screen.getByText('£7.99 / month'));
    await waitFor(() => expect(screen.queryByText('Your subscription is active.')).toBeNull());

    resolve(ENTITLED);
    await waitFor(() => expect(screen.getByText('Your subscription is active.')).toBeTruthy());
  });
});

describe('what App Review looks for', () => {
  it('states what renewal means and how to stop it', async () => {
    await setup();

    expect(screen.getByText(/renews automatically/i)).toBeTruthy();
    expect(screen.getByText(/at least 24 hours before it ends/i)).toBeTruthy();
    // The one that costs money to omit, and the same claim the terms page makes.
    expect(screen.getByText(/deleting your CrewChief account does not stop the billing/i)).toBeTruthy();
  });

  it('carries both legal links in the binary', async () => {
    // 3.1.2 wants them reachable from inside the app, not only on the website.
    await setup();

    expect(screen.getByLabelText('Terms of Use, opens in your browser')).toBeTruthy();
    expect(screen.getByLabelText('Privacy Policy, opens in your browser')).toBeTruthy();
  });

  it('offers a restore path', async () => {
    /*
      Required, and useful for the same reason: a reinstall, a second device or
      a purchase made before signing in all need it, and a customer who cannot
      find it buys twice.
    */
    const { onRestore } = await setup();

    await userEvent.press(screen.getByText('Restore purchases'));

    await waitFor(() => expect(onRestore).toHaveBeenCalled());
  });
});

describe('states before anything can be bought', () => {
  it('names what it is waiting for rather than showing a bare spinner', async () => {
    await setup({ options: null });

    expect(screen.getByText(/loading prices from the app store/i)).toBeTruthy();
    expect(screen.queryByText('£7.99 / month')).toBeNull();
  });

  it('explains a failed load instead of showing an empty screen', async () => {
    await setup({ options: null, loadFailed: true });

    expect(screen.getByText(/could not reach the app store/i)).toBeTruthy();
  });

  it('says so when the Apple ID has nothing available', async () => {
    await setup({ options: [] });

    expect(screen.getByText(/nothing available to buy/i)).toBeTruthy();
  });
});

describe('one purchase at a time', () => {
  it('does not start a second purchase while one is running', async () => {
    let resolve: (r: PurchaseResolution) => void = () => {};
    const onPurchase = jest
      .fn()
      .mockImplementation(() => new Promise<PurchaseResolution>((r) => (resolve = r)));
    await setup({ onPurchase });

    await userEvent.press(screen.getByText('£7.99 / month'));
    await userEvent.press(screen.getByText('£69.99 / year'));

    expect(onPurchase).toHaveBeenCalledTimes(1);

    resolve(ENTITLED);
    await waitFor(() => expect(screen.getByText('Your subscription is active.')).toBeTruthy());
  });
});
