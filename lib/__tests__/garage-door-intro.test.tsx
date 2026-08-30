/**
 * The intro survives a double-mounted effect.
 *
 * Written after David reported the door not firing on localhost, against a
 * server that was demonstrably sending the right markup, the right pre-paint
 * script and the right compiled CSS. Reduced motion was off. The gate was
 * skipping for a reason none of the unit tests could see, because they tested
 * the policy and the bug was in the glue.
 *
 * React Strict Mode — **on by default for the App Router**, so every dev load —
 * mounts, runs effects, tears them down, and mounts again. The first pass wrote
 * the "already played" flag to session storage. The second pass read it back,
 * concluded the intro had already run, and removed the curtain. In development
 * the door could therefore never appear, and the failure was invisible in
 * production-shaped reasoning: the policy was right, the markup was right, and
 * the component ate itself.
 *
 * The lesson generalises past this component: an effect that *writes* the state
 * it *reads* is not idempotent, and Strict Mode exists precisely to surface
 * that. So this suite renders the real component inside `<StrictMode>` rather
 * than trusting a single mount.
 */

import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import GarageDoor from '@/components/GarageDoor';
import { INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE } from '@wellkept/core/intro-gate';

function renderDoor(strict: boolean) {
  const tree = (
    <GarageDoor
      panel={(enter) => (
        <button type="button" onClick={enter}>
          Enter Garage
        </button>
      )}
    >
      <main>the page</main>
    </GarageDoor>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** The curtain carries no role, so it is found by its class. */
function curtain(container: HTMLElement) {
  return container.querySelector('.garage-door');
}

beforeEach(() => {
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-intro');
});

describe('a first load in a visible tab', () => {
  it('shows the curtain when mounted once', () => {
    const { container } = renderDoor(false);
    expect(curtain(container)).not.toBeNull();
  });

  it('still shows the curtain under Strict Mode', () => {
    // The regression. Before the fix this rendered nothing: pass one burned the
    // session flag, pass two read it and skipped.
    const { container } = renderDoor(true);
    expect(curtain(container)).not.toBeNull();
  });

  it('renders the page underneath exactly once', () => {
    // The other half of the old design's failure — GarageDoorLayer put
    // `children` in both branches and mounted the page twice for 1.5s.
    const { container } = renderDoor(true);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('renders the panel on the door', () => {
    renderDoor(true);
    expect(screen.getByRole('button', { name: 'Enter Garage' })).toBeInTheDocument();
  });

  it('records that the intro has played, so a reload does not repeat it', () => {
    renderDoor(true);
    expect(sessionStorage.getItem(INTRO_PLAYED_KEY)).toBe(INTRO_PLAYED_VALUE);
  });
});

describe('navigating within the same document', () => {
  /*
    The bug behind "the demo link doesn't work".

    The pre-paint script in app/layout.tsx sets `data-intro` once per *document
    load*. `next/link` navigates on the client and never re-runs it, so the
    attribute still reads "play" long after the intro has been and gone. When
    the component preferred that attribute over session storage, every
    client-side navigation to a door-bearing route mounted a fresh curtain —
    pressing "Take a Test Drive" put you in front of a second closed garage
    door, which is indistinguishable from a dead link.

    Simulated exactly: play the intro, unmount as a navigation would, then mount
    again with the attribute left as the script wrote it.
  */
  it('does not show the curtain again after the intro has played', () => {
    document.documentElement.setAttribute('data-intro', 'play');

    const first = renderDoor(true);
    expect(curtain(first.container)).not.toBeNull();
    first.unmount();

    // The attribute is deliberately left alone — that is the whole point.
    expect(document.documentElement.getAttribute('data-intro')).toBe('play');

    const second = renderDoor(true);
    expect(curtain(second.container)).toBeNull();
  });

  it('still renders the page it navigated to', () => {
    document.documentElement.setAttribute('data-intro', 'play');
    renderDoor(true).unmount();

    const { container } = renderDoor(true);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});

describe('the door waits to be opened', () => {
  /*
    It used to open on a timer, which made the button on it ornamental — you
    watched a thing happen instead of doing it. A garage door opens because
    someone pressed the opener.

    Fake timers here rather than a real wait, so "nothing happens" is asserted
    against a clock that has genuinely moved rather than one that has not had
    time to.
  */
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not open on its own, however long it is left', () => {
    const { container } = renderDoor(true);

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(curtain(container)).not.toBeNull();
    expect(curtain(container)!.className).not.toContain('is-lifting');
  });

  it('opens when the opener on the panel is pressed', () => {
    const { container } = renderDoor(true);

    fireEvent.click(screen.getByRole('button', { name: 'Enter Garage' }));

    expect(curtain(container)!.className).toContain('is-lifting');
  });

  it('tears the curtain down if the animation never reports finishing', () => {
    /*
      `animationend` is the normal signal and cannot be the only one — a hidden
      tab or an interrupted animation never fires it, and the predecessor was
      found frozen mid-lift, parked over the page. jsdom runs no animations at
      all, so this is exactly that case.
    */
    const { container } = renderDoor(true);
    fireEvent.click(screen.getByRole('button', { name: 'Enter Garage' }));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(curtain(container)).toBeNull();
  });
});

describe('a second load in the same session', () => {
  it('shows no curtain', () => {
    sessionStorage.setItem(INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE);
    const { container } = renderDoor(true);
    expect(curtain(container)).toBeNull();
  });

  it('still renders the page', () => {
    // Skipping the intro must never cost the content.
    sessionStorage.setItem(INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE);
    const { container } = renderDoor(true);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});

describe('the garage behind a closed door is out of reach, not merely out of sight', () => {
  /*
    Found by Cowork's QA run, 2 Aug. Four of the first ten Tab stops on `/`
    landed on controls at effective opacity 0 — "Add a photo of this car",
    "Update mileage", "Vehicle options", "View Dashboard" — with the focus ring
    invisible along with them. `document.querySelectorAll('[inert]').length`
    was 0.

    The curtain is opaque, so this was invisible to anyone using a mouse and
    total for anyone using a keyboard. WCAG 2.4.3 (Focus Order) and 2.4.7
    (Focus Visible). It matters more here than it would elsewhere because the
    door deliberately waits to be opened, so "closed" is a state a first-time
    visitor sits in for as long as they like rather than a moment in an
    animation.

    `aria-hidden` was already used in ten places in this tree and does not fix
    it: it hides things from the accessibility tree and leaves them in the tab
    order, which is precisely the half that was not the problem.
  */
  function renderWithFocusableGarage() {
    return render(
      <GarageDoor
        panel={(enter) => (
          <button type="button" onClick={enter}>
            Enter Garage
          </button>
        )}
      >
        <main>
          <button type="button">View Dashboard</button>
        </main>
      </GarageDoor>
    );
  }

  it('marks the page inert while the door is closed', () => {
    const { container } = renderWithFocusableGarage();

    expect(container.querySelector('main')!.closest('[inert]')).not.toBeNull();
  });

  it('leaves the opener on the door reachable', () => {
    /*
      The failure mode of the fix, and the reason this assertion exists: inert
      the wrong subtree and the only control that can open the door goes with
      it. The door would then be genuinely unopenable by keyboard rather than
      merely unhelpful.
    */
    renderWithFocusableGarage();

    expect(screen.getByRole('button', { name: 'Enter Garage' }).closest('[inert]')).toBeNull();
  });

  it('releases the page once the door is opening', () => {
    // `revealed` is true from 'lifting', not from 'gone' — the content is
    // visible and usable while the curtain travels, which is the beat the
    // door exists to set up.
    const { container } = renderWithFocusableGarage();

    fireEvent.click(screen.getByRole('button', { name: 'Enter Garage' }));

    expect(container.querySelector('main')!.closest('[inert]')).toBeNull();
  });

  it('never marks the page inert when the intro is skipped', () => {
    // A returning visitor sees no curtain at all, so nothing may be withheld.
    sessionStorage.setItem(INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE);
    const { container } = renderWithFocusableGarage();

    expect(container.querySelector('main')!.closest('[inert]')).toBeNull();
  });

  it('does not disturb the layout it wraps', () => {
    /*
      `display: contents` is load-bearing, not cosmetic. The page root has to
      stay a direct flex child of `body` for the R4 app shell to get its
      height, and an ordinary wrapper div would sit between them.
    */
    const { container } = renderWithFocusableGarage();
    const wrapper = container.querySelector('[inert]') as HTMLElement;

    expect(wrapper.style.display).toBe('contents');
  });
});
