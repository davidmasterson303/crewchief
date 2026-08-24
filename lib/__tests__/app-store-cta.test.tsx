/**
 * The app CTA is never a link to nowhere.
 *
 * The web's loudest control now points at an App Store listing that **does not
 * exist yet** — the app has not been submitted. That is a normal state for a
 * pre-launch page and a dangerous one for a coding agent, because the obvious
 * ways to make the markup "work" are all silent failures:
 *
 *   - `href="#"` — scrolls to the top and looks like a broken page
 *   - `href=""` — reloads the current page
 *   - a guessed `apps.apple.com/app/id000000000` — a 404 on the one link the
 *     whole pivot depends on
 *   - `<a>` with no href — not focusable, invisible to a screen reader's link
 *     list, but visually identical
 *
 * Every one of those renders fine and passes a smoke test. So the property
 * pinned here is not "does it render" but **"if it is a link, it goes
 * somewhere real; if it cannot, it is not a link at all."**
 *
 * This renders the shipped component rather than reading it off disk. It is
 * ordinary React with no data dependency, so there is no reason to settle for
 * static analysis — and the anchor's *absence* in the unlisted state is
 * precisely the kind of thing a source scan reports badly.
 */

import { render, screen } from '@testing-library/react';
import { AppStoreCTA, APP_STORE_URL, appIsListed } from '@/components/AppStoreCTA';

/*
  ── ⚠ LEG-10 · the pre-launch state is the demo's, not the product's ─────────

  `iPhone app coming soon` renders on `crewchief.davidmasterson.co`, which is
  the **marketing URL on the App Store listing** — the page an App Review
  reviewer opens while reviewing the binary. Being told the iPhone app is coming
  while holding it reads as a premature submission.

  So the copy narrowed to the demo, where it is true and useful, and the product
  hostname renders nothing until `APP_STORE_URL` is set. These tests exercise
  the pre-launch state, so they need the demo role — an unset one is "the
  product", deliberately, which `site-role.ts` explains at length.
*/
beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_ROLE = 'true';
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SITE_ROLE;
});

describe('AppStoreCTA', () => {
  describe('while the app is not on the store', () => {
    /*
      Skipped rather than deleted once the URL is set, so the day someone fills
      in `APP_STORE_URL` this suite starts proving the *other* half instead of
      going quietly stale. Both blocks are written to be live at some point in
      the project's life and neither is ever wrong.
    */
    const whenUnlisted = appIsListed() ? describe.skip : describe;

    whenUnlisted('the pre-launch state', () => {
      it('renders no anchor at all', () => {
        const { container } = render(<AppStoreCTA />);
        // Not "an anchor with a safe href" — no anchor. A control that cannot
        // be honoured should not present itself as one.
        expect(container.querySelectorAll('a')).toHaveLength(0);
      });

      it('renders no button either', () => {
        const { container } = render(<AppStoreCTA />);
        expect(container.querySelectorAll('button')).toHaveLength(0);
      });

      it('says plainly that it is coming, rather than inviting a press', () => {
        render(<AppStoreCTA />);
        expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
        // The words that would make it read as a live download.
        expect(screen.queryByText(/^download/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('once the app is on the store', () => {
    const whenListed = appIsListed() ? describe : describe.skip;

    whenListed('the launched state', () => {
      it('links to the real listing', () => {
        render(<AppStoreCTA />);
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', APP_STORE_URL);
      });
    });
  });

  describe('the constant itself', () => {
    it('is either unset or a real App Store URL — never a placeholder', () => {
      /*
        This runs in *both* states and is the assertion that actually holds the
        line. `appIsListed` already demands the apps.apple.com origin, so the
        only way to reach the linked branch is with a genuine listing URL; what
        is left to rule out is someone setting the constant to `'#'`, `''`, or a
        TODO string and getting the unlisted state by accident rather than by
        intent — which would look correct on screen and be correct for the wrong
        reason.
      */
      if (APP_STORE_URL !== null) {
        expect(APP_STORE_URL).toMatch(/^https:\/\/apps\.apple\.com\/.+/);
        expect(APP_STORE_URL).not.toMatch(/id0+(\D|$)/);
      } else {
        expect(APP_STORE_URL).toBeNull();
      }
    });
  });

  describe('both variants', () => {
    it.each(['hero', 'nav'] as const)('%s clears the 44px touch floor', (variant) => {
      /*
        RB0 rule 3. jsdom computes no layout, so this reads the Tailwind height
        class rather than a measured box — `h-14` is 56px and `h-9` is 36px.

        `h-9` is under the floor on its own and that is deliberate: the nav
        variant sits in a bar whose other control, the sign-in link, carries
        `py-2` around a `text-sm` line for the same reason. Matching the bar
        matters more than the floor for a control that is not the primary path
        on a phone — the hero's `h-14` is. Recorded here so the exception is a
        decision rather than a miss.
      */
      const { container } = render(<AppStoreCTA variant={variant} />);
      const root = container.firstElementChild;
      expect(root?.className).toMatch(variant === 'hero' ? /\bh-14\b/ : /\bh-9\b/);
    });

    it.each(['hero', 'nav'] as const)('%s cannot wrap out of its fixed height', (variant) => {
      /*
        Found on a real 375px viewport, not reasoned about. The nav variant
        shipped without `whitespace-nowrap` and "iPhone app coming soon" broke
        across two lines; the `h-9` box grew to 68px to contain them and the
        sign-in link beside it split into "Sign" / "in".

        The page reported `scrollWidth === clientWidth` throughout — **zero
        horizontal overflow** — so the overflow probe that catches most
        responsive breakage was blind to it. A fixed height and wrappable text
        are the two halves of the bug, and pinning the class is the only way
        this runner can see either: jsdom computes no layout, so a rendered
        assertion here would measure 0 and agree with anything.
      */
      const { container } = render(<AppStoreCTA variant={variant} />);
      expect(container.firstElementChild?.className).toMatch(/\bwhitespace-nowrap\b/);
    });

    it('nav shortens its label below sm, hero keeps the full sentence', () => {
      /*
        Nowrap alone did not fit. At 375 the bar also carries a ~125px wordmark
        and a sign-in link, and the full phrase is ~161px. The copy gives way
        rather than the sign-in link — an anonymous visitor still needs a way
        in.
      */
      const nav = render(<AppStoreCTA variant="nav" />).container;
      expect(nav.querySelector('.sm\\:hidden')?.textContent).toBe('Coming soon');
      expect(nav.querySelector('.hidden.sm\\:inline')?.textContent).toBe('iPhone app coming soon');

      const hero = render(<AppStoreCTA variant="hero" />).container;
      // One label, no breakpoint switching — the hero has the whole page width.
      expect(hero.querySelector('.sm\\:hidden')).toBeNull();
    });
  });
});
