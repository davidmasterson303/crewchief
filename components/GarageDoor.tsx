'use client';

import { useCallback, useEffect, useRef, useState, type AnimationEvent, type ReactNode } from 'react';
import {
  decideIntro,
  INTRO_HOLD_MS,
  INTRO_LIFT_TIMEOUT_MS,
  INTRO_PLAYED_KEY,
  INTRO_PLAYED_VALUE,
} from '@crewchief/core/intro-gate';

/**
 * The first-load intro curtain: a garage door that lifts to reveal the page.
 *
 * Replaces three things that did not work together. `GarageDoorAnimation` and
 * `GarageDoorLayer` were dead code on every branch — the second rendered
 * `children` twice, concurrently, for the whole 1.5s of its exit, so the entire
 * page below it mounted twice with duplicate effects and duplicate fetches. The
 * third, `LandingHero`, was live but ran its curtain on every visit, from a
 * 1.41 MB JPEG, with no reduced-motion check.
 *
 * Three rules hold this one together:
 *
 *   1. **`children` is rendered exactly once**, and never inside the curtain.
 *      The page below is the page below whether the door is up or not; the
 *      curtain is a sibling that covers it. That is the fix for the double
 *      mount, and it is structural rather than careful.
 *   2. **The curtain is server-rendered and CSS-gated**, so it covers the
 *      viewport in the first paint. Nothing about it waits on a chunk. The old
 *      version was `dynamic(..., { ssr: false })` racing a 600ms timer, and
 *      lost the race silently — no error, just no intro.
 *   3. **The lift ends on `animationend`**, not on a hand-copied duration.
 */

interface GarageDoorProps {
  /**
   * What sits on the door — headline, calls to action. Optional: the door is
   * complete without it.
   *
   * A render prop rather than a node, so the panel can raise the door early
   * (an "Enter Garage" button) without knowing how the door works, and without
   * the parent having to hold a piece of the door's state to pass back down.
   * That shared `isOpen`-in-the-parent arrangement is what let the old version
   * get out of step with itself.
   */
  panel?: (enter: () => void) => ReactNode;
  /** The page. Rendered once, always, whatever the door is doing. */
  children: ReactNode;
}

type Phase = 'closed' | 'lifting' | 'gone';

function markPlayed() {
  // Written when the intro *starts*, not when it finishes. A reload halfway
  // through is a person who has seen it and would rather not sit through it
  // again, and it also stops a fast double-refresh replaying it twice.
  try {
    sessionStorage.setItem(INTRO_PLAYED_KEY, INTRO_PLAYED_VALUE);
  } catch (_) {
    // Storage can be unavailable outright (partitioned or blocked contexts).
    // The intro then plays once per load rather than once per session, which
    // is a worse experience but not a broken one.
  }
}

export default function GarageDoor({ panel, children }: GarageDoorProps) {
  /*
    Starts 'closed' on the server and on the client's first render, so
    hydration matches. Whether that markup is *visible* is decided by CSS from
    the `data-intro` attribute the pre-paint script in app/layout.tsx sets —
    which is how a returning visitor gets no flash of door despite the door
    being in the server's HTML.
  */
  const [phase, setPhase] = useState<Phase>('closed');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const lift = useCallback(() => {
    setPhase((current) => (current === 'closed' ? 'lifting' : current));
  }, []);

  useEffect(() => {
    /*
      The same policy the pre-paint script applied, from the same three inputs,
      in the same load — so the two agree by construction. They cannot share an
      import: that script has to run before the bundle exists, which is the
      whole reason it is a string. `@crewchief/core/intro-gate` is where the
      rule is written down, and the script mirrors it.
    */
    const decision = decideIntro({
      alreadyPlayed: (() => {
        try {
          return sessionStorage.getItem(INTRO_PLAYED_KEY) === INTRO_PLAYED_VALUE;
        } catch (_) {
          return false;
        }
      })(),
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
      documentHidden: document.hidden,
    });

    if (decision === 'skip') {
      setPhase('gone');
      return;
    }

    markPlayed();

    const scheduled = timers.current;
    scheduled.push(setTimeout(lift, INTRO_HOLD_MS));

    /*
      The safety net for the failure this component's predecessor actually
      exhibited: a curtain frozen mid-lift, parked over the page. `animationend`
      does not arrive if the animation never runs or is interrupted, so the
      teardown cannot be its only trigger. See INTRO_LIFT_TIMEOUT_MS.
    */
    scheduled.push(setTimeout(() => setPhase('gone'), INTRO_HOLD_MS + INTRO_LIFT_TIMEOUT_MS));

    return () => {
      scheduled.forEach(clearTimeout);
      scheduled.length = 0;
    };
  }, [lift]);

  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    // Only the door's own lift ends the intro. Without this guard any
    // animation on any descendant would tear the curtain down early — and the
    // panel's call-to-action carries a shimmer.
    if (event.target !== event.currentTarget) return;
    setPhase('gone');
  };

  return (
    <>
      {children}

      {phase !== 'gone' && (
        <div
          className={`garage-door fixed inset-0 z-50 flex-col items-center justify-center overflow-hidden${
            phase === 'lifting' ? ' is-lifting' : ''
          }`}
          onAnimationEnd={handleAnimationEnd}
        >
          {panel && (
            <div className="garage-door-content relative z-10 flex w-full flex-col items-center px-6 text-center">
              {panel(lift)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
