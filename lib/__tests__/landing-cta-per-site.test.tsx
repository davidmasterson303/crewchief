/**
 * The two hostnames ask a visitor for different things.
 *
 * ── Why this is a decision worth a test ─────────────────────────────────────
 *
 * Until 22 Aug both sites led with "Enter demo". On the recruiter host that is
 * right — somebody sent to look at David's work should land in the working
 * product in one tap. On `crewchief.davidmasterson.co`, which is the App Store
 * listing's URL and the origin the phone talks to, it said "this is a demo"
 * more loudly than any tagline could. **The primary call to action is the
 * positioning**, more than the copy above it is.
 *
 * ⚠ The failure this pins is silent and directional. If the site flag stops
 * reaching the client — a provider removed, a prop dropped, a refactor to a
 * hostname check that returns nothing during hydration — the page still
 * renders, still looks finished, and quietly shows one site's framing on the
 * other. The default is `false`/product for that reason, and the assertions
 * below check both directions rather than just the new one.
 */

import { render, screen } from '@testing-library/react';
import LandingHero from '@/components/LandingHero';
import { SiteRoleProvider } from '@/components/SiteRoleProvider';

jest.mock('@/components/AppStoreCTA', () => ({
  AppStoreCTA: () => <a href="/app">App Store</a>,
}));
jest.mock('@/components/FeaturesDrawer', () => ({
  __esModule: true,
  default: () => null,
}));

function renderHero({ isDemo }: { isDemo: boolean }) {
  const onEnter = jest.fn();
  render(
    <SiteRoleProvider isDemo={isDemo}>
      <LandingHero onEnter={onEnter} />
    </SiteRoleProvider>
  );
  return onEnter;
}

describe('the product host asks you to use the product', () => {
  it('leads with "Add your vehicle", pointing at signup', () => {
    renderHero({ isDemo: false });

    const primary = screen.getByRole('link', { name: /add your vehicle/i });
    expect(primary).toHaveAttribute('href', '/signup');
  });

  it('does not call itself a demo', () => {
    /*
      ⚠ The assertion the old page would have failed. This is the page Apple's
      reviewer reaches from the App Store listing.
    */
    renderHero({ isDemo: false });

    expect(screen.queryByRole('button', { name: /enter demo/i })).not.toBeInTheDocument();
  });

  it('still offers the demo, demoted rather than removed', () => {
    /*
      Anti-vacuous, and a real product point: dropping it would leave the page
      asking for a commitment with nothing to show first. Same action as the
      recruiter host's primary — it opens the door — worded as what it is
      rather than as a mode you enter.
    */
    const onEnter = renderHero({ isDemo: false });

    const secondary = screen.getByRole('button', { name: /see a sample garage/i });
    secondary.click();

    expect(onEnter).toHaveBeenCalled();
  });
});

describe('the recruiter host is unchanged', () => {
  it('still leads with "Enter demo"', () => {
    renderHero({ isDemo: true });

    expect(screen.getByRole('button', { name: /enter demo/i })).toBeInTheDocument();
  });

  it('does not ask a recruiter to sign up', () => {
    // Asking the wrong person for the wrong thing. They were sent to look.
    renderHero({ isDemo: true });

    expect(screen.queryByRole('link', { name: /add your vehicle/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /see a sample garage/i })).not.toBeInTheDocument();
  });
});

describe('both hosts keep the way back in', () => {
  it.each([[true], [false]])('offers sign in when isDemo is %p', (isDemo) => {
    /*
      Neither change may strand an existing web user. `/signup` and `/login`
      are the only route a web account has to the companion app.
    */
    renderHero({ isDemo });

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});

describe('the default direction, if the flag never arrives', () => {
  it('falls back to the product framing rather than the demo one', () => {
    /*
      ⚠ Rendered with **no provider at all**, which is what a dropped prop or a
      removed provider actually looks like. Unset means product — the same
      direction `lib/site-role.ts` takes, and for the same reason: the failure
      it prevents is demo framing on the App Store listing's URL, which has
      already happened once with the masthead. The opposite default fails
      toward "the product looks like a toy on the page Apple reads".
    */
    const onEnter = jest.fn();
    render(<LandingHero onEnter={onEnter} />);

    expect(screen.getByRole('link', { name: /add your vehicle/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enter demo/i })).not.toBeInTheDocument();
  });
});
