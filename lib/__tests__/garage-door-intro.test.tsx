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
import { render, screen } from '@testing-library/react';
import GarageDoor from '@/components/GarageDoor';
import { INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE } from '@crewchief/core/intro-gate';

function renderDoor(strict: boolean) {
  const tree = (
    <GarageDoor panel={() => <span>on the door</span>}>
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
    expect(screen.getByText('on the door')).toBeInTheDocument();
  });

  it('records that the intro has played, so a reload does not repeat it', () => {
    renderDoor(true);
    expect(sessionStorage.getItem(INTRO_PLAYED_KEY)).toBe(INTRO_PLAYED_VALUE);
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
